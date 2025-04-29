import { NextResponse } from 'next/server';
import { addTranscriptionJob, getJobStatus } from '@/lib/queue/transcription-queue';
import { logger } from '@/lib/logger';
// Validate URL function
function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    }
    catch {
        return false;
    }
}
// POST endpoint to create a new transcription job
export async function POST(request) {
    try {
        // Validate required headers
        const contentType = request.headers.get('Content-Type');
        const apiKey = request.headers.get('API_KEY');
        if (!contentType || !contentType.includes('application/json')) {
            return NextResponse.json({
                error: 'Content-Type header must be application/json',
                status_code: 400,
                status_message: 'Bad Request'
            }, { status: 400 });
        }
        if (!apiKey) {
            return NextResponse.json({
                error: 'API_KEY header is required',
                status_code: 401,
                status_message: 'Unauthorized'
            }, { status: 401 });
        }
        // Parse request body
        const { url, quality = 'standard', fallbackOnRateLimit = true, userId, callback_url } = await request.json();
        if (!url) {
            return NextResponse.json({
                error: 'URL is required',
                status_code: 400,
                status_message: 'Bad Request'
            }, { status: 400 });
        }
        // Validate YouTube URL
        if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
            return NextResponse.json({
                error: 'Invalid YouTube URL',
                status_code: 400,
                status_message: 'Bad Request'
            }, { status: 400 });
        }
        // Validate callback URL if provided
        if (callback_url && !isValidUrl(callback_url)) {
            return NextResponse.json({
                error: 'Invalid callback URL',
                status_code: 400,
                status_message: 'Bad Request'
            }, { status: 400 });
        }
        // Add job to the queue
        const jobId = await addTranscriptionJob({
            url,
            quality: quality === 'premium' ? 'premium' : 'standard',
            fallbackOnRateLimit,
            userId,
            apiKey,
            callback_url
        }, quality === 'premium' ? 'premium' : 'standard');
        logger.info(`Added transcription job to queue: ${jobId}`);
        // Return accepted response with job ID
        return NextResponse.json({
            status_code: "202",
            status_message: "accepted",
            job_id: jobId,
            quality: quality === 'premium' ? 'premium' : 'standard'
        }, { status: 202 });
    }
    catch (error) {
        logger.error('Error creating transcription job:', error);
        const errorMessage = error instanceof Error
            ? error.message
            : 'Unknown error';
        return NextResponse.json({
            error: 'Failed to create transcription job',
            details: errorMessage,
            status_code: 500,
            status_message: 'Internal Server Error'
        }, { status: 500 });
    }
}
// GET endpoint to check job status
export async function GET(request) {
    try {
        // Get job ID from query parameters
        const { searchParams } = new URL(request.url);
        const jobId = searchParams.get('jobId');
        if (!jobId) {
            return NextResponse.json({
                error: 'Job ID is required',
                status_code: 400,
                status_message: 'Bad Request'
            }, { status: 400 });
        }
        // Get job status
        const jobStatus = await getJobStatus(jobId);
        if (jobStatus.status === 'not_found') {
            return NextResponse.json({
                error: 'Job not found',
                jobId,
                status_code: 404,
                status_message: 'Not Found'
            }, { status: 404 });
        }
        // If job is completed, return the result with status 200
        if (jobStatus.status === 'completed' && jobStatus.result) {
            // Check if there was an error during processing
            if (jobStatus.result.error) {
                return NextResponse.json({
                    error: 'Transcription failed',
                    details: jobStatus.result.error,
                    job_id: jobId,
                    callback_status: jobStatus.result.callback_success ? 'success' : 'failed',
                    callback_error: jobStatus.result.callback_error,
                    status_code: 500,
                    status_message: 'Internal Server Error'
                }, { status: 500 });
            }
            // Return successful result
            return NextResponse.json({
                transcription: jobStatus.result.transcription,
                quality: jobStatus.result.quality,
                job_id: jobId,
                callback_status: jobStatus.result.callback_success ? 'success' : 'not_sent',
                callback_error: jobStatus.result.callback_error,
                status_code: 200,
                status_message: 'OK'
            }, { status: 200 });
        }
        // If job is still in progress, return status 102 (Processing)
        return NextResponse.json({
            status: jobStatus.status,
            progress: jobStatus.progress,
            job_id: jobId,
            status_code: 102,
            status_message: 'Processing'
        }, { status: 102 });
    }
    catch (error) {
        logger.error('Error checking job status:', error);
        const errorMessage = error instanceof Error
            ? error.message
            : 'Unknown error';
        return NextResponse.json({
            error: 'Failed to check job status',
            details: errorMessage,
            status_code: 500,
            status_message: 'Internal Server Error'
        }, { status: 500 });
    }
}
//# sourceMappingURL=route.js.map