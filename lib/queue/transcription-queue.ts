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
import { transcriptionJobs, creditTransactionTypeEnum } from '../../server/db/schema.ts';
import { eq } from 'drizzle-orm';
// --- Credit Service Imports ---
import {
  calculateCreditCost,
  performCreditTransaction,
  getCreditConfig,
} from '../../server/services/creditService.ts';

const execAsync = promisify(exec);

// Helper to check for YouTube URL
function isYouTubeUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    return (
      (hostname === "youtube.com" || hostname === "www.youtube.com") &&
      parsedUrl.searchParams.has("v")
    ) || (hostname === "youtu.be" && parsedUrl.pathname.length > 1);
  } catch {
    return false;
  }
}

// Job data type for transcription job
interface TranscriptionJobData {
  url: string;
  quality: 'caption_first' | 'standard' | 'premium';
  fallbackOnRateLimit: boolean;
  jobId: string;
  userId?: string; // Should always be present for jobs from submitJobAction
  apiKey: string;
  callback_url?: string; // Optional callback URL
}

// Result type for transcription job
interface TranscriptionResult {
  transcription: string; // Holds transcript or caption content
  quality: string; // The actual quality used (could be different due to fallback)
  jobId: string;
  filePath?: string; // URL to the final file
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

async function fetchAndProcessSubtitlesForWorker(
  jobId: string,
  url: string,
  baseOutputName: string // Used as the base for the output file, e.g., /tmp/jobid_videoID
): Promise<{ fileContent: string | null; filePath: string | null; error?: string; formatUsed?: 'srt' | 'vtt' }> {
  
  // Attempt 1: User-Uploaded English SRT
  const srtOutputName = `${baseOutputName}.en.srt`;
  const userSrtCmd = `yt-dlp --no-warnings --write-subs --sub-lang en --sub-format srt --skip-download -o "${baseOutputName}.%(ext)s" "${url}"`;
  logger.info(`[${jobId}:user-srt] Executing: ${userSrtCmd}`);
  try {
    if (fs.existsSync(srtOutputName)) { try { await fs.promises.unlink(srtOutputName); } catch (e) {logger.warn(`Error unlinking existing ${srtOutputName}`, e)} }
    await execAsync(userSrtCmd);
    if (fs.existsSync(srtOutputName)) {
      const srtContent = await fs.promises.readFile(srtOutputName, "utf-8");
      if (srtContent && srtContent.trim().length > 0) {
        logger.info(`[${jobId}:user-srt] User SRT successfully downloaded. Length: ${srtContent.length}`);
        return { fileContent: srtContent, filePath: srtOutputName, formatUsed: 'srt' };
      }
      logger.warn(`[${jobId}:user-srt] User SRT file downloaded but was empty. Cleaning up: ${srtOutputName}`);
      try { await fs.promises.unlink(srtOutputName); } catch (e) {logger.warn(`Error unlinking empty ${srtOutputName}`, e)}
    } else {
      logger.info(`[${jobId}:user-srt] No user SRT file found.`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`[${jobId}:user-srt] Error during user SRT attempt: ${errorMessage}.`);
    if (fs.existsSync(srtOutputName)) { try { await fs.promises.unlink(srtOutputName); } catch (e) {logger.warn(`Error unlinking ${srtOutputName} after error`,e)} }
  }

  // Attempt 2: User-Uploaded English VTT
  const vttUserOutputName = `${baseOutputName}.en.vtt`; // Potentially same as auto-vtt, ensure cleanup
  const userVttCmd = `yt-dlp --no-warnings --write-subs --sub-lang en --sub-format vtt --skip-download -o "${baseOutputName}.%(ext)s" "${url}"`;
  logger.info(`[${jobId}:user-vtt] Executing: ${userVttCmd}`);
  try {
    if (fs.existsSync(vttUserOutputName)) { try { await fs.promises.unlink(vttUserOutputName); } catch (e) {logger.warn(`Error unlinking existing ${vttUserOutputName}`,e)} }
    await execAsync(userVttCmd);
    if (fs.existsSync(vttUserOutputName)) {
      const vttContent = await fs.promises.readFile(vttUserOutputName, "utf-8");
      if (vttContent && vttContent.trim().length > 0) {
        logger.info(`[${jobId}:user-vtt] User VTT successfully downloaded. Length: ${vttContent.length}`);
        return { fileContent: vttContent, filePath: vttUserOutputName, formatUsed: 'vtt' };
      }
      logger.warn(`[${jobId}:user-vtt] User VTT file downloaded but was empty. Cleaning up: ${vttUserOutputName}`);
      try { await fs.promises.unlink(vttUserOutputName); } catch (e) {logger.warn(`Error unlinking empty ${vttUserOutputName}`,e)}
    } else {
      logger.info(`[${jobId}:user-vtt] No user VTT file found.`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`[${jobId}:user-vtt] Error during user VTT attempt: ${errorMessage}.`);
    if (fs.existsSync(vttUserOutputName)) { try { await fs.promises.unlink(vttUserOutputName); } catch (e) {logger.warn(`Error unlinking ${vttUserOutputName} after error`,e)} }
  }

  // Attempt 3: Auto-Generated English VTT
  const vttAutoOutputName = `${baseOutputName}.en.vtt`; // Same name as user VTT path, ensure cleanup from previous if needed
  const autoVttCmd = `yt-dlp --no-warnings --write-auto-subs --sub-lang en --sub-format vtt --skip-download -o "${baseOutputName}.%(ext)s" "${url}"`;
  logger.info(`[${jobId}:auto-vtt] Executing: ${autoVttCmd}`);
  try {
    // Ensure any remnants from a failed user VTT attempt with the same name are gone
    if (fs.existsSync(vttAutoOutputName)) { try { await fs.promises.unlink(vttAutoOutputName); } catch (e) {logger.warn(`Error unlinking existing ${vttAutoOutputName} before auto-vtt attempt`, e)} }
    await execAsync(autoVttCmd);
    if (fs.existsSync(vttAutoOutputName)) {
      const vttContent = await fs.promises.readFile(vttAutoOutputName, "utf-8");
      if (vttContent && vttContent.trim().length > 0) {
        logger.info(`[${jobId}:auto-vtt] Auto VTT successfully downloaded. Length: ${vttContent.length}`);
        return { fileContent: vttContent, filePath: vttAutoOutputName, formatUsed: 'vtt' };
      }
      logger.warn(`[${jobId}:auto-vtt] Auto VTT file downloaded but was empty. Cleaning up: ${vttAutoOutputName}`);
      try { await fs.promises.unlink(vttAutoOutputName); } catch (e) {logger.warn(`Error unlinking empty ${vttAutoOutputName}`,e)}
    } else {
      logger.info(`[${jobId}:auto-vtt] No auto VTT file found.`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`[${jobId}:auto-vtt] Error during auto VTT attempt: ${errorMessage}.`);
    if (fs.existsSync(vttAutoOutputName)) { try { await fs.promises.unlink(vttAutoOutputName); } catch (e) {logger.warn(`Error unlinking ${vttAutoOutputName} after error`,e)} }
  }
  
  // If all attempts failed
  const allFailedError = "All attempts to fetch English subtitles (user SRT, user VTT, auto VTT) failed or yielded no content.";
  logger.error(`[${jobId}] ${allFailedError}`);
  return { fileContent: null, filePath: null, error: allFailedError, formatUsed: undefined };
}

// Process transcription jobs
export function startTranscriptionWorker(concurrency = 5) {
  const worker = new Worker<TranscriptionJobData, TranscriptionResult>(
    QUEUE_NAMES.TRANSCRIPTION,
    async (job) => {
      const { url, quality, fallbackOnRateLimit, callback_url, jobId, userId } = job.data;
      logger.info(`[${jobId}] Starting processing for URL: ${url}, Quality: ${quality}, User: ${userId}`);

      if (!userId) {
        logger.error(`[${jobId}] Critical: userId is missing. Cannot process credits or job.`);
        await db.update(transcriptionJobs)
          .set({ status: 'failed', statusMessage: 'User ID missing in job data.', updatedAt: new Date() })
          .where(eq(transcriptionJobs.id, jobId));
        throw new Error(`User ID missing for job ${jobId}`);
      }

      let audioPath: string | undefined;
      let actualCaptionFilePath: string | undefined;
      let transcriptionFilePath: string | undefined;
      let finalFileUrl: string | undefined;
      let videoLengthMinutesActual: number | null = null;
      let creditsChargedForDB: number | null = null;
      let creditDeductionError: string | null = null;
      let actualCost = 0;
      let creditsDeductedSuccessfully = false;
      let qualityUsed = quality;
      let resultTextFromSrt: string | null = null;
      let rawSubtitleContent: string | null = null;
      let subtitleFormatUsed: 'srt' | 'vtt' | undefined = undefined;

        const tmpDir = path.join(process.cwd(), 'tmp');
        if (!fs.existsSync(tmpDir)) {
          fs.mkdirSync(tmpDir, { recursive: true });
        }

      try {
        // STAGE 1: Get Video Metadata / Duration
        logger.info(`[${jobId}] Fetching video metadata/duration for URL: ${url}`);
        await job.updateProgress({ percentage: 5, stage: 'metadata', message: 'Fetching video information' });
        
        const isYouTube = isYouTubeUrl(url);

        if (quality === 'caption_first' && isYouTube) {
          try {
            // For YouTube caption-first, get duration string only
            const durationOutput = await execAsync(`yt-dlp --no-warnings --print duration_string --skip-download "${url}"`);
            const durationString = durationOutput.stdout.trim();
            if (durationString && durationString !== "NA") {
              const parts = durationString.split(':').map(Number);
              let durationInSeconds = 0;
              if (parts.length === 3) { // HH:MM:SS
                durationInSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
              } else if (parts.length === 2) { // MM:SS
                durationInSeconds = parts[0] * 60 + parts[1];
              } else if (parts.length === 1) { // SS
                durationInSeconds = parts[0];
              }
              if (durationInSeconds > 0) {
                videoLengthMinutesActual = Math.max(1, Math.ceil(durationInSeconds / 60));
                logger.info(`[${jobId}] YouTube video (caption-first) length: ${videoLengthMinutesActual} minutes.`);
              } else {
                logger.warn(`[${jobId}] Invalid duration string (${durationString}) for YouTube (caption-first).`);
              }
            } else {
              logger.warn(`[${jobId}] Could not extract duration string for YouTube (caption-first), was: '${durationString}'. Proceeding without it.`);
            }
          } catch (durationError: unknown) {
            const durationErrorMessage = durationError instanceof Error ? durationError.message : String(durationError);
            logger.warn(`[${jobId}] Failed to get duration string for YouTube (caption-first): ${durationErrorMessage}. Proceeding without it.`);
          }
        } else {
          // Existing metadata fetch for non-caption-first-YouTube jobs (standard, premium, or non-youtube caption_first if they somehow get here)
        try {
          const metadataOutput = await execAsync(`yt-dlp -j --no-warnings "${url}"`);
          const metadata = JSON.parse(metadataOutput.stdout);
          if (metadata && metadata.duration) {
            const durationInSeconds = Number(metadata.duration);
            if (!isNaN(durationInSeconds) && durationInSeconds > 0) {
              videoLengthMinutesActual = Math.max(1, Math.ceil(durationInSeconds / 60));
              logger.info(`[${jobId}] Video length: ${videoLengthMinutesActual} minutes.`);
            } else {
               logger.warn(`[${jobId}] Invalid duration (${metadata.duration}) extracted.`);
            }
          } else {
            logger.warn(`[${jobId}] Could not extract duration for URL: ${url}.`);
          }
        } catch (metaError: unknown) {
          const metaErrorMessage = metaError instanceof Error ? metaError.message : String(metaError);
          logger.error(`[${jobId}] Failed to get video metadata: ${metaErrorMessage}`);
            // If quality is not 'caption_first', this is a critical error for credit calculation.
            // If it IS 'caption_first' but NOT YouTube (e.g. direct mp4 with caption_first, which is not intended),
            // it would also be an issue. The upstream validation should prevent non-YouTube caption_first.
            if (!(quality === 'caption_first' && isYouTube)) { // Fail if not (YouTube + caption_first path which handles missing duration)
            await db.update(transcriptionJobs).set({ status: 'failed', statusMessage: `Failed to retrieve video metadata: ${metaErrorMessage}`, updatedAt: new Date() }).where(eq(transcriptionJobs.id, jobId));
            throw new Error(`Failed to retrieve video metadata for ${jobId}: ${metaErrorMessage}`);
          }
            logger.warn(`[${jobId}] Proceeding for YouTube caption_first despite metadata error (already handled duration separately).`);
          }
        }
        
        // Update DB with video length if found (applies to all paths that find it)
        if (videoLengthMinutesActual !== null) {
            await db.update(transcriptionJobs)
              .set({ video_length_minutes_actual: videoLengthMinutesActual, updatedAt: new Date() })
              .where(eq(transcriptionJobs.id, jobId));
        } else {
            // If still null (e.g. YT caption-first duration failed), store 0 or keep null. Let's use 0 for "N/A"
             await db.update(transcriptionJobs)
              .set({ video_length_minutes_actual: 0, updatedAt: new Date() }) // Indicate 'Not Available' or failed fetch
              .where(eq(transcriptionJobs.id, jobId));
            logger.info(`[${jobId}] Video length set to 0 (N/A) in DB.`);
        }

        // STAGE 2: Credit Calculation & Deduction
        logger.info(`[${jobId}] Calculating credit cost for quality: ${quality}`);
        await job.updateProgress({ percentage: 10, stage: 'credit_check', message: 'Verifying account credits' });
        
        let transactionType: typeof creditTransactionTypeEnum.enumValues[number];
        const creditSystemConfig = getCreditConfig();

        if (quality === 'caption_first') {
          // For caption_first, we should also check if it's a YouTube URL.
          // Non-YouTube caption_first should have been blocked by API/Action validation.
          // If one gets here, it's an anomaly; proceed with fixed cost but it will likely fail at caption download.
          if (!isYouTube) {
            logger.warn(`[${jobId}] Processing 'caption_first' for a non-YouTube URL: ${url}. This is not the intended path.`);
            // The job will likely fail at caption download stage.
          }
          transactionType = 'caption_download';
          actualCost = creditSystemConfig.CREDITS_CAPTION_FIRST_FIXED;
        } else if (quality === 'standard') {
          if (videoLengthMinutesActual === null) {
            throw new Error('Video duration unknown for standard quality.');
          }
          transactionType = 'standard_transcription';
          actualCost = calculateCreditCost('standard', videoLengthMinutesActual);
        } else if (quality === 'premium') {
           if (videoLengthMinutesActual === null) {
            throw new Error('Video duration unknown for premium quality.');
          }
          transactionType = 'premium_transcription';
          actualCost = calculateCreditCost('premium', videoLengthMinutesActual);
        } else {
          throw new Error(`Unknown quality type: ${quality}`);
        }
        creditsChargedForDB = actualCost;

        logger.info(`[${jobId}] Attempting to deduct ${actualCost} credits from user ${userId} for type: ${transactionType}`);
        const creditResult = await performCreditTransaction(
          userId,
          actualCost,
          transactionType,
          { jobId: jobId, videoLengthMinutesCharged: videoLengthMinutesActual === null ? undefined : videoLengthMinutesActual }
        );

        if (!creditResult.success) {
          creditDeductionError = creditResult.error || "Credit deduction failed";
          logger.error(`[${jobId}] Credit deduction failed for user ${userId}: ${creditDeductionError}`);
          await db.update(transcriptionJobs)
            .set({
              status: 'failed_insufficient_credits',
              statusMessage: creditDeductionError,
              credits_charged: creditsChargedForDB,
              video_length_minutes_actual: videoLengthMinutesActual,
              updatedAt: new Date()
            })
            .where(eq(transcriptionJobs.id, jobId));
          throw new Error(creditDeductionError);
        }

        creditsDeductedSuccessfully = true;
        logger.info(`[${jobId}] Credits deducted successfully for user ${userId}. New balance: ${creditResult.newBalance}`);
        
        await db.update(transcriptionJobs)
          .set({
            status: 'processing',
            credits_charged: actualCost,
            video_length_minutes_actual: videoLengthMinutesActual,
            updatedAt: new Date(),
            statusMessage: null 
          })
          .where(eq(transcriptionJobs.id, jobId));

        // STAGE 3: Actual Work
        const timestamp = Date.now();

        if (quality === 'caption_first' && isYouTube) {
          actualCaptionFilePath = undefined; // Reset
          // Use a single base name for output, yt-dlp will append .en.srt or .en.vtt
          const captionFileBaseName = path.join(tmpDir, `${jobId}_caption`);

          logger.info(`[${jobId}] Attempting to download subtitles (1.User SRT, 2.User VTT, 3.Auto VTT).`);
          const subResult = await fetchAndProcessSubtitlesForWorker(jobId, url, captionFileBaseName);

          if (subResult.fileContent && subResult.filePath && subResult.formatUsed) {
            rawSubtitleContent = subResult.fileContent;
            actualCaptionFilePath = subResult.filePath;
            subtitleFormatUsed = subResult.formatUsed;
            logger.info(`[${jobId}] Successfully downloaded subtitles as ${subtitleFormatUsed}. Path: ${actualCaptionFilePath}`);
            } else {
            // If subResult.fileContent is null, it means all attempts failed. Throw error from subResult.
            const finalErrorMsg = subResult.error || 'Unknown error fetching subtitles after all attempts.'; // Fallback error
            logger.error(`[${jobId}] Failed to fetch subtitles: ${finalErrorMsg}`);
            throw new Error(finalErrorMsg);
          }
          // resultTextFromSrt = plainTextOutput; // Old variable, now using rawSubtitleContent
        } else if (quality === 'caption_first' && !isYouTube) {
            const nonYouTubeCaptionError = `Job ${jobId}: 'caption_first' quality is only supported for YouTube URLs. Received: ${url}`;
            logger.error(nonYouTubeCaptionError);
            throw new Error(nonYouTubeCaptionError);
          }
        else { // 'standard' or 'premium' (any URL type)
          audioPath = path.join(tmpDir, `audio_${jobId}_${timestamp}.mp3`);
          logger.info(`[${jobId}] Downloading audio for transcription to ${audioPath} (Quality: ${quality}, URL: ${url})`);
          await job.updateProgress({ percentage: 30, stage: 'downloading_audio', message: 'Downloading audio file' });
          try {
            await execAsync(`yt-dlp -x --no-warnings --audio-format mp3 -o "${audioPath}" "${url}"`);
            if (!fs.existsSync(audioPath)) {
              throw new Error('Audio file not found after download attempt.');
            }
            logger.info(`[${jobId}] Audio downloaded successfully to ${audioPath}`);
          } catch (downloadError: unknown) {
            const downloadErrorMessage = downloadError instanceof Error ? downloadError.message : String(downloadError);
            logger.error(`[${jobId}] Audio download error: ${downloadErrorMessage}`);
            throw new Error(`Failed to download audio for ${jobId}: ${downloadErrorMessage}`);
          }

          let transcriptionFilePathForWhisper: string | undefined;
          await job.updateProgress({ percentage: 50, stage: 'transcribing', message: 'Audio transcription in progress' });
          try {
            if (quality === 'premium') {
              logger.info(`[${jobId}] Premium Groq transcription`);
              if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY missing');
              const usageStats = rateLimitTracker.getUsageStats();
              logger.info(`[${jobId}] Rate limits: ${usageStats.hourlyUsed}/${usageStats.hourlyLimit}s`);
              try {
                transcriptionFilePathForWhisper = await transcribeAudioWithGroq(audioPath);
              } catch (groqError: unknown) {
                const groqErrorMessage = groqError instanceof Error ? groqError.message : String(groqError);
                if (fallbackOnRateLimit && groqErrorMessage.includes('rate_limit_exceeded')) {
                  logger.warn(`[${jobId}] Groq rate limit, falling to standard.`);
                  qualityUsed = 'standard';
                  transcriptionFilePathForWhisper = await transcribeAudio(audioPath);
                } else { throw groqError; }
              }
            } else { // standard
              logger.info(`[${jobId}] Standard Whisper transcription`);
              transcriptionFilePathForWhisper = await transcribeAudio(audioPath);
            }
          } catch (transcriptionError: unknown) {
            const transcriptionErrorMessage = transcriptionError instanceof Error ? transcriptionError.message : String(transcriptionError);
            logger.error(`[${jobId}] Transcription error: ${transcriptionErrorMessage}`);
            throw transcriptionError; 
          }
          // The resultText for standard/premium will be read from transcriptionFilePathForWhisper
          if (!transcriptionFilePathForWhisper || !fs.existsSync(transcriptionFilePathForWhisper)) {
            throw new Error('Whisper transcription result file path is invalid or file does not exist.');
          }
          resultTextFromSrt = await fs.promises.readFile(transcriptionFilePathForWhisper, 'utf-8');
          actualCaptionFilePath = transcriptionFilePathForWhisper; 
        }

        // STAGE 4: Finalize and Cleanup
        logger.info(`[${jobId}] Finalizing job.`);
        await job.updateProgress({ percentage: 90, stage: 'finalizing', message: 'Preparing results' });

        let textToStore: string | null = null;
        if (quality === 'caption_first' && isYouTube) {
          textToStore = rawSubtitleContent;
        } else { // For standard or premium, resultTextFromSrt would have been populated by Whisper
          textToStore = resultTextFromSrt; 
        }

        if (!textToStore) { 
          throw new Error('Result text (caption/transcript) was not generated or retrieved.');
        }
        
        const finalTranscriptionText: string = textToStore;
        
        if (process.env.NODE_ENV === 'production') {
            let s3FileExtension = 'txt'; // Default for non-caption_first or if subtitleFormatUsed is undefined
            // qualityUsed is the definitive quality after potential fallbacks (though caption_first doesn't typically fallback)
            // subtitleFormatUsed is populated for successful caption_first downloads
            if (qualityUsed === 'caption_first' && subtitleFormatUsed) {
                 s3FileExtension = subtitleFormatUsed; // 'srt' or 'vtt'
            }
            
            // Use the determined extension for the temporary file path
            const tempFilePathForUpload = path.join(tmpDir, `${jobId}_upload_content.${s3FileExtension}`);
            
            // finalTranscriptionText already holds the raw subtitle content for caption_first jobs
            await fs.promises.writeFile(tempFilePathForUpload, finalTranscriptionText, 'utf-8');
            
            // Construct the S3 file name using the correct extension from tempFilePathForUpload
            const s3FileName = `${qualityUsed}/${jobId}_${path.basename(tempFilePathForUpload)}`;
            finalFileUrl = `https://YOUR_BUCKET.s3.amazonaws.com/${s3FileName}`; // URL will now include .srt or .vtt
            
            logger.info(`[${jobId}] Production: Prepared ${s3FileExtension.toUpperCase()} content for S3. URL: ${finalFileUrl}`);
            logger.warn(`[${jobId}] Using placeholder S3 URL for text content: ${finalFileUrl} - Implement actual upload & signing!`);

        } else {
          if (quality === 'caption_first' && isYouTube && actualCaptionFilePath && rawSubtitleContent && subtitleFormatUsed) {
            // Save the raw content to a file with the correct extension
            const finalRawSubPath = path.join(tmpDir, `${jobId}_final_raw_subs.${subtitleFormatUsed}`);
            await fs.promises.writeFile(finalRawSubPath, rawSubtitleContent, 'utf-8');
            finalFileUrl = pathToFileURL(finalRawSubPath).toString();
          } else if (actualCaptionFilePath) { 
             finalFileUrl = pathToFileURL(actualCaptionFilePath).toString();
          }
        }

          await db.update(transcriptionJobs)
            .set({
              status: 'completed',
              transcriptionFileUrl: finalFileUrl,
              transcriptionText: finalTranscriptionText,
              updatedAt: new Date(),
              statusMessage: null, 
            })
            .where(eq(transcriptionJobs.id, jobId));
        logger.info(`[${jobId}] Job completed successfully. Text stored in DB. File at: ${finalFileUrl}`);

        // Cleanup
        if (audioPath && fs.existsSync(audioPath)) {
          fs.unlinkSync(audioPath);
          logger.info(`[${jobId}] Cleaned up temporary audio file: ${audioPath}`);
        }
        // For caption_first, actualCaptionFilePath is the initially downloaded .srt or .vtt
        // finalFileUrl may point to a different path if we copied it (e.g. _final_raw_subs), or the same if not copied.
        
        // Cleanup the initially downloaded subtitle file if it's different from the final file URL path
        // or if finalFileUrl is not set (e.g. S3 path in prod for the text file, but local subtitle file still exists)
        if (actualCaptionFilePath && fs.existsSync(actualCaptionFilePath)) {
            let shouldDeleteInitial = true;
            if (finalFileUrl && finalFileUrl.startsWith('file:')) {
                try {
                    const finalPath = new URL(finalFileUrl).pathname;
                    const normalizedFinalPath = process.platform === 'win32' && finalPath.startsWith('/') ? finalPath.substring(1) : finalPath;
                    if (path.resolve(actualCaptionFilePath) === path.resolve(normalizedFinalPath)) {
                        shouldDeleteInitial = false; // It's the same file, will be handled by generic dev cleanup if applicable
                    }
                } catch (e) { logger.error(`[${jobId}] Error comparing paths for cleanup: ${e}`);}
            }
            if (shouldDeleteInitial) {
                fs.unlinkSync(actualCaptionFilePath);
                logger.info(`[${jobId}] Cleaned up temporary downloaded subtitle file: ${actualCaptionFilePath}`);
            }
        }

        if (quality === 'caption_first' && isYouTube && finalFileUrl && finalFileUrl.startsWith('file:')) {
            try {
                const tempRawPath = new URL(finalFileUrl).pathname;
                const normalizedPath = process.platform === 'win32' && tempRawPath.startsWith('/') ? tempRawPath.substring(1) : tempRawPath;
                // Ensure we are deleting the file we possibly created with _final_raw_subs or the original if no copy
                if (fs.existsSync(normalizedPath) && (normalizedPath.includes('_final_raw_subs.') || normalizedPath === actualCaptionFilePath ) ) {
                    // Check if it's NOT the same as actualCaptionFilePath if actualCaptionFilePath was already deleted.
                    // However, the above block should handle deleting actualCaptionFilePath if it's different.
                    // This block is more for the _final_raw_subs or if finalFileUrl was directly actualCaptionFilePath
                    if (fs.existsSync(normalizedPath)){ // Re-check existence before unlinking
                       // fs.unlinkSync(normalizedPath);
                       // logger.info(`[${jobId}] Cleaned up temporary dev raw subtitle file: ${normalizedPath}`);
                       // Decided to keep this file for now as it's the finalFileUrl in dev
                    }
                }
            } catch (e) { logger.error('Error during specific dev raw subtitle file cleanup check', e); }
        }

        await job.updateProgress({ percentage: 100, stage: 'completed', message: 'Job processed successfully' });

        const jobResult: TranscriptionResult = {
          transcription: finalTranscriptionText,
          quality: qualityUsed,
          jobId: jobId,
          filePath: finalFileUrl,
        };

        if (callback_url) {
          try {
            // Construct callbackData, making response conditional
            const callbackDataPayload: Omit<CallbackData, 'response'> & { response?: { transcription_url: string } } = {
              job_id: jobId, 
              status_code: 200, 
              status_message: "success", 
              quality: qualityUsed,
            };
            if (finalFileUrl) {
              callbackDataPayload.response = { transcription_url: finalFileUrl };
            }

            jobResult.callback_success = await sendCallback(callback_url, callbackDataPayload as CallbackData);
            if (!jobResult.callback_success) jobResult.callback_error = "Failed to send callback after job completion";
          } catch (cbError: unknown) { 
             const cbErrorMessage = cbError instanceof Error ? cbError.message : String(cbError);
             jobResult.callback_error = cbErrorMessage; 
             logger.error(`[${jobId}] Error in success callback: ${cbErrorMessage}`);
          }
        }
        return jobResult;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error processing job.';
        logger.error(`[${jobId}] CRITICAL FAILURE in worker: ${errorMessage}`, error instanceof Error ? error.stack : undefined);

        if (creditsDeductedSuccessfully && userId && actualCost > 0) {
          logger.info(`[${jobId}] Initiating refund of ${actualCost} credits for user ${userId}.`);
          try {
            const refundResult = await performCreditTransaction(
              userId,
              actualCost,
              'job_failure_refund',
              { jobId: jobId, customDescription: `Refund for failed job ${jobId}: ${errorMessage.substring(0,100)}` }
            );
            if (refundResult.success) {
              logger.info(`[${jobId}] Refund success for ${userId}. Balance: ${refundResult.newBalance}`);
            } else {
              logger.error(`[${jobId}] CRITICAL: Refund failed for ${userId}: ${refundResult.error}`);
            }
          } catch (refundException: unknown) {
            const refundExcMsg = refundException instanceof Error ? refundException.message : String(refundException);
            logger.error(`[${jobId}] CRITICAL: Refund exception for ${userId}: ${refundExcMsg}`);
          }
        }
        
        const currentJob = await db.select({ status: transcriptionJobs.status }).from(transcriptionJobs).where(eq(transcriptionJobs.id, jobId)).limit(1);
        if (currentJob && currentJob[0] && currentJob[0].status !== 'failed_insufficient_credits') {
            await db.update(transcriptionJobs)
              .set({
                  status: 'failed',
                  statusMessage: creditDeductionError || errorMessage,
                  credits_charged: creditsChargedForDB,
                  video_length_minutes_actual: videoLengthMinutesActual,
                  updatedAt: new Date()
              })
              .where(eq(transcriptionJobs.id, jobId));
        } else if (!currentJob || currentJob.length === 0) {
            logger.error(`[${jobId}] Failed to retrieve job from DB during error handling.`);
        }

        if (audioPath && fs.existsSync(audioPath)) { fs.unlinkSync(audioPath); }
        if (actualCaptionFilePath && fs.existsSync(actualCaptionFilePath)) { 
          // This might be redundant if the new cleanup logic above is comprehensive
          // fs.unlinkSync(actualCaptionFilePath);
          // logger.info(`[${jobId}] Cleaned up temporary caption/text file: ${actualCaptionFilePath}`);
        }
        if (transcriptionFilePath && transcriptionFilePath !== actualCaptionFilePath && fs.existsSync(transcriptionFilePath)) {
            fs.unlinkSync(transcriptionFilePath);
        }
        
        if (callback_url) {
          try {
                const callbackErrorData: CallbackData = {
                    job_id: jobId, status_code: 500, status_message: "error",
                    quality: quality, error: errorMessage
                };
                await sendCallback(callback_url, callbackErrorData);
            } catch (cbError: unknown) {
                const cbErrorMessage = cbError instanceof Error ? cbError.message : String(cbError);
                logger.error(`[${jobId}] Error sending error callback: ${cbErrorMessage}`);
            }
        }
        throw error;
      }
    },
    {
      connection: createRedisConnection(),
      concurrency,
      autorun: true
    }
  );

  worker.on('completed', (job, result: TranscriptionResult | undefined) => {
    if (job && result) {
      if (result.error) { 
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
      logger.error(`Job ${job.id} (BullMQ state: failed) FINALIZED. Error: ${error.message}. Check logs for refund status and DB state.`);
    } else {
      logger.error(`A job FINALIZED as (BullMQ state: failed). Error: ${error.message}`);
    }
  });

  worker.on('error', (error: Error) => {
    logger.error(`Worker error: ${error.message}`);
  });

  return worker;
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing transcription queue.');
  await transcriptionQueue.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing transcription queue.');
  await transcriptionQueue.close();
  process.exit(0);
}); 