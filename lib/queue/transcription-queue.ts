import { Queue, Worker, QueueEvents, FlowProducer } from 'bullmq';
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

const execAsync = promisify(exec);

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

// --- New Function to Fetch YouTube Subtitles (SRT, VTT, PlainText) ---
async function fetchYouTubeSubtitles(
  jobId: string,
  url: string,
  baseOutputName: string // e.g., /tmp/jobId_videoId
): Promise<{
  plainText: string | null;
  srtFilePath: string | null;
  vttFilePath: string | null;
  rawSourceFilePath: string | null; // The file that was used as the source for plainText
  rawSourceFormat: 'srt' | 'vtt' | null;
  error?: string;
}> {
  logger.info(`[${jobId}:youtube_subs] Starting subtitle download for ${url}`);
  const srtOutputName = `${baseOutputName}.en.srt`;
  const vttOutputName = `${baseOutputName}.en.vtt`;
  let downloadedSrtPath: string | null = null;
  let downloadedVttPath: string | null = null;
  let plainTextResult: string | null = null; // Renamed to avoid conflict with plainText in outer scope
  let rawSourceFilePathResult: string | null = null;
  let rawSourceFormatResult: 'srt' | 'vtt' | null = null;
  let operationError: string | undefined;

  // Ensure clean slate
  for (const file of [srtOutputName, vttOutputName]) {
    if (fs.existsSync(file)) {
      try { await fs.promises.unlink(file); } catch { /* ignore unlink error */ }
    }
  }

  // 1. Attempt to get/convert to SRT
  const srtCmd = `yt-dlp --no-warnings --write-subs --write-auto-subs --sub-lang en --convert-subs srt --skip-download -o "${baseOutputName}.%(ext)s" "${url}"`;
  logger.info(`[${jobId}:youtube_subs_srt] Executing: ${srtCmd}`);
  try {
    await execAsync(srtCmd);
    if (fs.existsSync(srtOutputName)) {
      const srtContent = await fs.promises.readFile(srtOutputName, "utf-8");
      if (srtContent && srtContent.trim().length > 0) {
        logger.info(`[${jobId}:youtube_subs_srt] SRT successfully downloaded/converted. Length: ${srtContent.length}`);
        downloadedSrtPath = srtOutputName;
        rawSourceFilePathResult = srtOutputName;
        rawSourceFormatResult = 'srt';
        plainTextResult = extractPlainText(srtContent, 'srt');
      } else {
        logger.warn(`[${jobId}:youtube_subs_srt] SRT file downloaded but was empty. Will attempt VTT next. Cleaning up: ${srtOutputName}`);
        try { await fs.promises.unlink(srtOutputName); } catch { /* ignore unlink error of empty file */ }
      }
    } else {
      logger.info(`[${jobId}:youtube_subs_srt] No SRT file found after command execution. Will attempt VTT next.`);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(`[${jobId}:youtube_subs_srt] Error during SRT download/conversion attempt: ${msg}. Will attempt VTT next.`);
    if (fs.existsSync(srtOutputName)) { try { await fs.promises.unlink(srtOutputName); } catch { /* ignore unlink error */ } }
  }

  // 2. Attempt to get native VTT
  const vttCmd = `yt-dlp --no-warnings --write-subs --write-auto-subs --sub-lang en --sub-format vtt --skip-download -o "${baseOutputName}.%(ext)s" "${url}"`;
  logger.info(`[${jobId}:youtube_subs_vtt] Executing: ${vttCmd}`);
  try {
    if (fs.existsSync(vttOutputName)) { try { await fs.promises.unlink(vttOutputName); } catch { /* ignore unlink error */ } } // Clean up before attempting VTT
    await execAsync(vttCmd);
    if (fs.existsSync(vttOutputName)) {
      const vttContent = await fs.promises.readFile(vttOutputName, "utf-8");
      if (vttContent && vttContent.trim().length > 0) {
        logger.info(`[${jobId}:youtube_subs_vtt] VTT successfully downloaded. Length: ${vttContent.length}`);
        downloadedVttPath = vttOutputName;
        if (!plainTextResult) { // Only use VTT for plaintext if SRT didn't yield it
          plainTextResult = extractPlainText(vttContent, 'vtt');
          rawSourceFilePathResult = vttOutputName;
          rawSourceFormatResult = 'vtt';
        }
      } else {
        logger.warn(`[${jobId}:youtube_subs_vtt] VTT file downloaded but was empty. Cleaning up: ${vttOutputName}`);
        try { await fs.promises.unlink(vttOutputName); } catch { /* ignore unlink error of empty file */ }
      }
    } else {
      logger.info(`[${jobId}:youtube_subs_vtt] No VTT file found after command execution.`);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(`[${jobId}:youtube_subs_vtt] Error during VTT download attempt: ${msg}.`);
    if (fs.existsSync(vttOutputName)) { try { await fs.promises.unlink(vttOutputName); } catch { /* ignore unlink error */ } }
    if (!downloadedSrtPath) operationError = `VTT download failed after SRT attempt also failed/yielded no content. Last error: ${msg}`;
  }

  if (!plainTextResult && (!downloadedSrtPath && !downloadedVttPath)) { // If no text AND no files, it's a full failure
    operationError = operationError || "All attempts to fetch English subtitles (SRT, VTT) failed or yielded no content.";
  } else if (!plainTextResult && (downloadedSrtPath || downloadedVttPath)) { // Files exist but text extraction failed (highly unlikely with current extractPlainText)
    operationError = "Subtitle files were downloaded but plain text extraction failed.";
  }


  if (operationError) {
    logger.error(`[${jobId}:youtube_subs] ${operationError}`);
    return {
      plainText: null, srtFilePath: downloadedSrtPath, vttFilePath: downloadedVttPath, // Return paths even if text extraction fails, for potential manual inspection
      rawSourceFilePath: rawSourceFilePathResult, rawSourceFormat: rawSourceFormatResult, error: operationError
    };
  }
  
  logger.info(`[${jobId}:youtube_subs] Subtitle processing complete. SRT: ${downloadedSrtPath}, VTT: ${downloadedVttPath}, PlainText derived from: ${rawSourceFormatResult}`);
  return {
    plainText: plainTextResult,
    srtFilePath: downloadedSrtPath,
    vttFilePath: downloadedVttPath,
    rawSourceFilePath: rawSourceFilePathResult,
    rawSourceFormat: rawSourceFormatResult,
  };
}

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
  quality: 'standard' | 'premium' | 'caption_first';
  jobId: string;
  userId: string;
  fallbackOnRateLimit?: boolean;
  callback_url?: string;
  fileName?: string; // Added to pass original file name for saving outputs
  baseFileName?: string; // For naming output files consistently
  apiKey?: string; // Added for API-originated jobs
  response_format?: 'plain_text' | 'url' | 'verbose'; // Added for controlling callback response content
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

// Helper function to save content to a temp file and return its path
// (Reusing a modified version of saveTranscriptionToFile from groq-transcription.ts for consistency,
// but this could be a more generic utility)
async function saveContentToFile(
  content: string,
  baseFileName: string, // baseFileName from jobData, e.g., original video name
  jobId: string,
  extension: 'txt' | 'srt' | 'vtt'
): Promise<{filePath: string, fileNameWithExt: string}> {
  const outputDir = path.join(process.cwd(), 'tmp', jobId); // Store in a job-specific subfolder
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  // Use a more descriptive name
  const fileNameWithExt = `${path.basename(baseFileName, path.extname(baseFileName))}_${jobId}.${extension}`;
  const filePath = path.join(outputDir, fileNameWithExt);
  await fs.promises.writeFile(filePath, content, 'utf-8');
  logger.info(`[${jobId}] Saved ${extension.toUpperCase()} content to: ${filePath}`);
  return {filePath, fileNameWithExt};
}

// Process transcription jobs
export function startTranscriptionWorker(concurrency = 5) {
  const worker = new Worker<TranscriptionJobData, TranscriptionResult>(
    QUEUE_NAMES.TRANSCRIPTION,
    async (job) => {
      const { url, quality, fallbackOnRateLimit, callback_url, jobId, userId, baseFileName } = job.data;
      logger.info(`[${jobId}] Worker received job. Quality: ${quality}, URL: ${url}`);
      
      const tmpDir = path.join(process.cwd(), 'tmp');
      const videoIdForFilename = url.split('v=')[1]?.split('&')[0] || url.split('youtu.be/')[1] || Date.now().toString();

      let qualityUsed = quality;
      let processingError: string | null = null;
      let transcriptionText: string | null = null;
      let srtFileTextDb: string | null = null;
      let vttFileTextDb: string | null = null;

      let audioPath: string | null = null;
      const filesToCleanUp: string[] = [];

      let transcriptionFileUrlDb: string | null = null;
      let srtFileUrlDb: string | null = null;
      let vttFileUrlDb: string | null = null;
      let finalFileUrl: string | null = null;
      
      let videoLengthMinutesActual: number | null = null;
      let creditsChargedForDB: number | null = null;
      let actualCost = 0;
      let creditDeductionError: string | null = null;

      const isProduction = process.env.NODE_ENV === 'production';
      const effectiveBaseFileName = baseFileName || jobId; // Use baseFileName or fallback to jobId

      // Placeholder for S3 upload logic - assume it's defined elsewhere
      async function uploadToS3(filePath: string, s3Key: string): Promise<string> {
        logger.info(`[${jobId}] Placeholder: Uploading ${filePath} to S3 as ${s3Key}`);
        // In a real scenario, this would involve AWS SDK to upload the file
        // and return the S3 URL (e.g., `https://your-bucket.s3.amazonaws.com/${s3Key}`)
        return `s3://placeholder-bucket/${s3Key}`; // Return a placeholder S3 URL
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
          if (!isYouTube) {
            logger.warn(`[${jobId}] Processing 'caption_first' for a non-YouTube URL: ${url}. This is not the intended path.`);
          }
          transactionType = 'caption_download';
          actualCost = creditSystemConfig.CREDITS_CAPTION_FIRST_FIXED;
        } else if (quality === 'standard') {
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


        // STAGE 3: Actual Work
        const timestamp = Date.now();

        if (qualityUsed === 'caption_first' && isYouTubeUrl(url)) {
          await job.updateProgress({ percentage: 20, stage: 'fetching_subtitles', message: 'Downloading YouTube subtitles.' });
          const captionFileBaseName = path.join(tmpDir, `${jobId}_${videoIdForFilename}_caption`);
          const subResult = await fetchYouTubeSubtitles(jobId, url, captionFileBaseName);
          
          if (subResult.error || !subResult.plainText) {
            processingError = subResult.error || 'Failed to fetch/process subtitles, or no plain text extracted.';
            logger.error(`[${jobId}] Caption/Subtitle Error: ${processingError}`);
            if (subResult.srtFilePath && fs.existsSync(subResult.srtFilePath)) filesToCleanUp.push(subResult.srtFilePath);
            if (subResult.vttFilePath && fs.existsSync(subResult.vttFilePath)) filesToCleanUp.push(subResult.vttFilePath);
            throw new Error(processingError);
          }
          
          transcriptionText = subResult.plainText;
          logger.info(`[${jobId}] Plain text extracted from YouTube subtitles. Length: ${transcriptionText?.length}.`);

          // Save the extracted plain text to a .txt file
          if (transcriptionText) {
            const {filePath: txtFilePath, fileNameWithExt: txtFileName} = await saveContentToFile(
              transcriptionText,
              effectiveBaseFileName, // Use the same base name as other quality types
              jobId,
              'txt'
            );
            filesToCleanUp.push(txtFilePath); // Add to cleanup
            transcriptionFileUrlDb = isProduction
              ? await uploadToS3(txtFilePath, `transcriptions/${jobId}/${txtFileName}`) // Placeholder for S3
              : `file://${txtFilePath}`; // Use absolute path for local
            finalFileUrl = transcriptionFileUrlDb;
            logger.info(`[${jobId}] Caption-first plain text saved to ${txtFilePath}. URL: ${transcriptionFileUrlDb}`);
          } else {
            // This case should ideally be caught by the error check above, 
            // but if not, transcriptionFileUrlDb will remain null.
            logger.warn(`[${jobId}] transcriptionText was null or empty for caption_first, .txt file not saved.`);
          }

          // Keep SRT and VTT URLs if available
          if (subResult.srtFilePath) {
            filesToCleanUp.push(subResult.srtFilePath);
            // Read SRT content if path exists
            if (fs.existsSync(subResult.srtFilePath)) {
              srtFileTextDb = await fs.promises.readFile(subResult.srtFilePath, 'utf-8');
            } else {
              logger.warn(`[${jobId}] Caption-first: SRT file path present in subResult but file not found at ${subResult.srtFilePath}`);
            }
            const srtFileName = path.basename(subResult.srtFilePath); 
            srtFileUrlDb = isProduction 
              ? await uploadToS3(subResult.srtFilePath, `transcriptions/${jobId}/${srtFileName}`) // Placeholder for S3
              : `file://${subResult.srtFilePath}`;
            logger.info(`[${jobId}] Caption-first: SRT file will be at ${srtFileUrlDb}`);
          }
          if (subResult.vttFilePath) {
            filesToCleanUp.push(subResult.vttFilePath);
            // Read VTT content if path exists
            if (fs.existsSync(subResult.vttFilePath)) {
              vttFileTextDb = await fs.promises.readFile(subResult.vttFilePath, 'utf-8');
            } else {
              logger.warn(`[${jobId}] Caption-first: VTT file path present in subResult but file not found at ${subResult.vttFilePath}`);
            }
            const vttFileName = path.basename(subResult.vttFilePath);
            vttFileUrlDb = isProduction
              ? await uploadToS3(subResult.vttFilePath, `transcriptions/${jobId}/${vttFileName}`) // Placeholder for S3
              : `file://${subResult.vttFilePath}`;
            logger.info(`[${jobId}] Caption-first: VTT file will be at ${vttFileUrlDb}`);
          }
          
          // The old logic for setting transcriptionFileUrlDb from rawSourceFilePath is now replaced
          // by the explicit .txt file saving block above.

          await job.updateProgress({ percentage: 80, stage: 'subtitles_processed', message: 'Subtitles processed.' });

        } else if (qualityUsed === 'caption_first' && !isYouTubeUrl(url)) {
            processingError = `Job ${jobId}: 'caption_first' quality is only supported for YouTube URLs. Received: ${url}`;
            logger.error(processingError);
            throw new Error(processingError);

        } else { // 'standard' or 'premium' audio transcription
          audioPath = path.join(tmpDir, `audio_${jobId}_${timestamp}.mp3`);
          filesToCleanUp.push(audioPath);
          logger.info(`[${jobId}] Downloading audio for transcription to ${audioPath} (Quality: ${qualityUsed}, URL: ${url})`);
          await job.updateProgress({ percentage: 30, stage: 'downloading_audio', message: 'Downloading audio file' });
          try {
            await execAsync(`yt-dlp -x --no-warnings --audio-format mp3 -o "${audioPath}" "${url}"`);
            if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) {
              throw new Error('Audio file not found or is empty after download attempt.');
            }
            logger.info(`[${jobId}] Audio downloaded successfully to ${audioPath}`);
          } catch (downloadError: unknown) {
            const downloadErrorMessage = downloadError instanceof Error ? downloadError.message : String(downloadError);
            processingError = `Failed to download audio for ${jobId}: ${downloadErrorMessage}`;
            logger.error(`[${jobId}] Audio download error: ${processingError}`);
            throw new Error(processingError);
          }

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
                const {filePath: txtFilePath, fileNameWithExt: txtFileName} = await saveContentToFile(
                  transcriptionText,
                  effectiveBaseFileName,
                  jobId,
                  'txt'
                );
                filesToCleanUp.push(txtFilePath);
                transcriptionFileUrlDb = isProduction
                  ? await uploadToS3(txtFilePath, `transcriptions/${jobId}/${txtFileName}`)
                  : `file://${txtFilePath}`; 
                finalFileUrl = transcriptionFileUrlDb; 
                logger.info(`[${jobId}] Groq .txt content processed. URL: ${transcriptionFileUrlDb}`);
              } else {
                logger.warn(`[${jobId}] No plain text extracted from Groq verbose_json.`);
                // Decide if this is an error or if processing can continue for SRT/VTT
              }

              // 2. Generate and save SRT
              srtFileTextDb = generateSrtFromGroqVerboseJson(groqVerboseJson);
              if (srtFileTextDb) {
                const {filePath: srtFilePath, fileNameWithExt: srtFileName} = await saveContentToFile(
                  srtFileTextDb,
                  effectiveBaseFileName,
                  jobId,
                  'srt'
                );
                filesToCleanUp.push(srtFilePath);
                srtFileUrlDb = isProduction
                  ? await uploadToS3(srtFilePath, `transcriptions/${jobId}/${srtFileName}`)
                  : `file://${srtFilePath}`;
                logger.info(`[${jobId}] Groq .srt content processed. URL: ${srtFileUrlDb}`);
              } else {
                logger.warn(`[${jobId}] No SRT content generated from Groq verbose_json.`);
              }
              
              // 3. Generate and save VTT
              vttFileTextDb = generateVttFromGroqVerboseJson(groqVerboseJson);
              if (vttFileTextDb) {
                const {filePath: vttFilePath, fileNameWithExt: vttFileName} = await saveContentToFile(
                  vttFileTextDb,
                  effectiveBaseFileName,
                  jobId,
                  'vtt'
                );
                filesToCleanUp.push(vttFilePath);
                vttFileUrlDb = isProduction
                  ? await uploadToS3(vttFilePath, `transcriptions/${jobId}/${vttFileName}`)
                  : `file://${vttFilePath}`;
                logger.info(`[${jobId}] Groq .vtt content processed. URL: ${vttFileUrlDb}`);
              } else {
                logger.warn(`[${jobId}] No VTT content generated from Groq verbose_json.`);
              }

            } else { // 'standard' or caption_first (non-Groq)
              logger.info(`[${jobId}] Standard Whisper transcription processing...`);
              const whisperResult = await transcribeAudio(audioPath!); 
              
              filesToCleanUp.push(whisperResult.txtPath, whisperResult.srtPath, whisperResult.vttPath);
              
              transcriptionText = await fs.promises.readFile(whisperResult.txtPath, 'utf-8');
              // Read SRT and VTT file contents for standard Whisper
              if (fs.existsSync(whisperResult.srtPath)) {
                srtFileTextDb = await fs.promises.readFile(whisperResult.srtPath, 'utf-8');
              } else {
                logger.warn(`[${jobId}] Standard Whisper: SRT file not found at ${whisperResult.srtPath}`);
              }
              if (fs.existsSync(whisperResult.vttPath)) {
                vttFileTextDb = await fs.promises.readFile(whisperResult.vttPath, 'utf-8');
              } else {
                logger.warn(`[${jobId}] Standard Whisper: VTT file not found at ${whisperResult.vttPath}`);
              }
              
              // whisperResult paths are already absolute paths in tmpDir
              const txtFileName = path.basename(whisperResult.txtPath);
              const srtFileName = path.basename(whisperResult.srtPath);
              const vttFileName = path.basename(whisperResult.vttPath);

              transcriptionFileUrlDb = isProduction
                ? `s3_placeholder_url_for/${jobId}/${txtFileName}`
                : `file:///${whisperResult.txtPath}`; // Added file:/// prefix
              srtFileUrlDb = isProduction
                ? `s3_placeholder_url_for/${jobId}/${srtFileName}`
                : `file:///${whisperResult.srtPath}`; // Added file:/// prefix
              vttFileUrlDb = isProduction
                ? `s3_placeholder_url_for/${jobId}/${vttFileName}`
                : `file:///${whisperResult.vttPath}`; // Added file:/// prefix
              
              finalFileUrl = transcriptionFileUrlDb; // TXT content is the primary for standard whisper

              logger.info(`[${jobId}] Standard Whisper produced TXT, SRT, VTT. URLs: TXT: ${transcriptionFileUrlDb}, SRT: ${srtFileUrlDb}, VTT: ${vttFileUrlDb}`);
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
                transcriptionText = await fs.promises.readFile(whisperResultFallback.txtPath, 'utf-8');

                const fallbackTxtFileName = path.basename(whisperResultFallback.txtPath);
                const fallbackSrtFileName = path.basename(whisperResultFallback.srtPath);
                const fallbackVttFileName = path.basename(whisperResultFallback.vttPath);

                transcriptionFileUrlDb = isProduction
                  ? `s3_placeholder_url_for/${jobId}/${fallbackTxtFileName}`
                  : `file:///${whisperResultFallback.txtPath}`; // Added file:/// prefix
                srtFileUrlDb = isProduction
                  ? `s3_placeholder_url_for/${jobId}/${fallbackSrtFileName}`
                  : `file:///${whisperResultFallback.srtPath}`; // Added file:/// prefix
                vttFileUrlDb = isProduction
                  ? `s3_placeholder_url_for/${jobId}/${fallbackVttFileName}`
                  : `file:///${whisperResultFallback.vttPath}`; // Added file:/// prefix
                
                finalFileUrl = transcriptionFileUrlDb;
                logger.info(`[${jobId}] Fallback to Standard Whisper produced TXT, SRT, VTT. URLs set. TXT: ${transcriptionFileUrlDb}`);
                processingError = null; // Clear previous Groq error as fallback succeeded
            } else {
                throw new Error(processingError); 
            }
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
            status: processingError ? 'failed' : 'completed',
            statusMessage: processingError || null,
            transcriptionFileUrl: transcriptionFileUrlDb || null,
            srtFileUrl: srtFileUrlDb || null,
            vttFileUrl: vttFileUrlDb || null,
            transcriptionText: transcriptionText || null,
            srt_file_text: srtFileTextDb || null,
            vtt_file_text: vttFileTextDb || null,
            updatedAt: new Date(),
            video_length_minutes_actual: videoLengthMinutesActual,
            credits_charged: creditsChargedForDB,
          }).where(eq(transcriptionJobs.id, jobId));
        logger.info(`[${jobId}] Finished processing job. Status: ${processingError ? 'failed' : 'completed'}`);
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
        logger.error(`[${jobId}] Unhandled error in worker:`, error);
        const finalProcessingError: string | null = errorMessage || null;
        try {
          await db.update(transcriptionJobs).set({
            status: 'failed',
            statusMessage: finalProcessingError,
            updatedAt: new Date(),
            transcriptionFileUrl: transcriptionFileUrlDb || null,
            srtFileUrl: srtFileUrlDb || null,
            vttFileUrl: vttFileUrlDb || null,
            transcriptionText: transcriptionText || null,
            srt_file_text: srtFileTextDb || null,
            vtt_file_text: vttFileTextDb || null,
            video_length_minutes_actual: videoLengthMinutesActual,
            credits_charged: creditsChargedForDB,
          }).where(eq(transcriptionJobs.id, jobId));
        } catch (dbError) {
          logger.error(`[${jobId}] FATAL: Could not update job status to failed in DB after unhandled error:`, dbError);
        }
        throw new Error(finalProcessingError ?? 'Job failed with an unspecified error');
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