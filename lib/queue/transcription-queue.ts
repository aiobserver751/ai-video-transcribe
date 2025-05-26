import { Queue, Worker, QueueEvents } from 'bullmq';
import { createRedisConnection, QUEUE_NAMES, PRIORITY, defaultJobOptions, JOB_STATUS } from './config.ts';
import { logger } from '../logger.ts';
import path from 'path';
import fs from 'fs';
// import { pathToFileURL } from 'url'; // Removed unused import
import { transcribeAudio } from '../transcription.ts';
import { transcribeAudioWithGroq, GroqVerboseJsonResponse, extractTextFromVerboseJson } from '../groq-transcription.ts';
// import { rateLimitTracker } from '../rate-limit-tracker.ts'; // Removed unused import
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
// NEW: Import OpenAI Service
import { generateOpenAISummary } from '../../server/services/openaiService.ts';
// --- URL Utils Import ---
import { getVideoPlatform } from "@/lib/utils/urlUtils"; // REMOVED isYouTubeUrlUtil import
import { storageService, getTmpPath } from '../../lib/storageService.ts';

const execAsync = promisify(exec);

// Check if we're in build mode or Redis is disabled
const isRedisDisabled = process.env.DISABLE_REDIS_CONNECTION === 'true' || 
                       process.env.SKIP_REDIS_VALIDATION === 'true' ||
                       process.env.NODE_ENV === 'test' ||
                       process.env.NEXT_PHASE === 'phase-production-build' ||
                       process.env.BUILD_SKIP_STATIC_GENERATION === 'true';

// Lazy initialization of queues to prevent connections during build
let _transcriptionQueue: Queue<TranscriptionJobData, TranscriptionResult> | null = null;
let _transcriptionQueueEvents: QueueEvents | null = null;

// Getter for transcription queue with lazy initialization
function getTranscriptionQueue(): Queue<TranscriptionJobData, TranscriptionResult> {
  if (isRedisDisabled) {
    logger.info('Redis disabled, returning mock queue for transcription');
    // Return a mock queue object for build time
    return {
      add: () => Promise.resolve({ id: 'mock-job-id' }),
      getJob: () => Promise.resolve(null),
      close: () => Promise.resolve(),
      // Add other methods as needed for mock
    } as unknown as Queue<TranscriptionJobData, TranscriptionResult>;
  }

  if (!_transcriptionQueue) {
    _transcriptionQueue = new Queue<TranscriptionJobData, TranscriptionResult>(
      QUEUE_NAMES.TRANSCRIPTION,
      {
        connection: createRedisConnection(),
        defaultJobOptions
      }
    );
  }
  
  return _transcriptionQueue;
}

// Getter for transcription queue events with lazy initialization
function getTranscriptionQueueEvents(): QueueEvents {
  if (isRedisDisabled) {
    logger.info('Redis disabled, returning mock queue events for transcription');
    return {
      on: () => {},
      off: () => {},
      close: () => Promise.resolve(),
    } as unknown as QueueEvents;
  }

  if (!_transcriptionQueueEvents) {
    _transcriptionQueueEvents = new QueueEvents(QUEUE_NAMES.TRANSCRIPTION, {
      connection: createRedisConnection()
    });
  }
  
  return _transcriptionQueueEvents;
}

// Export getters instead of direct instances
export const transcriptionQueue = new Proxy({} as Queue<TranscriptionJobData, TranscriptionResult>, {
  get(target, prop) {
    return getTranscriptionQueue()[prop as keyof Queue<TranscriptionJobData, TranscriptionResult>];
  }
});

export const transcriptionQueueEvents = new Proxy({} as QueueEvents, {
  get(target, prop) {
    return getTranscriptionQueueEvents()[prop as keyof QueueEvents];
  }
});

// --- Helper Function to Extract Plain Text from SRT/VTT ---
function extractPlainText(content: string, format: 'srt' | 'vtt'): string {
  if (!content) return "";

  let plainText = "";

  if (format === 'vtt') {
    // VTT: Remove WEBVTT header, notes, timestamps, and cue settings
    plainText = content
      .replace(/^WEBVTT[\s\S]*?\n\n/, "") // Remove WEBVTT header and anything before the first double newline
      .replace(/NOTE[\s\S]*?\n\n/g, "")    // Remove NOTE blocks
      .replace(/\d{2}:\d{2}:\d{2}\.\d{3}\s-->\s\d{2}:\d{2}:\d{2}\.\d{3}.*\n/g, "") // Remove timestamps and cue settings
      .replace(/<[^>]+>/g, "")              // Remove HTML-like tags (e.g., <v Roger>)
      .split('\n')
      .filter(line => line.trim() !== "" && !line.match(/^\d+$/)) // Remove empty lines and VTT cue numbers if any are left
      .join(" ")                           // Join lines with spaces to form sentences/paragraphs
      .replace(/\s+/g, " ")                 // Normalize multiple spaces to single space
      .trim();
  } else if (format === 'srt') {
    // SRT: Remove sequence numbers, timestamps, and HTML-like tags
    plainText = content
      .split('\n\n') // Split into SRT blocks
      .map(block => {
        const lines = block.trim().split('\n');
        if (lines.length < 2) return ""; // Skip invalid blocks
        // Line 0: sequence number (ignore)
        // Line 1: timestamp (ignore)
        // Remaining lines: actual subtitle text
        return lines.slice(2).join(" ").replace(/<[^>]+>/g, ""); // Join text lines and remove tags
      })
      .filter(line => line.trim() !== "") // Remove empty resulting lines
      .join(" ")                          // Join blocks with spaces
      .replace(/\s+/g, " ")                // Normalize multiple spaces
      .trim();
  }
  return plainText;
}

// Job data type for transcription job
interface TranscriptionJobData {
  url: string;
  quality: 'standard' | 'premium' | 'caption_first';
  jobId: string;
  userId: string;
  fallbackOnRateLimit?: boolean;
  callback_url?: string;
  fileName?: string; // Added to pass original file name for saving outputs
  baseFileName?: string; // For naming output files consistently
  apiKey?: string; // Added for API-originated jobs
  response_format?: 'plain_text' | 'url' | 'verbose'; // Added for controlling callback response content
  summary_type?: 'none' | 'basic' | 'extended'; // NEW: For summary generation
}

// Result type for transcription job
interface TranscriptionResult {
  transcription: string; // Holds transcript or caption content
  quality: string; // The actual quality used (could be different due to fallback)
  jobId: string;
  filePath?: string; // URL to the final file (this is the primary transcription_file_url)
  srtFileUrl?: string; // URL to the SRT file
  vttFileUrl?: string; // URL to the VTT file
  srtFileText?: string; // Text content of the SRT file
  vttFileText?: string; // Text content of the VTT file
  // NEW: Summary fields
  basicSummary?: string;
  extendedSummary?: string;
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
    transcription_url?: string | null; // Primary plain text file URL
    srt_url?: string | null;           // SRT file URL
    vtt_url?: string | null;           // VTT file URL
    transcription_text?: string | null; // Plain text content
    srt_text?: string | null;           // SRT text content
    vtt_text?: string | null;           // VTT text content
    // NEW: Summary fields for callback
    basic_summary?: string | null;
    extended_summary?: string | null;
  };
  error?: string;
}

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

// Helper function to format timestamp for SRT/VTT
function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds - Math.floor(seconds)) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

// Function to generate SRT content from Groq's verbose_json
function generateSrtFromGroqVerboseJson(verboseJson: GroqVerboseJsonResponse): string {
  if (!verboseJson || !Array.isArray(verboseJson.segments)) {
    logger.warn('[generateSrt] No segments found in verbose_json for SRT generation.');
    return '';
  }
  let srtContent = '';
  verboseJson.segments.forEach((segment: GroqVerboseJsonResponse['segments'][0], index: number) => {
    const start = formatTimestamp(segment.start).replace('.', ',');
    const end = formatTimestamp(segment.end).replace('.', ',');
    srtContent += `${index + 1}\n`;
    srtContent += `${start} --> ${end}\n`;
    srtContent += `${segment.text.trim()}\n\n`;
  });
  return srtContent;
}

// Function to generate VTT content from Groq's verbose_json
function generateVttFromGroqVerboseJson(verboseJson: GroqVerboseJsonResponse): string {
  if (!verboseJson || !Array.isArray(verboseJson.segments)) {
    logger.warn('[generateVtt] No segments found in verbose_json for VTT generation.');
    return '';
  }
  let vttContent = 'WEBVTT\n\n';
  verboseJson.segments.forEach((segment: GroqVerboseJsonResponse['segments'][0]) => {
    const start = formatTimestamp(segment.start).replace(',', '.'); // VTT uses dot for millis
    const end = formatTimestamp(segment.end).replace(',', '.');     // VTT uses dot for millis
    vttContent += `${start} --> ${end}\n`;
    vttContent += `${segment.text.trim()}\n\n`;
  });
  return vttContent;
}

// Helper function to save content to storage and return its path
async function saveContentToFile(
  content: string,
  baseFileName: string,
  jobId: string,
  extension: 'txt' | 'srt' | 'vtt',
  userId: string
): Promise<{filePath: string, fileNameWithExt: string}> {
  // Use a more descriptive name
  const fileNameWithExt = `${path.basename(baseFileName, path.extname(baseFileName))}_${jobId}.${extension}`;
  
  // Storage path for user files (users/<USER_ID>/...)
  const storagePath = `users/${userId}/jobs/${jobId}/${fileNameWithExt}`;
  
  try {
    await storageService.saveFile(content, storagePath, extension === 'txt' ? 'text/plain' : 'text/plain');
    logger.info(`[${jobId}] Saved ${extension.toUpperCase()} content to storage: ${storagePath}`);
    
    // For local processing, we still need to maintain the local tmp files in the tmp dir
    const jobTmpDir = path.join(getTmpPath(), jobId);
    if (!fs.existsSync(jobTmpDir)) {
      fs.mkdirSync(jobTmpDir, { recursive: true });
    }
    
    const localFilePath = path.join(jobTmpDir, fileNameWithExt);
    // Only write to local tmp if it doesn't exist and we're in an environment that needs it
    if (!fs.existsSync(localFilePath)) {
      await fs.promises.writeFile(localFilePath, content, 'utf-8');
    }
    
    // Return the storage path for URL generation and the file name for reference
    return { filePath: storagePath, fileNameWithExt };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error(`[${jobId}] Error saving ${extension} content: ${errMsg}`);
    throw error;
  }
}

// Replace uploadToS3 function with a function to generate URLs
async function generateFileUrl(filePath: string): Promise<string> {
  try {
    return await storageService.getFileUrl(filePath);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Error generating file URL: ${errMsg}`);
    return ''; // Return empty string on error
  }
}

// Process transcription jobs
export function startTranscriptionWorker(concurrency = 5) {
  const worker = new Worker<TranscriptionJobData, TranscriptionResult>(
    QUEUE_NAMES.TRANSCRIPTION,
    async (job) => {
      const { url, quality, fallbackOnRateLimit, callback_url, jobId, userId, baseFileName, summary_type } = job.data;
      logger.info(`[${jobId}] Worker received job. URL: ${url}, Quality: ${quality}, Summary: ${summary_type}`);
      
      const platform = getVideoPlatform(url);
      logger.info(`[${jobId}] Detected platform: ${platform}`);

      // Use the tmp path from the storage service
      const tmpDir = getTmpPath();
      
      // Generate a unique part for filenames, fallback to timestamp if no common video ID pattern matches
      let videoIdForFilenameSuffix = Date.now().toString();
      if (platform === 'youtube') {
        videoIdForFilenameSuffix = url.split('v=')[1]?.split('&')[0] || url.split('youtu.be/')[1] || videoIdForFilenameSuffix;
      } else if (platform === 'tiktok') {
        try {
            const tiktokPathParts = new URL(url).pathname.split('/').filter(p => p);
            videoIdForFilenameSuffix = tiktokPathParts[tiktokPathParts.length -1] || videoIdForFilenameSuffix;
        } catch { logger.warn(`[${jobId}] Could not parse TikTok URL for filename suffix: ${url}`); } // CHANGED catch(e) to catch
      } else if (platform === 'instagram') {
        try {
            const instaPathParts = new URL(url).pathname.split('/').filter(p => p);
            if (instaPathParts.length >= 2 && instaPathParts[instaPathParts.length-2] === 'reel') {
                videoIdForFilenameSuffix = instaPathParts[instaPathParts.length-1] || videoIdForFilenameSuffix;
            }
        } catch { logger.warn(`[${jobId}] Could not parse Instagram URL for filename suffix: ${url}`); } // CHANGED catch(e) to catch
      }

      let qualityUsed = quality;
      let processingError: string | null = null;
      let transcriptionText: string | null = null;
      let srtFileTextDb: string | null = null;
      let vttFileTextDb: string | null = null;
      // NEW: Summary text variables
      let basicSummaryTextDb: string | null = null;
      let extendedSummaryTextDb: string | null = null;

      let audioPath: string | null = null;
      const filesToCleanUp: string[] = [];

      let transcriptionFileUrlDb: string | null = null;
      let srtFileUrlDb: string | null = null;
      let vttFileUrlDb: string | null = null;
      let finalFileUrl: string | null = null;
      
      let videoLengthMinutesActual: number | null = null;
      let creditsChargedForDB: number | null = null;
      let creditDeductionError: string | null = null;

      const isProduction = process.env.NODE_ENV === 'production';
      const effectiveBaseFileName = baseFileName || jobId;

      // Helper to clean up specified files if they exist
      async function cleanupFiles(files: string[]) {
        for (const file of files) {
          if (file && fs.existsSync(file)) {
            try {
              await fs.promises.unlink(file);
              logger.info(`[${jobId}] Cleaned up temp file: ${file}`);
            } catch (e) {
              logger.warn(`[${jobId}] Error cleaning up temp file ${file}: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }
      }

      try {
        // STAGE 0: Initial Platform Validation for caption_first
        if (quality === 'caption_first' && platform !== 'youtube') {
          processingError = `Job ${jobId}: 'caption_first' quality is exclusively for YouTube videos. Platform detected: ${platform}.`;
          logger.error(processingError);
          await db.update(transcriptionJobs).set({ status: 'failed', statusMessage: processingError, updatedAt: new Date() }).where(eq(transcriptionJobs.id, jobId));
          throw new Error(processingError); // Go to main catch block
        }

        // STAGE 1: Get Initial Video Metadata / Duration (Best Effort)
        logger.info(`[${jobId}] Fetching initial video metadata/duration for URL: ${url}`);
        await job.updateProgress({ percentage: 5, stage: 'metadata', message: 'Fetching video information' });
        
        let fetchedCommentCount: number | null = null; // Initialize for potential use by both paths
        const updatePayloadForDB: { video_length_minutes_actual?: number; youtubeCommentCount?: number | null; updatedAt?: Date } = {};

        if (quality === 'caption_first') { // platform is already confirmed to be 'youtube' due to STAGE 0
          try {
            const durationOutput = await execAsync(`yt-dlp --no-warnings --print duration_string --skip-download "${url}"`);
            const durationString = durationOutput.stdout.trim();
            if (durationString && durationString !== "NA") {
              const parts = durationString.split(':').map(Number);
              let durationInSeconds = 0;
              if (parts.length === 3) { durationInSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2]; }
              else if (parts.length === 2) { durationInSeconds = parts[0] * 60 + parts[1]; }
              else if (parts.length === 1) { durationInSeconds = parts[0]; }
              if (durationInSeconds > 0) {
                videoLengthMinutesActual = Math.max(1, Math.ceil(durationInSeconds / 60));
                updatePayloadForDB.video_length_minutes_actual = videoLengthMinutesActual;
                logger.info(`[${jobId}] YouTube (caption-first) initial length: ${videoLengthMinutesActual} min.`);
              } else { logger.warn(`[${jobId}] Invalid duration string (${durationString}) for YouTube (caption-first).`); }
            } else { logger.warn(`[${jobId}] Could not extract duration string for YouTube (caption-first), was: '${durationString}'.`);}
          } catch (durationError: unknown) {
            const msg = durationError instanceof Error ? durationError.message : String(durationError);
            logger.warn(`[${jobId}] Failed to get initial duration for YouTube (caption-first): ${msg}. Fixed cost applies anyway.`);
          }
          // --- NEW: Attempt to get comment_count for caption_first as well ---
          try {
            const metadataOutputCf = await execAsync(`yt-dlp -j --no-warnings "${url}"`);
            const metadataCf = JSON.parse(metadataOutputCf.stdout);
            if (metadataCf && typeof metadataCf.comment_count === 'number') {
              fetchedCommentCount = metadataCf.comment_count;
              updatePayloadForDB.youtubeCommentCount = fetchedCommentCount;
              logger.info(`[${jobId}] Extracted comment_count for caption_first: ${fetchedCommentCount}`);
            } else {
              logger.warn(`[${jobId}] Could not extract comment_count for caption_first or it was not a number. metadata.comment_count: ${metadataCf?.comment_count}`);
            }
          } catch (cfMetaError: unknown) {
            const msg = cfMetaError instanceof Error ? cfMetaError.message : String(cfMetaError);
            logger.warn(`[${jobId}] Failed to get full metadata (for comment_count) for caption_first: ${msg}. Proceeding without it.`);
          }
          // --- END NEW for caption_first ---
        } else if (quality === 'standard' || quality === 'premium') {
          // Attempt to get duration and comment_count from metadata for standard/premium
          try {
            const metadataOutput = await execAsync(`yt-dlp -j --no-warnings "${url}"`);
            const metadata = JSON.parse(metadataOutput.stdout);

            if (metadata && metadata.duration) {
              const durationInSeconds = Number(metadata.duration);
              if (!isNaN(durationInSeconds) && durationInSeconds > 0) {
                videoLengthMinutesActual = Math.max(1, Math.ceil(durationInSeconds / 60));
                updatePayloadForDB.video_length_minutes_actual = videoLengthMinutesActual;
                logger.info(`[${jobId}] Initial video length from metadata: ${videoLengthMinutesActual} minutes (Platform: ${platform}).`);
              } else { 
                logger.warn(`[${jobId}] Invalid duration (${metadata.duration}) from metadata (Platform: ${platform}). Will rely on ffprobe after download.`); 
              }
            } else {
              logger.warn(`[${jobId}] Could not extract duration from 'yt-dlp -j' metadata for URL: ${url} (Platform: ${platform}). Will rely on ffprobe after download.`);
            }

            if (metadata && typeof metadata.comment_count === 'number') {
              fetchedCommentCount = metadata.comment_count;
              updatePayloadForDB.youtubeCommentCount = fetchedCommentCount;
              logger.info(`[${jobId}] Extracted comment_count from metadata: ${fetchedCommentCount}`);
            } else {
              logger.warn(`[${jobId}] Could not extract comment_count from 'yt-dlp -j' metadata or it was not a number. metadata.comment_count: ${metadata?.comment_count}`);
            }
          } catch (metaError: unknown) {
            const msg = metaError instanceof Error ? metaError.message : String(metaError);
            logger.warn(`[${jobId}] Failed to get video metadata via 'yt-dlp -j' (Platform: ${platform}): ${msg}. Will rely on ffprobe after download.`);
          }
        }
        
        // Consolidated DB update for initial metadata (duration and/or comment count)
        if (Object.keys(updatePayloadForDB).length > 0) {
          updatePayloadForDB.updatedAt = new Date();
          await db.update(transcriptionJobs)
            .set(updatePayloadForDB)
            .where(eq(transcriptionJobs.id, jobId));
          logger.info(`[${jobId}] DB updated with initial metadata: ${JSON.stringify(updatePayloadForDB)}`);
        } else if (quality === 'caption_first' && videoLengthMinutesActual === null) {
            // Special case for caption_first: if duration couldn't be determined at all, log it / set to 0 for credits
            // This is if both duration_string and the subsequent -j attempt (if it were to set duration) failed.
            // However, videoLengthMinutesActual is primarily for credit calc for standard/premium.
            // For caption_first, credits are fixed. So this is more for record keeping if needed.
            // The existing logic for caption_first credits doesn't rely on videoLengthMinutesActual.
            // We can still store 0 if we want to signify 'N/A' or 'fetch_failed' for duration.
            await db.update(transcriptionJobs)
              .set({ video_length_minutes_actual: 0, updatedAt: new Date() })
              .where(eq(transcriptionJobs.id, jobId));
            logger.info(`[${jobId}] YouTube (caption_first) video_length_minutes_actual set to 0 in DB as initial fetch failed.`);
        }

        // STAGE 2: Credit Calculation & Deduction (Logic moved for standard/premium)
        if (quality === 'caption_first') { // Must be YouTube (platform check in STAGE 0)
          logger.info(`[${jobId}] STAGE 2: Calculating credit cost for YouTube caption_first.`);
          await job.updateProgress({ percentage: 10, stage: 'credit_check', message: 'Verifying account credits (caption_first)' });
          
          const creditSystemConfig = getCreditConfig(); // DECLARED HERE
          const actualCost = creditSystemConfig.CREDITS_CAPTION_FIRST_FIXED; // DECLARED HERE
          const transactionType: typeof creditTransactionTypeEnum.enumValues[number] = 'caption_download'; // DECLARED HERE
          
          creditsChargedForDB = actualCost;

          logger.info(`[${jobId}] Attempting to deduct ${actualCost} credits from user ${userId} for ${transactionType}.`);
          const creditResult = await performCreditTransaction(
            userId,
            actualCost,
            transactionType,
            { jobId: jobId, videoLengthMinutesCharged: videoLengthMinutesActual ?? 0 } // videoLength for caption_first is indicative
          );

          if (!creditResult.success) {
            creditDeductionError = creditResult.error || "Credit deduction failed for caption_first";
            processingError = creditDeductionError;
            logger.error(`[${jobId}] Credit deduction failed: ${processingError}`);
            await db.update(transcriptionJobs)
              .set({ status: 'failed_insufficient_credits', statusMessage: processingError, credits_charged: creditsChargedForDB, updatedAt: new Date() })
              .where(eq(transcriptionJobs.id, jobId));
            throw new Error(processingError);
          }
          logger.info(`[${jobId}] Credits deducted successfully for caption_first. New balance: ${creditResult.newBalance}`);
          await db.update(transcriptionJobs)
            .set({ status: 'processing', credits_charged: actualCost, updatedAt: new Date(), statusMessage: "Credits deducted (caption_first)." })
            .where(eq(transcriptionJobs.id, jobId));
        }
        // Credit deduction for standard/premium is now AFTER audio download and ffprobe.
        // Commenting out the old, misplaced credit deduction logic for standard/premium below:
        /*
        else if (quality === 'standard') {
          if (videoLengthMinutesActual === null) { // Should have been caught by metadata stage if not YT caption_first
            processingError = 'Video duration unknown for standard quality, cannot calculate cost.';
            throw new Error(processingError);
          }
          transactionType = 'standard_transcription';
          actualCost = calculateCreditCost('standard', videoLengthMinutesActual);
        } else if (quality === 'premium') {
           if (videoLengthMinutesActual === null) { // Should have been caught by metadata stage
            processingError = 'Video duration unknown for premium quality, cannot calculate cost.';
            throw new Error(processingError);
          }
          transactionType = 'premium_transcription';
          actualCost = calculateCreditCost('premium', videoLengthMinutesActual);
        } else {
          processingError = `Unknown quality type: ${quality}`;
          throw new Error(processingError);
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
          processingError = creditDeductionError; // Set processingError here
          logger.error(`[${jobId}] Credit deduction failed for user ${userId}: ${processingError}`);
          await db.update(transcriptionJobs)
            .set({
              status: 'failed_insufficient_credits',
              statusMessage: processingError,
              credits_charged: creditsChargedForDB, // Log what we attempted to charge
              video_length_minutes_actual: videoLengthMinutesActual,
              updatedAt: new Date()
            })
            .where(eq(transcriptionJobs.id, jobId));
          throw new Error(processingError);
        }

        logger.info(`[${jobId}] Credits deducted successfully for user ${userId}. New balance: ${creditResult.newBalance}`);
        
        await db.update(transcriptionJobs)
          .set({
            status: 'processing', // Mark as processing now that credits are secured
            credits_charged: actualCost,
            video_length_minutes_actual: videoLengthMinutesActual, // Already set earlier, but good to confirm
            updatedAt: new Date(),
            statusMessage: "Credit deduction successful. Starting main task." 
          })
          .where(eq(transcriptionJobs.id, jobId));
        */

        // STAGE 3: Actual Work (Download, Transcribe)
        if (qualityUsed === 'caption_first' && platform === 'youtube') {
          await job.updateProgress({ percentage: 20, stage: 'fetching_subtitles', message: 'Downloading YouTube subtitles.' });
          
          const captionFileBase = path.join(tmpDir, `${jobId}_${videoIdForFilenameSuffix}_caption`);
          const srtOutputName = `${captionFileBase}.en.srt`;
          const vttOutputName = `${captionFileBase}.en.vtt`;
          
          let downloadedSrtPath: string | null = null;
          let downloadedVttPath: string | null = null;
          let plainTextFromSubs: string | null = null;

          // Ensure clean slate for subtitle files
          await cleanupFiles([srtOutputName, vttOutputName]);

          // 1. Attempt to get/convert to SRT
          const srtCmd = `yt-dlp --no-warnings --write-subs --write-auto-subs --sub-lang en --convert-subs srt --skip-download -o "${captionFileBase}.%(ext)s" "${url}"`;
          logger.info(`[${jobId}:youtube_subs_srt] Executing: ${srtCmd}`);
          try {
            await execAsync(srtCmd);
            if (fs.existsSync(srtOutputName)) {
              const srtContent = await fs.promises.readFile(srtOutputName, "utf-8");
              if (srtContent && srtContent.trim().length > 0) {
                logger.info(`[${jobId}:youtube_subs_srt] SRT successfully downloaded/converted. Length: ${srtContent.length}`);
                downloadedSrtPath = srtOutputName;
                filesToCleanUp.push(downloadedSrtPath);
                srtFileTextDb = srtContent;
                plainTextFromSubs = extractPlainText(srtContent, 'srt');
                
                // Save to proper storage
                const { filePath: srtStoragePath } = await saveContentToFile(
                  srtContent,
                  effectiveBaseFileName,
                  jobId,
                  'srt',
                  userId
                );
                
                srtFileUrlDb = await generateFileUrl(srtStoragePath);
                logger.info(`[${jobId}] Caption-first: SRT file will be at ${srtFileUrlDb}`);
              } else {
                logger.warn(`[${jobId}:youtube_subs_srt] SRT file downloaded but was empty. Will attempt VTT next. Cleaning up: ${srtOutputName}`);
                await cleanupFiles([srtOutputName]); // Clean up empty SRT
              }
            } else {
              logger.info(`[${jobId}:youtube_subs_srt] No SRT file found after command execution. Will attempt VTT next.`);
            }
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.warn(`[${jobId}:youtube_subs_srt] Error during SRT download/conversion attempt: ${msg}. Will attempt VTT next.`);
            await cleanupFiles([srtOutputName]);
          }

          // 2. Attempt to get native VTT
          const vttCmd = `yt-dlp --no-warnings --write-subs --write-auto-subs --sub-lang en --sub-format vtt --skip-download -o "${captionFileBase}.%(ext)s" "${url}"`;
          logger.info(`[${jobId}:youtube_subs_vtt] Executing: ${vttCmd}`);
          try {
            // Ensure VTT output path is clean before this attempt, in case a previous run left it.
            await cleanupFiles([vttOutputName]); 
            await execAsync(vttCmd);
            if (fs.existsSync(vttOutputName)) {
              const vttContent = await fs.promises.readFile(vttOutputName, "utf-8");
              if (vttContent && vttContent.trim().length > 0) {
                logger.info(`[${jobId}:youtube_subs_vtt] VTT successfully downloaded. Length: ${vttContent.length}`);
                downloadedVttPath = vttOutputName;
                filesToCleanUp.push(downloadedVttPath);
                vttFileTextDb = vttContent;
                
                // Save to proper storage
                const { filePath: vttStoragePath } = await saveContentToFile(
                  vttContent,
                  effectiveBaseFileName,
                  jobId,
                  'vtt',
                  userId
                );
                
                vttFileUrlDb = await generateFileUrl(vttStoragePath);
                logger.info(`[${jobId}] Caption-first: VTT file will be at ${vttFileUrlDb}`);
                if (!plainTextFromSubs) { // Only use VTT for plaintext if SRT didn't yield it
                  plainTextFromSubs = extractPlainText(vttContent, 'vtt');
                }
              } else {
                logger.warn(`[${jobId}:youtube_subs_vtt] VTT file downloaded but was empty. Cleaning up: ${vttOutputName}`);
                await cleanupFiles([vttOutputName]); // Clean up empty VTT
              }
            } else {
              logger.info(`[${jobId}:youtube_subs_vtt] No VTT file found after command execution.`);
            }
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.warn(`[${jobId}:youtube_subs_vtt] Error during VTT download attempt: ${msg}.`);
            await cleanupFiles([vttOutputName]);
            if (!downloadedSrtPath) processingError = `VTT download failed after SRT attempt also failed/yielded no content. Last error: ${msg}`;
          }

          if (!plainTextFromSubs && (!downloadedSrtPath && !downloadedVttPath)) {
            processingError = processingError || "All attempts to fetch English subtitles (SRT, VTT) failed or yielded no content.";
          } else if (!plainTextFromSubs && (downloadedSrtPath || downloadedVttPath)) {
            processingError = "Subtitle files were downloaded but plain text extraction failed (or both were empty).";
          }

          if (processingError) {
            logger.error(`[${jobId}] Caption/Subtitle Error: ${processingError}`);
            throw new Error(processingError);
          }
          
          transcriptionText = plainTextFromSubs; // Assign to the main transcriptionText variable
          logger.info(`[${jobId}] Plain text extracted from YouTube subtitles. Length: ${transcriptionText?.length}.`);

          // Save the extracted plain text to a .txt file (this part was mostly fine)
          if (transcriptionText) {
            const txtFileBase = path.join(tmpDir, `${effectiveBaseFileName}_${jobId}`);
            const txtFilePath = `${txtFileBase}.txt`;
            await fs.promises.writeFile(txtFilePath, transcriptionText, 'utf-8');
            filesToCleanUp.push(txtFilePath); 
            
            // Save to proper storage
            const { filePath: txtStoragePath } = await saveContentToFile(
              transcriptionText,
              effectiveBaseFileName,
              jobId,
              'txt',
              userId
            );
            
            transcriptionFileUrlDb = await generateFileUrl(txtStoragePath);
            finalFileUrl = transcriptionFileUrlDb;
            logger.info(`[${jobId}] Caption-first plain text saved to storage. URL: ${transcriptionFileUrlDb}`);
          } else {
            logger.warn(`[${jobId}] transcriptionText was null or empty for caption_first after subtitle processing, .txt file not saved.`);
            // This might be an error condition if no plain text could be derived.
            if (!processingError) processingError = "No plain text could be derived from subtitles.";
            throw new Error(processingError || "Failed to derive plain text from subtitles.");
          }
          await job.updateProgress({ percentage: 80, stage: 'subtitles_processed', message: 'Subtitles processed.' });

        } else if (qualityUsed === 'caption_first' && platform !== 'youtube') {
            processingError = `Job ${jobId}: 'caption_first' quality is exclusively for YouTube videos. Platform detected: ${platform}.`;
            logger.error(processingError);
            await db.update(transcriptionJobs).set({ status: 'failed', statusMessage: processingError, updatedAt: new Date() }).where(eq(transcriptionJobs.id, jobId));
            throw new Error(processingError); // Go to main catch block

        } else { // 'standard' or 'premium' audio transcription
          audioPath = path.join(tmpDir, `audio_${jobId}_${videoIdForFilenameSuffix}.mp3`);
          filesToCleanUp.push(audioPath);
          logger.info(`[${jobId}] Downloading audio to ${audioPath} (Platform: ${platform}, Quality: ${qualityUsed}, URL: ${url})`);
          await job.updateProgress({ percentage: 30, stage: 'downloading_audio', message: 'Downloading audio file' });
          try {
            await execAsync(`yt-dlp -x --no-warnings --audio-format mp3 -o "${audioPath}" "${url}"`);
            if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) {
              throw new Error('Audio file not found or is empty after download attempt.');
            }
            logger.info(`[${jobId}] Audio downloaded successfully to ${audioPath}`);
          } catch (downloadError: unknown) {
            const msg = downloadError instanceof Error ? downloadError.message : String(downloadError);
            processingError = `Failed to download audio: ${msg}`;
            logger.error(`[${jobId}] Audio download error: ${processingError}`);
            throw new Error(processingError);
          }

          // --- Get duration using ffprobe ---
          logger.info(`[${jobId}] Getting precise duration using ffprobe for ${audioPath}`);
          try {
            const ffprobeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`;
            const { stdout: ffprobeOutput } = await execAsync(ffprobeCmd);
            const durationInSeconds = parseFloat(ffprobeOutput.trim());

            if (!isNaN(durationInSeconds) && durationInSeconds > 0) {
              videoLengthMinutesActual = Math.max(1, Math.ceil(durationInSeconds / 60));
              logger.info(`[${jobId}] ffprobe duration: ${durationInSeconds}s, Calculated minutes: ${videoLengthMinutesActual}`);
              await db.update(transcriptionJobs)
                .set({ video_length_minutes_actual: videoLengthMinutesActual, updatedAt: new Date() })
                .where(eq(transcriptionJobs.id, jobId));
            } else {
              if (videoLengthMinutesActual !== null) {
                logger.warn(`[${jobId}] ffprobe failed to return a valid duration. Output: ${ffprobeOutput}. Using initial metadata duration of ${videoLengthMinutesActual} min.`);
              } else {
                processingError = `Critical: ffprobe failed to return a valid duration for ${audioPath}. Output: ${ffprobeOutput}. Initial metadata duration also missing.`;
                logger.error(`[${jobId}] ${processingError}`);
                throw new Error(processingError);
              }
            }
          } catch (ffprobeError: unknown) {
            const msg = ffprobeError instanceof Error ? ffprobeError.message : String(ffprobeError);
            if (videoLengthMinutesActual !== null) {
                logger.warn(`[${jobId}] ffprobe execution failed for ${audioPath}: ${msg}. Using initial metadata duration of ${videoLengthMinutesActual} min.`);
            } else {
                processingError = `Critical: ffprobe execution failed for ${audioPath}: ${msg}. Initial metadata duration also missing.`;
                logger.error(`[${jobId}] ${processingError}`);
                throw new Error(processingError);
            }
          }
          
          // --- Credit Deduction for Standard/Premium (Now that we have reliable duration) ---
          if (videoLengthMinutesActual === null) { 
             processingError = `Critical: Video duration could not be determined for ${quality} quality after all attempts. Cannot calculate cost.`;
             logger.error(`[${jobId}] ${processingError}`);
             throw new Error(processingError);
          }

          logger.info(`[${jobId}] STAGE 2 (Deferred): Calculating credit cost for ${quality} (Platform: ${platform}, Duration: ${videoLengthMinutesActual} min).`);
          await job.updateProgress({ percentage: 40, stage: 'credit_check_audio', message: 'Verifying credits (audio job)' });
          
          let transactionTypeStdPrem: typeof creditTransactionTypeEnum.enumValues[number];
          let actualCostStdPrem: number;

          if (quality === 'standard') {
            transactionTypeStdPrem = 'standard_transcription';
            actualCostStdPrem = calculateCreditCost('standard', videoLengthMinutesActual);
          } else { // premium
            transactionTypeStdPrem = 'premium_transcription';
            actualCostStdPrem = calculateCreditCost('premium', videoLengthMinutesActual);
          }
          creditsChargedForDB = actualCostStdPrem;

          logger.info(`[${jobId}] Attempting to deduct ${actualCostStdPrem} credits from user ${userId} for ${transactionTypeStdPrem}.`);
          const creditResultStdPrem = await performCreditTransaction(
            userId,
            actualCostStdPrem,
            transactionTypeStdPrem,
            { jobId: jobId, videoLengthMinutesCharged: videoLengthMinutesActual }
          );

          if (!creditResultStdPrem.success) {
            creditDeductionError = creditResultStdPrem.error || `Credit deduction failed for ${quality}`;
            processingError = creditDeductionError;
            logger.error(`[${jobId}] Credit deduction failed: ${processingError}`);
            await db.update(transcriptionJobs)
              .set({ 
                  status: 'failed_insufficient_credits', 
                  statusMessage: processingError, 
                  credits_charged: creditsChargedForDB, 
                  video_length_minutes_actual: videoLengthMinutesActual, 
                  updatedAt: new Date() 
              })
              .where(eq(transcriptionJobs.id, jobId));
            throw new Error(processingError);
          }
          logger.info(`[${jobId}] Credits deducted successfully for ${quality}. New balance: ${creditResultStdPrem.newBalance}.`);
          await db.update(transcriptionJobs)
            .set({ 
                status: 'processing',
                credits_charged: actualCostStdPrem, 
                updatedAt: new Date(), 
                statusMessage: `Credits deducted (${quality}). Starting transcription.` 
            })
            .where(eq(transcriptionJobs.id, jobId));
          // --- End Moved Credit Deduction ---

          await job.updateProgress({ percentage: 50, stage: 'transcribing', message: 'Audio transcription in progress' });
          try {
            if (qualityUsed === 'premium') {
              logger.info(`[${jobId}] Premium Groq transcription processing...`);
              if (!process.env.GROQ_API_KEY) {
                  processingError = 'GROQ_API_KEY missing for premium transcription.';
                  throw new Error(processingError);
              }
              
              const groqVerboseJson = await transcribeAudioWithGroq(audioPath!);
              
              if (!groqVerboseJson || (groqVerboseJson.text === undefined && !groqVerboseJson.segments)) {
                processingError = 'Groq transcription returned empty or invalid verbose_json.';
                throw new Error(processingError);
              }

              // 1. Extract and save plain text
              transcriptionText = extractTextFromVerboseJson(groqVerboseJson);
              if (transcriptionText) {
                const {filePath: txtStoragePath} = await saveContentToFile(
                  transcriptionText,
                  effectiveBaseFileName,
                  jobId,
                  'txt',
                  userId
                );
                filesToCleanUp.push(txtStoragePath);
                transcriptionFileUrlDb = await generateFileUrl(txtStoragePath);
                finalFileUrl = transcriptionFileUrlDb;
                logger.info(`[${jobId}] Groq .txt content processed. URL: ${transcriptionFileUrlDb}`);
              } else {
                logger.warn(`[${jobId}] No plain text extracted from Groq verbose_json.`);
                // Decide if this is an error or if processing can continue for SRT/VTT
              }

              // 2. Generate and save SRT
              srtFileTextDb = generateSrtFromGroqVerboseJson(groqVerboseJson);
              if (srtFileTextDb) {
                const {filePath: srtStoragePath} = await saveContentToFile(
                  srtFileTextDb,
                  effectiveBaseFileName,
                  jobId,
                  'srt',
                  userId
                );
                filesToCleanUp.push(srtStoragePath);
                srtFileUrlDb = await generateFileUrl(srtStoragePath);
                logger.info(`[${jobId}] Groq .srt content processed. URL: ${srtFileUrlDb}`);
              } else {
                logger.warn(`[${jobId}] No SRT content generated from Groq verbose_json.`);
              }
              
              // 3. Generate and save VTT
              vttFileTextDb = generateVttFromGroqVerboseJson(groqVerboseJson);
              if (vttFileTextDb) {
                const {filePath: vttStoragePath} = await saveContentToFile(
                  vttFileTextDb,
                  effectiveBaseFileName,
                  jobId,
                  'vtt',
                  userId
                );
                filesToCleanUp.push(vttStoragePath);
                vttFileUrlDb = await generateFileUrl(vttStoragePath);
                logger.info(`[${jobId}] Groq .vtt content processed. URL: ${vttFileUrlDb}`);
              } else {
                logger.warn(`[${jobId}] No VTT content generated from Groq verbose_json.`);
              }

            } else { // 'standard' or caption_first (non-Groq)
              logger.info(`[${jobId}] Standard Whisper transcription processing...`);
              const whisperResult = await transcribeAudio(audioPath!); 
              
              filesToCleanUp.push(whisperResult.txtPath, whisperResult.srtPath, whisperResult.vttPath);
              
              // Read file contents for standard Whisper
              transcriptionText = await fs.promises.readFile(whisperResult.txtPath, 'utf-8');
              
              // Read SRT file
              let srtContent = null;
              if (fs.existsSync(whisperResult.srtPath)) {
                srtContent = await fs.promises.readFile(whisperResult.srtPath, 'utf-8');
                srtFileTextDb = srtContent;
              } else {
                logger.warn(`[${jobId}] Standard Whisper: SRT file not found at ${whisperResult.srtPath}`);
              }
              
              // Read VTT file
              let vttContent = null;
              if (fs.existsSync(whisperResult.vttPath)) {
                vttContent = await fs.promises.readFile(whisperResult.vttPath, 'utf-8');
                vttFileTextDb = vttContent;
              } else {
                logger.warn(`[${jobId}] Standard Whisper: VTT file not found at ${whisperResult.vttPath}`);
              }
              
              // Save the files to storage and get URLs
              
              // Save TXT file
              const { filePath: txtStoragePath } = await saveContentToFile(
                transcriptionText,
                effectiveBaseFileName,
                jobId,
                'txt',
                userId
              );
              transcriptionFileUrlDb = await generateFileUrl(txtStoragePath);
              
              // Save SRT file if available
              if (srtContent) {
                const { filePath: srtStoragePath } = await saveContentToFile(
                  srtContent,
                  effectiveBaseFileName,
                  jobId,
                  'srt',
                  userId
                );
                srtFileUrlDb = await generateFileUrl(srtStoragePath);
              }
              
              // Save VTT file if available
              if (vttContent) {
                const { filePath: vttStoragePath } = await saveContentToFile(
                  vttContent,
                  effectiveBaseFileName,
                  jobId,
                  'vtt',
                  userId
                );
                vttFileUrlDb = await generateFileUrl(vttStoragePath);
              }
              
              finalFileUrl = transcriptionFileUrlDb; // TXT content is the primary for standard whisper

              logger.info(`[${jobId}] Standard Whisper processed. URLs: TXT: ${transcriptionFileUrlDb}, SRT: ${srtFileUrlDb}, VTT: ${vttFileUrlDb}`);
            }
          } catch (transcriptionError: unknown) {
            const transcriptionErrorMessage = transcriptionError instanceof Error ? transcriptionError.message : String(transcriptionError);
            processingError = `Audio transcription failed: ${transcriptionErrorMessage}`;
            logger.error(`[${jobId}] Transcription error: ${processingError}`);
            
            if (quality === 'premium' && fallbackOnRateLimit && (transcriptionErrorMessage.includes('rate_limit_exceeded') || transcriptionErrorMessage.includes('Groq API error') || transcriptionErrorMessage.includes('Groq transcription result file path is invalid'))) {
                logger.warn(`[${jobId}] Groq premium failed/rate-limited, attempting fallback to standard Whisper.`);
                qualityUsed = 'standard'; 
                await job.updateProgress({ percentage: 55, stage: 'transcribing_fallback', message: 'Groq failed, falling back to standard Whisper.' });
                
                const whisperResultFallback = await transcribeAudio(audioPath!);
                filesToCleanUp.push(whisperResultFallback.txtPath, whisperResultFallback.srtPath, whisperResultFallback.vttPath);
                
                // Read file contents
                transcriptionText = await fs.promises.readFile(whisperResultFallback.txtPath, 'utf-8');
                
                // Read SRT file
                let fallbackSrtContent = null;
                if (fs.existsSync(whisperResultFallback.srtPath)) {
                  fallbackSrtContent = await fs.promises.readFile(whisperResultFallback.srtPath, 'utf-8');
                  srtFileTextDb = fallbackSrtContent;
                }
                
                // Read VTT file
                let fallbackVttContent = null;
                if (fs.existsSync(whisperResultFallback.vttPath)) {
                  fallbackVttContent = await fs.promises.readFile(whisperResultFallback.vttPath, 'utf-8');
                  vttFileTextDb = fallbackVttContent;
                }
                
                // Save the files to storage and get URLs
                
                // Save TXT file
                const { filePath: fallbackTxtStoragePath } = await saveContentToFile(
                  transcriptionText,
                  effectiveBaseFileName,
                  jobId,
                  'txt',
                  userId
                );
                transcriptionFileUrlDb = await generateFileUrl(fallbackTxtStoragePath);
                
                // Save SRT file if available
                if (fallbackSrtContent) {
                  const { filePath: fallbackSrtStoragePath } = await saveContentToFile(
                    fallbackSrtContent,
                    effectiveBaseFileName,
                    jobId,
                    'srt',
                    userId
                  );
                  srtFileUrlDb = await generateFileUrl(fallbackSrtStoragePath);
                }
                
                // Save VTT file if available
                if (fallbackVttContent) {
                  const { filePath: fallbackVttStoragePath } = await saveContentToFile(
                    fallbackVttContent,
                    effectiveBaseFileName,
                    jobId,
                    'vtt',
                    userId
                  );
                  vttFileUrlDb = await generateFileUrl(fallbackVttStoragePath);
                }
                
                finalFileUrl = transcriptionFileUrlDb;
                logger.info(`[${jobId}] Fallback to Standard Whisper processed. URLs set. TXT: ${transcriptionFileUrlDb}`);
                processingError = null; // Clear previous Groq error as fallback succeeded
            } else {
                throw new Error(processingError); 
            }
          }
        }

        // Ensure transcriptionText is not null before proceeding to summary
        if (!processingError && (!transcriptionText || transcriptionText.trim() === "")) {
          processingError = 'Transcription result is empty or was not generated. Cannot generate summary.';
          logger.error(`[${jobId}] ${processingError}`);
          // No need to throw here if we want to record the transcription failure but not attempt summary
          // However, the user requirement is: if summary fails, job fails. 
          // If transcription fails, summary cannot happen, so job should fail.
          // The existing logic already throws if transcriptionText is empty later, so this is a pre-check.
        }

        // NEW STAGE: Summary Generation
        if (!processingError && summary_type && summary_type !== 'none' && transcriptionText && transcriptionText.trim() !== "") {
          logger.info(`[${jobId}] Starting ${summary_type} summary generation.`);
          await job.updateProgress({ percentage: 85, stage: 'generating_summary', message: `Generating ${summary_type} summary...` });

          try {
            const creditSystemConf = getCreditConfig();

            let summaryCreditCost = 0;
            let summaryTransactionType: typeof creditTransactionTypeEnum.enumValues[number];

            if (summary_type === 'basic') {
              summaryCreditCost = creditSystemConf.CREDITS_BASIC_SUMMARY_FIXED; // Using value from getCreditConfig
              summaryTransactionType = 'basic_summary';
            } else { // extended
              summaryCreditCost = creditSystemConf.CREDITS_EXTENDED_SUMMARY_FIXED; // Using value from getCreditConfig
              summaryTransactionType = 'extended_summary';
            }
            
            logger.info(`[${jobId}] Attempting to deduct ${summaryCreditCost} credits for ${summary_type} summary from user ${userId}.`);
            const summaryCreditResult = await performCreditTransaction(
              userId,
              summaryCreditCost,
              summaryTransactionType,
              { jobId: jobId } // Add relevant metadata if needed
            );

            if (!summaryCreditResult.success) {
              const summaryCreditError = summaryCreditResult.error || `Credit deduction failed for ${summary_type} summary.`;
              logger.error(`[${jobId}] ${summaryCreditError}`);
              processingError = summaryCreditError; // Critical error, job must fail
              // Update DB immediately to reflect this specific failure reason
              await db.update(transcriptionJobs).set({
                status: 'failed_insufficient_credits', // Or a more generic 'failed' with specific message
                statusMessage: `Summary generation failed: ${processingError}`,
                updatedAt: new Date()
              }).where(eq(transcriptionJobs.id, jobId));
              throw new Error(processingError); // This will be caught by the main catch block
            }
            logger.info(`[${jobId}] Credits deducted successfully for ${summary_type} summary. New balance: ${summaryCreditResult.newBalance}.`);
            
            // Add to total credits charged for the job
            if (creditsChargedForDB !== null) {
                creditsChargedForDB += summaryCreditCost;
            } else {
                creditsChargedForDB = summaryCreditCost; // Should not happen if transcription credits were charged
            }


            const generatedSummary = await generateOpenAISummary(transcriptionText!, summary_type as 'basic' | 'extended');
            
            if (summary_type === 'basic') {
              basicSummaryTextDb = generatedSummary;
            } else {
              extendedSummaryTextDb = generatedSummary;
            }
            logger.info(`[${jobId}] ${summary_type} summary generated successfully. Length: ${generatedSummary.length}`);
            await job.updateProgress({ percentage: 90, stage: 'summary_completed', message: 'Summary generated.'});

          } catch (summaryError: unknown) {
            const summaryErrorMessage = summaryError instanceof Error ? summaryError.message : String(summaryError);
            logger.error(`[${jobId}] Error during ${summary_type} summary generation stage: ${summaryErrorMessage}`);
            processingError = `Summary generation failed: ${summaryErrorMessage}`;
            // Job must fail if summary fails. This error will be caught by the main catch block.
            // Update DB immediately for clarity on failure point
             await db.update(transcriptionJobs).set({
                status: 'failed',
                statusMessage: processingError,
                updatedAt: new Date()
              }).where(eq(transcriptionJobs.id, jobId));
            throw new Error(processingError);
          }
        } else if (summary_type && summary_type !== 'none' && (!transcriptionText || transcriptionText.trim() === "")) {
            logger.warn(`[${jobId}] Summary (${summary_type}) requested, but transcription text is empty. Skipping summary generation.`);
            // This scenario implies transcription failed to produce text, which should already be handled / lead to job failure.
            // If somehow transcriptionText is empty but no processingError, we mark job as failed here too.
            if (!processingError) {
                processingError = "Transcription text was empty, summary could not be generated.";
                logger.error(`[${jobId}] ${processingError}`);
                 await db.update(transcriptionJobs).set({ // Ensure job is marked failed
                    status: 'failed',
                    statusMessage: processingError,
                    updatedAt: new Date()
                }).where(eq(transcriptionJobs.id, jobId));
                throw new Error(processingError); // Go to main catch
            }
        }


        // STAGE 4: Finalize and Cleanup
        if (processingError) { throw new Error(processingError); }
        if (!transcriptionText || transcriptionText.trim() === "") { 
          processingError = 'Transcription result is empty or was not generated.';
          throw new Error(processingError);
        }
        logger.info(`[${jobId}] Finalizing job. Plain text length: ${transcriptionText.length}.`);
        await job.updateProgress({ percentage: 90, stage: 'finalizing', message: 'Preparing results' });
        if (!finalFileUrl && transcriptionFileUrlDb) {
            finalFileUrl = transcriptionFileUrlDb;
        } else if (!finalFileUrl && !transcriptionFileUrlDb && (srtFileUrlDb || vttFileUrlDb)) {
            const potentialFallbackUrl = srtFileUrlDb || vttFileUrlDb;
            finalFileUrl = potentialFallbackUrl;
            if (finalFileUrl) transcriptionFileUrlDb = finalFileUrl; 
        } else if (!finalFileUrl) {
            logger.warn(`[${jobId}] finalFileUrl is not set after processing. This might impact callback.`)
        }
          await db.update(transcriptionJobs).set({
            userId,
            quality: qualityUsed,
            status: 'completed', // If we reach here, it's completed
            statusMessage: null,  // Clear any previous non-critical messages
            transcriptionFileUrl: transcriptionFileUrlDb || null,
            srtFileUrl: srtFileUrlDb || null,
            vttFileUrl: vttFileUrlDb || null,
            transcriptionText: transcriptionText || null,
            srt_file_text: srtFileTextDb || null,
            vtt_file_text: vttFileTextDb || null,
            // NEW: Add summary text to DB
            basicSummary: basicSummaryTextDb || null,
            extendedSummary: extendedSummaryTextDb || null,
            updatedAt: new Date(),
            video_length_minutes_actual: videoLengthMinutesActual,
            credits_charged: creditsChargedForDB, // This now includes summary credits if any
          }).where(eq(transcriptionJobs.id, jobId));
        logger.info(`[${jobId}] Finished processing job. Status: completed`);
        await job.updateProgress({ percentage: 100, stage: 'completed', message: 'Job processed successfully' });
        
        const jobResult: TranscriptionResult = {
          transcription: transcriptionText!, 
          quality: qualityUsed,
          jobId: jobId,
          filePath: finalFileUrl === null ? undefined : finalFileUrl,
          srtFileUrl: srtFileUrlDb === null ? undefined : srtFileUrlDb,
          vttFileUrl: vttFileUrlDb === null ? undefined : vttFileUrlDb,
          srtFileText: srtFileTextDb === null ? undefined : srtFileTextDb,
          vttFileText: vttFileTextDb === null ? undefined : vttFileTextDb,
          // NEW: Add summary text to job result
          basicSummary: basicSummaryTextDb === null ? undefined : basicSummaryTextDb,
          extendedSummary: extendedSummaryTextDb === null ? undefined : extendedSummaryTextDb,
        };
        if (callback_url) {
          try {
            const jobResponseFormat = job.data.response_format || 'verbose'; // Default to verbose if undefined
            let callbackResponsePayload: CallbackData['response'] = {}; // Initialize as empty object

            if (jobResponseFormat === 'verbose') {
              callbackResponsePayload = {
                transcription_url: finalFileUrl || null,
                srt_url: srtFileUrlDb || null,
                vtt_url: vttFileUrlDb || null,
                transcription_text: transcriptionText || null,
                srt_text: srtFileTextDb || null,
                vtt_text: vttFileTextDb || null,
                // NEW: Add summaries to verbose callback
                basic_summary: basicSummaryTextDb || null,
                extended_summary: extendedSummaryTextDb || null,
              };
            } else if (jobResponseFormat === 'url') {
              callbackResponsePayload = {
                transcription_url: finalFileUrl || null,
                srt_url: srtFileUrlDb || null,
                vtt_url: vttFileUrlDb || null,
              };
            } else if (jobResponseFormat === 'plain_text') {
              callbackResponsePayload = {
                transcription_text: transcriptionText || null,
                srt_text: srtFileTextDb || null,
                vtt_text: vttFileTextDb || null,
                // NEW: Add summaries to plain_text callback
                basic_summary: basicSummaryTextDb || null,
                extended_summary: extendedSummaryTextDb || null,
              };
            }

            const callbackDataToSend: CallbackData = {
              job_id: jobId, 
              status_code: 200, 
              status_message: "success", 
              quality: qualityUsed,
              response: Object.keys(callbackResponsePayload).length > 0 ? callbackResponsePayload : undefined,
            };
            
            jobResult.callback_success = await sendCallback(callback_url, callbackDataToSend);
            if (!jobResult.callback_success) {
                jobResult.callback_error = "Failed to send callback after job completion";
                logger.warn(`[${jobId}] Callback POST failed: ${jobResult.callback_error}`);
            }
          } catch (cbError: unknown) { 
             const cbErrorMessage = cbError instanceof Error ? cbError.message : String(cbError);
             jobResult.callback_error = cbErrorMessage; 
             logger.error(`[${jobId}] Error in success callback: ${cbErrorMessage}`);
          }
        }
        return jobResult;
      } catch (error: unknown) {
        let errorMessage: string;
        if (error instanceof Error) {
          errorMessage = error.message;
        } else if (typeof error === 'string') {
          errorMessage = error;
        } else {
          errorMessage = 'An unknown error occurred during job processing.';
        }
        // Ensure processingError variable reflects the caught error for DB update
        processingError = errorMessage; 
        logger.error(`[${jobId}] Unhandled error in worker:`, error);
        try {
          await db.update(transcriptionJobs).set({
            status: 'failed',
            statusMessage: processingError, // Use the caught error message
            updatedAt: new Date(),
            transcriptionFileUrl: transcriptionFileUrlDb || null,
            srtFileUrl: srtFileUrlDb || null,
            vttFileUrl: vttFileUrlDb || null,
            transcriptionText: transcriptionText || null, // Log what we had, if anything
            srt_file_text: srtFileTextDb || null,
            vtt_file_text: vttFileTextDb || null,
            // NEW: Log summary text even on failure, if generated before error
            basicSummary: basicSummaryTextDb || null,
            extendedSummary: extendedSummaryTextDb || null,
            video_length_minutes_actual: videoLengthMinutesActual,
            credits_charged: creditsChargedForDB,
          }).where(eq(transcriptionJobs.id, jobId));
        } catch (dbError) {
          logger.error(`[${jobId}] FATAL: Could not update job status to failed in DB after unhandled error:`, dbError);
        }
        throw new Error(processingError ?? 'Job failed with an unspecified error');
      } finally {
        // Only clean up files in production. In development, files remain in /tmp for inspection via file:/// URLs.
        if (isProduction && filesToCleanUp.length > 0) { 
            logger.info(`[${jobId}] Production mode: Cleaning up temporary files: ${filesToCleanUp.join(', ')}`);
            for (const file of filesToCleanUp) {
              try {
                if (fs.existsSync(file)) {
                  await fs.promises.unlink(file);
                  logger.info(`[${jobId}] Deleted temp file: ${file}`);
                }
              } catch (cleanupError: unknown) {
                logger.error(`[${jobId}] Error deleting temp file ${file}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
              }
            }
        } else if (!isProduction && filesToCleanUp.length > 0) {
            logger.info(`[${jobId}] Development mode: Skipping cleanup of temporary files in ${tmpDir}: ${filesToCleanUp.join(', ')}`);
        }
        logger.info(`[${jobId}] Worker processing finished.`);
      }
    },
    {
      connection: createRedisConnection(),
      concurrency,
      autorun: true // Assuming this should be true to start processing jobs automatically
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
      logger.warn(`Job ${job.id} completed but result object is missing or malformed.`);
    }
  });

  worker.on('failed', (job, error) => {
    if (job) {
      logger.error(`Job ${job.id} (BullMQ state: failed) FINALIZED. Error: ${error.message}.`);
    } else {
      logger.error(`A job FINALIZED as (BullMQ state: failed). Error: ${error.message}`);
    }
  });

  worker.on('error', (error: Error) => {
    logger.error(`Worker error: ${error.message}`);
  });

  return worker; // Return the worker instance if it needs to be managed externally
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing transcription queue.');
  await transcriptionQueue.close();
  // Add closing for worker if necessary, though BullMQ handles it with queue.close()
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing transcription queue.');
  await transcriptionQueue.close();
  process.exit(0);
}); 