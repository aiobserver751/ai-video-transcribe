import { Queue, Worker, QueueEvents, FlowProducer } from 'bullmq';
import { createRedisConnection, QUEUE_NAMES, PRIORITY, defaultJobOptions, JOB_STATUS } from './config.ts';
import { logger } from '../logger.ts';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { transcribeAudio } from '../transcription.ts';
import { transcribeAudioWithGroq } from '../groq-transcription.ts';
import { rateLimitTracker } from '../rate-limit-tracker.ts';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
// --- DB Imports ---
import { db } from '../../server/db/index.ts';
import { transcriptionJobs } from '../../server/db/schema.ts';
import { eq } from 'drizzle-orm';

const execAsync = promisify(exec);

// Job data type for transcription job
interface TranscriptionJobData {
  url: string;
  quality: 'standard' | 'premium';
  fallbackOnRateLimit: boolean;
  jobId: string;
  userId?: string;
  apiKey: string;
  callback_url?: string; // Optional callback URL
}

// Result type for transcription job
interface TranscriptionResult {
  transcription: string;
  quality: string;
  jobId: string;
  filePath?: string;
  error?: string;
  callback_success?: boolean;
  callback_error?: string;
}

// Progress data type
interface JobProgress {
  percentage: number;
  stage: string;
  message?: string;
}

// Send callback to client when job completes
interface CallbackData {
  job_id: string;
  status_code: number;
  status_message: string;
  quality: string;
  response?: {
    transcription_url: string;
  };
  error?: string;
}

// Initialize transcription queue
export const transcriptionQueue = new Queue<TranscriptionJobData, TranscriptionResult>(
  QUEUE_NAMES.TRANSCRIPTION,
  {
    connection: createRedisConnection(),
    defaultJobOptions
  }
);

// Initialize flow producer for parent-child job relationships
export const flowProducer = new FlowProducer({
  connection: createRedisConnection()
});

// Initialize queue events for monitoring
export const transcriptionQueueEvents = new QueueEvents(QUEUE_NAMES.TRANSCRIPTION, {
  connection: createRedisConnection()
});

// Add a transcription job to the queue
export async function addTranscriptionJob(
  data: Omit<TranscriptionJobData, 'jobId'>,
  priority: 'standard' | 'premium' = 'standard'
): Promise<string> {
  const jobId = `transcription-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  
  await transcriptionQueue.add(
    'transcribe',
    {
      ...data,
      jobId
    },
    {
      priority: priority === 'premium' ? PRIORITY.PREMIUM : PRIORITY.STANDARD,
      jobId
    }
  );
  
  return jobId;
}

// Get job status and progress
export async function getJobStatus(jobId: string): Promise<{
  status: string;
  progress: JobProgress | null;
  result: TranscriptionResult | null;
}> {
  const job = await transcriptionQueue.getJob(jobId);
  
  if (!job) {
    return {
      status: 'not_found',
      progress: null,
      result: null
    };
  }
  
  const state = await job.getState();
  const progress = await job.progress as JobProgress | undefined;
  
  return {
    status: state,
    progress: progress || null,
    result: state === JOB_STATUS.COMPLETED ? await job.returnvalue : null
  };
}

// Send callback to client when job completes
async function sendCallback(callbackUrl: string, data: CallbackData): Promise<boolean> {
  try {
    logger.info(`Sending callback to ${callbackUrl}`);
    await axios.post(callbackUrl, data);
    logger.info(`Callback to ${callbackUrl} successful`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Callback to ${callbackUrl} failed: ${errorMessage}`);
    return false;
  }
}

// Process transcription jobs
export function startTranscriptionWorker(concurrency = 5) {
  const worker = new Worker<TranscriptionJobData, TranscriptionResult>(
    QUEUE_NAMES.TRANSCRIPTION,
    async (job) => {
      const { url, quality, fallbackOnRateLimit, callback_url, jobId } = job.data;
      logger.info(`Processing transcription job ${jobId} for URL: ${url}`);
      
      // Define paths and result variables early
      let audioPath: string | undefined;
      let transcriptionFilePath: string | undefined;
      let finalTranscriptionUrl: string | undefined;

      // === Update DB Status to Processing ===
      try {
        logger.info(`Updating job ${jobId} status to 'processing' in DB`);
        await db.update(transcriptionJobs)
          .set({ status: 'processing', updatedAt: new Date() })
          .where(eq(transcriptionJobs.id, jobId));
      } catch (dbError) {
        logger.error(`Failed to update job ${jobId} status to 'processing' in DB:`, dbError);
        // Decide if we should fail the job here or just log and continue?
        // For now, log and continue, but this might lead to inconsistent states.
      }

      try {
        // Create unique filename for this request
        const timestamp = Date.now();
        const tmpDir = path.join(process.cwd(), 'tmp');
        audioPath = path.join(tmpDir, `audio_${timestamp}.mp3`);

        // Make sure tmp directory exists
        if (!fs.existsSync(tmpDir)) {
          fs.mkdirSync(tmpDir, { recursive: true });
        }

        // Update progress for download phase
        await job.updateProgress({ percentage: 10, stage: 'downloading', message: 'Downloading audio' });
        
        try {
          // Download audio using yt-dlp
          logger.info(`Downloading audio from ${url}`);
          await execAsync(`yt-dlp -x --audio-format mp3 -o "${audioPath}" "${url}"`);
          if (!fs.existsSync(audioPath)) {
            throw new Error('Failed to download audio from the provided URL');
          }
          const stats = await fs.promises.stat(audioPath);
          logger.info(`Downloaded audio file size: ${(stats.size / (1024 * 1024)).toFixed(2)}MB`);
        } catch (downloadError) {
          logger.error('Download error:', downloadError);
          throw new Error(`Failed to download video: ${downloadError}`);
        }

        // Update progress for transcription phase
        await job.updateProgress({ percentage: 40, stage: 'transcribing', message: 'Transcribing audio' });

        // Transcribe the audio based on requested quality
        let qualityUsed = quality;
        
        try {
          if (quality === 'premium') {
            logger.info('Using premium Groq transcription');
            if (!process.env.GROQ_API_KEY) {
              throw new Error('GROQ_API_KEY is not configured on the server');
            }
            // Get current rate limit usage stats
            const usageStats = rateLimitTracker.getUsageStats();
            logger.info(`Rate limits: ${usageStats.hourlyUsed}/${usageStats.hourlyLimit} seconds used this hour`);
            
            try {
              // This now returns a FILE PATH
              transcriptionFilePath = await transcribeAudioWithGroq(audioPath);
            } catch (groqError) {
              const errorMessage = groqError instanceof Error ? groqError.message : String(groqError);
              if (fallbackOnRateLimit && errorMessage.includes('rate_limit_exceeded')) {
                logger.warn('Groq rate limit exceeded. Falling back to standard transcription...');
                qualityUsed = 'standard';
                // This also returns a FILE PATH
                transcriptionFilePath = await transcribeAudio(audioPath);
              } else {
                throw groqError;
              }
            }
          } else {
            logger.info('Using standard open-source Whisper transcription');
            // This returns a FILE PATH
            transcriptionFilePath = await transcribeAudio(audioPath);
          }
        } catch (transcriptionError) {
          logger.error('Transcription error:', transcriptionError);
          // No need to clean up transcription file here, let main catch handle cleanup
          throw transcriptionError;
        }

        // **** STEP: Read transcription text (needed for result object) ****
        let transcriptionText: string;
        if (!transcriptionFilePath || !fs.existsSync(transcriptionFilePath)) {
          logger.error(`Transcription file path is missing or file does not exist: ${transcriptionFilePath}`);
          throw new Error('Transcription process failed to produce a result file.');
        }
        try {
          logger.info(`Reading transcription result from: ${transcriptionFilePath}`);
          transcriptionText = await fs.promises.readFile(transcriptionFilePath, 'utf-8');
        } catch (readFileError) {
          logger.error(`Failed to read transcription file ${transcriptionFilePath}:`, readFileError);
          throw new Error(`Worker failed to read result file: ${readFileError instanceof Error ? readFileError.message : String(readFileError)}`);
        }

        // **** STEP: Determine Transcription URL for Callback ****
        if (process.env.NODE_ENV === 'production') {
          logger.info('Production environment detected. Preparing cloud storage URL.');
          // --- PRODUCTION LOGIC --- 
          try {
            // 1. (Placeholder) Upload transcriptionFilePath to your Blob Storage (e.g., S3, GCS, Azure)
            // Example: const blobPath = await uploadToBlobStorage(transcriptionFilePath, `transcriptions/${job.data.jobId}.txt`);
            // logger.info(`Uploaded transcription to blob storage at: ${blobPath}`);

            // 2. (Placeholder) Generate a signed URL for the blob
            // Example: finalTranscriptionUrl = await generateSignedUrl(blobPath, 60 * 60 * 24 * 7); // 7-day expiry
            // logger.info(`Generated signed URL: ${finalTranscriptionUrl}`);
            
            // --- Replace placeholders with actual implementation --- 
            // For now, we'll just use a placeholder string
            finalTranscriptionUrl = `https://YOUR_BUCKET.s3.amazonaws.com/transcriptions/${job.data.jobId}.txt?signed_params=...`; // Replace with actual signed URL logic
            logger.warn('Using placeholder signed URL for production - implement actual generation!');

            // 3. (Optional Cloud Cleanup) Delete local tmp file after successful upload
            // try {
            //   fs.unlinkSync(transcriptionFilePath);
            //   logger.info(`Cleaned up local transcription file after cloud upload: ${transcriptionFilePath}`);
            // } catch (cleanupError) {
            //   logger.warn(`Failed to cleanup local transcription file after cloud upload: ${cleanupError}`);
            // }

          } catch (cloudError) {
            logger.error('Error during cloud storage upload/signing:', cloudError);
            // Decide how to handle this - fail the job, or proceed without a URL?
            // For now, let's throw to indicate a failure in the production flow.
            throw new Error(`Failed to process transcription for cloud storage: ${cloudError instanceof Error ? cloudError.message : String(cloudError)}`);
          }

        } else {
          // --- LOCAL/DEVELOPMENT LOGIC --- 
          logger.info('Development environment detected. Using local file URL.');
          finalTranscriptionUrl = pathToFileURL(transcriptionFilePath).toString();
        }

        // Update progress for cleanup phase (only audio file)
        await job.updateProgress({ percentage: 90, stage: 'cleaning_up', message: 'Cleaning up temporary audio file' });

        // Clean up temporary AUDIO file
        try {
          if (audioPath && fs.existsSync(audioPath)) {
             fs.unlinkSync(audioPath);
             logger.info(`Cleaned up temporary audio file: ${audioPath}`);
          } else {
            logger.warn(`Temporary audio file not found for cleanup: ${audioPath}`);
          }
        } catch (cleanupError) {
          logger.error('Audio cleanup error:', cleanupError);
        }

        // Update progress to indicate job has completed
        await job.updateProgress({ percentage: 100, stage: 'completed', message: 'Job completed successfully' });

        // === Update DB Status to Completed ===
        try {
          logger.info(`Updating job ${jobId} status to 'completed' and storing URL in DB`);
          await db.update(transcriptionJobs)
            .set({
              status: 'completed',
              transcriptionFileUrl: finalTranscriptionUrl, // Store the final URL (file or signed)
              updatedAt: new Date()
            })
            .where(eq(transcriptionJobs.id, jobId));
        } catch (dbError) {
          logger.error(`Failed to update job ${jobId} status to 'completed' in DB:`, dbError);
          // Log and continue, the primary result is still returned/callback sent
        }

        // Prepare result
        const result: TranscriptionResult = {
          transcription: transcriptionText, // Keep text in the result object
          quality: qualityUsed,
          jobId: job.data.jobId,
          filePath: transcriptionFilePath // Keep local path for reference/debugging
        };

        // Send callback if URL was provided
        if (callback_url) {
          try {
            const callbackData: CallbackData = {
              job_id: job.data.jobId,
              status_code: 200,
              status_message: "success",
              quality: qualityUsed,
              response: {
                transcription_url: finalTranscriptionUrl // Use the determined URL (file:/// or https://)
              }
            };
            const callbackSuccess = await sendCallback(callback_url, callbackData);
            result.callback_success = callbackSuccess;
            if (!callbackSuccess) {
              result.callback_error = "Failed to send callback";
            }
          } catch (callbackError) {
            logger.error(`Callback error: ${callbackError}`);
            result.callback_success = false;
            result.callback_error = callbackError instanceof Error ? callbackError.message : String(callbackError);
          }
        }

        // IMPORTANT: Return the result object containing the text
        return result;

      } catch (error: unknown) {
        logger.error(`Job ${jobId} failed:`, error);

        // === Update DB Status to Failed ===
        try {
          logger.info(`Updating job ${jobId} status to 'failed' in DB`);
          await db.update(transcriptionJobs)
            .set({ status: 'failed', updatedAt: new Date() })
            .where(eq(transcriptionJobs.id, jobId));
        } catch (dbError) {
          logger.error(`Failed to update job ${jobId} status to 'failed' in DB during error handling:`, dbError);
          // Log error but proceed with throwing the original job error
        }
        
        // Clean up temporary AUDIO file if it exists on error
        try {
          if (audioPath && fs.existsSync(audioPath)) {
             fs.unlinkSync(audioPath);
             logger.info(`Cleaned up temporary audio file on error: ${audioPath}`);
          }
        } catch (cleanupError) {
          logger.error('Audio cleanup error during job failure:', cleanupError);
        }
        
        // NOTE: We are NOT cleaning up the transcriptionFilePath on error,
        // as it might be useful for debugging or manual retrieval.
        // Implement a separate cleanup strategy for these files later.

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // Prepare data for error callback (no result needed here)
        if (callback_url) {
          try {
            const callbackData = {
              job_id: job.data.jobId,
              status_code: 500,
              status_message: "error",
              quality: quality, // Original requested quality
              error: errorMessage
            };
            // We still try to send the callback, but don't store the success/failure
            // in the result object which won't be returned.
            await sendCallback(callback_url, callbackData);
          } catch (callbackError) {
            logger.error(`Error sending error callback: ${callbackError}`);
          }
        }
        
        // *** IMPORTANT: Throw the error instead of returning an error object ***
        // This ensures BullMQ marks the job as 'failed'
        throw error instanceof Error ? error : new Error(errorMessage);
      }
    },
    {
      connection: createRedisConnection(),
      concurrency,
      autorun: true
    }
  );

  // Handle worker events with proper typing (modified handler)
  worker.on('completed', (job, result: TranscriptionResult | undefined) => {
    if (job && result) {
      if (result.error) { // Check the RETURNED result object for an error field
        logger.error(`Job ${job.id} completed with error in result: ${result.error}`);
      } else {
        logger.info(`Job ${job.id} completed successfully (returned result)`);
      }
    } else if (job) {
      logger.warn(`Job ${job.id} completed but result object is missing.`);
    }
  });

  worker.on('failed', (job, error) => {
    if (job) {
      logger.error(`Job ${job.id} failed with error: ${error.message}`);
    } else {
      logger.error(`Job failed with error: ${error.message}`);
    }
  });

  worker.on('error', (error: Error) => {
    logger.error(`Worker error: ${error.message}`);
  });

  return worker;
}

// Setup cleanup for graceful shutdown
process.on('SIGTERM', async () => {
  await transcriptionQueue.close();
});

process.on('SIGINT', async () => {
  await transcriptionQueue.close();
}); 