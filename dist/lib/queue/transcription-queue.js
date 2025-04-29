import { Queue, Worker, QueueEvents, FlowProducer } from 'bullmq';
import { createRedisConnection, QUEUE_NAMES, PRIORITY, defaultJobOptions, JOB_STATUS } from './config.ts';
import { logger } from '../logger.ts';
import path from 'path';
import fs from 'fs';
import { transcribeAudio } from '../transcription.ts';
import { transcribeAudioWithGroq } from '../groq-transcription.ts';
import { rateLimitTracker } from '../rate-limit-tracker.ts';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
const execAsync = promisify(exec);
// Initialize transcription queue
export const transcriptionQueue = new Queue(QUEUE_NAMES.TRANSCRIPTION, {
    connection: createRedisConnection(),
    defaultJobOptions
});
// Initialize flow producer for parent-child job relationships
export const flowProducer = new FlowProducer({
    connection: createRedisConnection()
});
// Initialize queue events for monitoring
export const transcriptionQueueEvents = new QueueEvents(QUEUE_NAMES.TRANSCRIPTION, {
    connection: createRedisConnection()
});
// Add a transcription job to the queue
export async function addTranscriptionJob(data, priority = 'standard') {
    const jobId = `transcription-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await transcriptionQueue.add('transcribe', {
        ...data,
        jobId
    }, {
        priority: priority === 'premium' ? PRIORITY.PREMIUM : PRIORITY.STANDARD,
        jobId
    });
    return jobId;
}
// Get job status and progress
export async function getJobStatus(jobId) {
    const job = await transcriptionQueue.getJob(jobId);
    if (!job) {
        return {
            status: 'not_found',
            progress: null,
            result: null
        };
    }
    const state = await job.getState();
    const progress = await job.progress;
    return {
        status: state,
        progress: progress || null,
        result: state === JOB_STATUS.COMPLETED ? await job.returnvalue : null
    };
}
// Send callback to client when job completes
async function sendCallback(callbackUrl, data) {
    try {
        logger.info(`Sending callback to ${callbackUrl}`);
        await axios.post(callbackUrl, data);
        logger.info(`Callback to ${callbackUrl} successful`);
        return true;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Callback to ${callbackUrl} failed: ${errorMessage}`);
        return false;
    }
}
// Process transcription jobs
export function startTranscriptionWorker(concurrency = 5) {
    const worker = new Worker(QUEUE_NAMES.TRANSCRIPTION, async (job) => {
        const { url, quality, fallbackOnRateLimit, callback_url } = job.data;
        logger.info(`Processing transcription job ${job.id} for URL: ${url}`);
        // Define paths and result variables early
        let audioPath;
        let transcriptionFilePath;
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
            }
            catch (downloadError) {
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
                    }
                    catch (groqError) {
                        const errorMessage = groqError instanceof Error ? groqError.message : String(groqError);
                        if (fallbackOnRateLimit && errorMessage.includes('rate_limit_exceeded')) {
                            logger.warn('Groq rate limit exceeded. Falling back to standard transcription...');
                            qualityUsed = 'standard';
                            // This also returns a FILE PATH
                            transcriptionFilePath = await transcribeAudio(audioPath);
                        }
                        else {
                            throw groqError;
                        }
                    }
                }
                else {
                    logger.info('Using standard open-source Whisper transcription');
                    // This returns a FILE PATH
                    transcriptionFilePath = await transcribeAudio(audioPath);
                }
            }
            catch (transcriptionError) {
                logger.error('Transcription error:', transcriptionError);
                // No need to clean up transcription file here, let main catch handle cleanup
                throw transcriptionError;
            }
            // **** NEW STEP: Read the transcription from the file ****
            let transcriptionText;
            if (!transcriptionFilePath || !fs.existsSync(transcriptionFilePath)) {
                logger.error(`Transcription file path is missing or file does not exist: ${transcriptionFilePath}`);
                throw new Error('Transcription process failed to produce a result file.');
            }
            try {
                logger.info(`Reading transcription result from: ${transcriptionFilePath}`);
                transcriptionText = await fs.promises.readFile(transcriptionFilePath, 'utf-8');
            }
            catch (readFileError) {
                logger.error(`Failed to read transcription file ${transcriptionFilePath}:`, readFileError);
                throw new Error(`Worker failed to read result file: ${readFileError instanceof Error ? readFileError.message : String(readFileError)}`);
            }
            // *** We now have the transcriptionText ***
            // Update progress for cleanup phase (only audio file)
            await job.updateProgress({ percentage: 90, stage: 'cleaning_up', message: 'Cleaning up temporary audio file' });
            // Clean up temporary AUDIO file
            try {
                if (audioPath && fs.existsSync(audioPath)) {
                    fs.unlinkSync(audioPath);
                    logger.info(`Cleaned up temporary audio file: ${audioPath}`);
                }
                else {
                    logger.warn(`Temporary audio file not found for cleanup: ${audioPath}`);
                }
            }
            catch (cleanupError) {
                logger.error('Audio cleanup error:', cleanupError);
            }
            // Update progress to indicate job has completed
            await job.updateProgress({ percentage: 100, stage: 'completed', message: 'Job completed successfully' });
            // Prepare result - use transcriptionText read from the file
            const result = {
                transcription: transcriptionText,
                quality: qualityUsed,
                jobId: job.data.jobId
                // Optionally add filePath if needed for other purposes later
                // filePath: transcriptionFilePath 
            };
            // Send callback if URL was provided - use transcriptionText
            if (callback_url) {
                try {
                    const callbackData = {
                        job_id: job.data.jobId,
                        status_code: 200,
                        status_message: "success",
                        quality: qualityUsed,
                        response: {
                            text: transcriptionText
                        }
                    };
                    const callbackSuccess = await sendCallback(callback_url, callbackData);
                    result.callback_success = callbackSuccess;
                    if (!callbackSuccess) {
                        result.callback_error = "Failed to send callback";
                    }
                }
                catch (callbackError) {
                    logger.error(`Callback error: ${callbackError}`);
                    result.callback_success = false;
                    result.callback_error = callbackError instanceof Error ? callbackError.message : String(callbackError);
                }
            }
            // IMPORTANT: Return the result object containing the text
            return result;
        }
        catch (error) {
            logger.error(`Job ${job.id} failed:`, error);
            // Clean up temporary AUDIO file if it exists on error
            try {
                if (audioPath && fs.existsSync(audioPath)) {
                    fs.unlinkSync(audioPath);
                    logger.info(`Cleaned up temporary audio file on error: ${audioPath}`);
                }
            }
            catch (cleanupError) {
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
                }
                catch (callbackError) {
                    logger.error(`Error sending error callback: ${callbackError}`);
                }
            }
            // *** IMPORTANT: Throw the error instead of returning an error object ***
            // This ensures BullMQ marks the job as 'failed'
            throw error instanceof Error ? error : new Error(errorMessage);
        }
    }, {
        connection: createRedisConnection(),
        concurrency,
        autorun: true
    });
    // Handle worker events with proper typing (modified handler)
    worker.on('completed', (job, result) => {
        if (job && result) {
            if (result.error) { // Check the RETURNED result object for an error field
                logger.error(`Job ${job.id} completed with error in result: ${result.error}`);
            }
            else {
                logger.info(`Job ${job.id} completed successfully (returned result)`);
            }
        }
        else if (job) {
            logger.warn(`Job ${job.id} completed but result object is missing.`);
        }
    });
    worker.on('failed', (job, error) => {
        if (job) {
            logger.error(`Job ${job.id} failed with error: ${error.message}`);
        }
        else {
            logger.error(`Job failed with error: ${error.message}`);
        }
    });
    worker.on('error', (error) => {
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
//# sourceMappingURL=transcription-queue.js.map