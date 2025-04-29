import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { transcribeAudio } from '@/lib/transcription';
import { transcribeAudioWithGroq } from '@/lib/groq-transcription';
import { rateLimitTracker } from '@/lib/rate-limit-tracker';
import { logger } from '@/lib/logger';
const execAsync = promisify(exec);
export async function POST(request) {
    // Test logging - this should appear in the console when the endpoint is called
    logger.debug('Transcription endpoint called - DEBUG TEST');
    logger.info('Transcription endpoint called - INFO TEST');
    logger.warn('Transcription endpoint called - WARN TEST');
    logger.error('Transcription endpoint called - ERROR TEST');
    try {
        // Validate required headers
        const contentType = request.headers.get('Content-Type');
        const apiKey = request.headers.get('API_KEY');
        if (!contentType || !contentType.includes('application/json')) {
            return NextResponse.json({
                error: 'Content-Type header must be application/json',
                status_code: 400,
                status_message: "Bad Request"
            }, { status: 400 });
        }
        if (!apiKey) {
            return NextResponse.json({
                error: 'API_KEY header is required',
                status_code: 401,
                status_message: "Unauthorized"
            }, { status: 401 });
        }
        // For now, we'll just check that the API key is present
        // TODO: Implement proper API key validation in the future
        const { url, quality = 'standard', fallbackOnRateLimit = true } = await request.json();
        if (!url) {
            return NextResponse.json({
                error: 'URL is required',
                status_code: 400,
                status_message: "Bad Request"
            }, { status: 400 });
        }
        // Validate YouTube URL
        if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
            return NextResponse.json({
                error: 'Invalid YouTube URL',
                status_code: 400,
                status_message: "Bad Request"
            }, { status: 400 });
        }
        // Create unique filename for this request
        const timestamp = Date.now();
        const audioPath = path.join(process.cwd(), 'tmp', `audio_${timestamp}.mp3`);
        // Make sure tmp directory exists
        if (!fs.existsSync(path.join(process.cwd(), 'tmp'))) {
            fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
        }
        try {
            // Download audio directly using yt-dlp
            logger.info(`Downloading audio from ${url}`);
            await execAsync(`yt-dlp -x --audio-format mp3 -o "${audioPath}" "${url}"`);
            // Check if file was downloaded successfully
            if (!fs.existsSync(audioPath)) {
                return NextResponse.json({
                    error: 'Failed to download audio from the provided URL',
                    status_code: 500,
                    status_message: "Internal Server Error"
                }, { status: 500 });
            }
            // Get file size for logging
            const stats = await fs.promises.stat(audioPath);
            logger.info(`Downloaded audio file size: ${(stats.size / (1024 * 1024)).toFixed(2)}MB`);
        }
        catch (downloadError) {
            logger.error('Download error:', downloadError);
            return NextResponse.json({
                error: `Failed to download video: ${downloadError}`,
                status_code: 500,
                status_message: "Internal Server Error"
            }, { status: 500 });
        }
        // Transcribe the audio based on requested quality
        let transcription;
        let qualityUsed = quality;
        try {
            if (quality === 'premium') {
                logger.info('Using premium Groq transcription');
                // Check if GROQ_API_KEY is set
                if (!process.env.GROQ_API_KEY) {
                    return NextResponse.json({
                        error: 'GROQ_API_KEY is not configured on the server',
                        status_code: 500,
                        status_message: "Internal Server Error"
                    }, { status: 500 });
                }
                // Get current rate limit usage stats
                const usageStats = rateLimitTracker.getUsageStats();
                logger.info(`Rate limits: ${usageStats.hourlyUsed}/${usageStats.hourlyLimit} seconds used this hour`);
                try {
                    transcription = await transcribeAudioWithGroq(audioPath);
                }
                catch (groqError) {
                    // Check if error is related to rate limits and fallback is enabled
                    const errorMessage = groqError instanceof Error ? groqError.message : String(groqError);
                    if (fallbackOnRateLimit && errorMessage.includes('rate_limit_exceeded')) {
                        logger.warn('Groq rate limit exceeded. Falling back to standard transcription...');
                        qualityUsed = 'standard';
                        transcription = await transcribeAudio(audioPath);
                    }
                    else if (errorMessage.includes('rate_limit_exceeded') || errorMessage.includes('Rate limit would be exceeded')) {
                        // Get updated rate limit info for the error response
                        const usageStats = rateLimitTracker.getUsageStats();
                        const resetTime = usageStats.hourlyResetAt;
                        const minutesUntilReset = Math.ceil((resetTime.getTime() - Date.now()) / 60000);
                        // Clean up temporary files
                        try {
                            if (fs.existsSync(audioPath)) {
                                fs.unlinkSync(audioPath);
                            }
                        }
                        catch (cleanupError) {
                            logger.error('Cleanup error:', cleanupError);
                        }
                        return NextResponse.json({
                            error: 'Rate limit exceeded',
                            details: errorMessage,
                            rateLimits: {
                                used: usageStats.hourlyUsed,
                                limit: usageStats.hourlyLimit,
                                remaining: usageStats.hourlyRemaining,
                                resetsIn: `${minutesUntilReset} minutes`,
                                resetTime: resetTime.toISOString()
                            },
                            quality,
                            status_code: 429,
                            status_message: "Too Many Requests"
                        }, { status: 429 });
                    }
                    else {
                        // Re-throw if we shouldn't fall back or it's not a rate limit error
                        throw groqError;
                    }
                }
            }
            else {
                logger.info('Using standard open-source Whisper transcription');
                transcription = await transcribeAudio(audioPath);
            }
        }
        catch (transcriptionError) {
            logger.error('Transcription error:', transcriptionError);
            // Clean up temporary files even if there's an error
            try {
                if (fs.existsSync(audioPath)) {
                    fs.unlinkSync(audioPath);
                }
            }
            catch (cleanupError) {
                logger.error('Cleanup error:', cleanupError);
            }
            const errorMessage = transcriptionError instanceof Error
                ? transcriptionError.message
                : 'Unknown error';
            return NextResponse.json({
                error: 'Transcription failed',
                details: errorMessage,
                quality,
                status_code: 500,
                status_message: "Internal Server Error"
            }, { status: 500 });
        }
        // Clean up temporary files
        try {
            fs.unlinkSync(audioPath);
        }
        catch (cleanupError) {
            logger.error('Cleanup error:', cleanupError);
            // Continue despite cleanup error
        }
        return NextResponse.json({
            transcription,
            quality: qualityUsed,
            status_code: 200,
            status_message: "Success"
        });
    }
    catch (error) {
        logger.error('General error:', error);
        const errorMessage = error instanceof Error
            ? error.message
            : 'Unknown error';
        return NextResponse.json({
            error: 'Failed to process video',
            details: errorMessage,
            status_code: 500,
            status_message: "Internal Server Error"
        }, { status: 500 });
    }
}
//# sourceMappingURL=route.js.map