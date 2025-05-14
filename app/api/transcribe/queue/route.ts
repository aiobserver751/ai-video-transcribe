import { NextRequest, NextResponse } from 'next/server';
import { addTranscriptionJob, getJobStatus } from '@/lib/queue/transcription-queue';
import { logger } from '@/lib/logger';
import { db } from '@/server/db'; // Import db instance
import { transcriptionJobs, apiKeys, qualityEnum, users } from '@/server/db/schema'; // Import tables, added users table
import { eq, and } from 'drizzle-orm'; // Import Drizzle operators

// Validate URL function
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// POST endpoint to create a new transcription job
export async function POST(request: NextRequest) {
  try {
    // === 1. API Key Validation ===
    const apiKey = request.headers.get('API_KEY');
    if (!apiKey) {
      logger.warn('API key missing from request header');
      return NextResponse.json(
        { error: 'API_KEY header is required', status_code: 401, status_message: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Find the API key in the database
    const foundKeys = await db.select({
        id: apiKeys.id, // Select the key ID for the update later
        userId: apiKeys.userId // Explicitly select userId
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.key, apiKey), eq(apiKeys.isActive, true)))
      .limit(1);

    if (foundKeys.length === 0) {
      logger.warn(`Invalid or inactive API key provided: ${apiKey.substring(0, 5)}...`);
      return NextResponse.json(
        { error: 'Invalid or inactive API Key', status_code: 401, status_message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const validApiKey = foundKeys[0];
    const authenticatedUserId = validApiKey.userId; // Get the user ID associated with this key
    logger.info(`API Key validated for user ID: ${authenticatedUserId}`);

    // === ADDED: Subscription Tier Check ===
    const userResult = await db.select({ 
        subscriptionTier: users.subscriptionTier 
      })
      .from(users)
      .where(eq(users.id, authenticatedUserId))
      .limit(1);

    if (userResult.length === 0) {
      // This case should be rare if an API key exists for a user, implies data inconsistency
      logger.error(`[API JOB SUBMISSION] User ${authenticatedUserId} found via API key but not present in users table.`);
      return NextResponse.json(
        { error: 'User account associated with API key not found', status_code: 500, message: 'Internal Server Error' }, // Corrected: status_message to message
        { status: 500 }
      );
    }

    const currentUser = userResult[0];
    if (currentUser.subscriptionTier === 'free') {
      logger.warn(`[API JOB SUBMISSION] User ${authenticatedUserId} on 'free' tier attempted API job submission. Denied.`);
      return NextResponse.json(
        { 
          error: 'API access is not available for users on the free tier. Please upgrade your plan to use API keys for job submission.',
          status_code: 403, 
          message: 'Forbidden' // Corrected: status_message to message
        },
        { status: 403 }
      );
    }
    logger.info(`[API JOB SUBMISSION] User ${authenticatedUserId} on tier '${currentUser.subscriptionTier}' permitted for API job submission.`);
    // === END: Subscription Tier Check ===

    // Asynchronously update lastUsedAt (fire and forget - doesn't block response)
    // Consider adding await if strict atomicity with job creation is needed,
    // but this might slightly delay the initial response.
    db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, validApiKey.id))
      .then(() => logger.debug(`Updated lastUsedAt for API key ID: ${validApiKey.id}`))
      .catch((err) => logger.error(`Failed to update lastUsedAt for API key ID ${validApiKey.id}:`, err));

    // === 2. Request Body Parsing and Validation ===
    const contentType = request.headers.get('Content-Type');
    if (!contentType || !contentType.includes('application/json')) {
      return NextResponse.json(
        {
          error: 'Content-Type header must be application/json',
          status_code: 400,
          status_message: 'Bad Request'
        },
        { status: 400 }
      );
    }
    
    // Note: We don't need userId from the body anymore, we use the one from the API key
    const { url, quality, fallbackOnRateLimit = true, callback_url, response_format: requested_response_format } = await request.json();

    if (!url) {
      return NextResponse.json(
        {
          error: 'URL is required',
          status_code: 400,
          status_message: 'Bad Request'
        },
        { status: 400 }
      );
    }

    // Validate quality parameter against enum
    if (!quality || !qualityEnum.enumValues.includes(quality)) {
      return NextResponse.json(
        {
          error: `Invalid quality parameter. Must be one of: ${qualityEnum.enumValues.join(', ')}`,
          status_code: 400,
          status_message: 'Bad Request'
        },
        { status: 400 }
      );
    }
    const requestedQuality = quality as typeof qualityEnum.enumValues[number]; // Type assertion after validation

    // Validate and set response_format, defaulting to verbose
    let response_format: 'plain_text' | 'url' | 'verbose' = 'verbose';
    if (requested_response_format) {
      if (['plain_text', 'url', 'verbose'].includes(requested_response_format)) {
        response_format = requested_response_format as 'plain_text' | 'url' | 'verbose';
      } else {
        return NextResponse.json(
          {
            error: "Invalid response_format parameter. Must be one of: plain_text, url, verbose",
            status_code: 400,
            status_message: 'Bad Request'
          },
          { status: 400 }
        );
      }
    }

    // Conditional YouTube URL validation for 'caption_first' quality
    if (requestedQuality === 'caption_first') {
      try {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname.toLowerCase();
        const isYouTube = (hostname === "youtube.com" || hostname === "www.youtube.com") && parsedUrl.searchParams.has("v");
        const isYoutuBe = hostname === "youtu.be" && parsedUrl.pathname.length > 1;

        if (!isYouTube && !isYoutuBe) {
          return NextResponse.json(
            {
              error: "For 'caption_first' quality, a valid YouTube video URL is required (e.g., youtube.com?v=VIDEO_ID or youtu.be/VIDEO_ID). Other platforms are not supported for this quality setting.",
              status_code: 400,
              status_message: 'Bad Request'
            },
            { status: 400 }
          );
        }
      } catch {
        // URL parsing failed, means it's not a valid URL format for this check
        return NextResponse.json(
          {
            error: "Invalid URL format provided for 'caption_first' quality check.",
            status_code: 400,
            status_message: 'Bad Request'
          },
          { status: 400 }
        );
      }
    }

    // Validate callback URL if provided
    if (callback_url && !isValidUrl(callback_url)) {
      return NextResponse.json(
        {
          error: 'Invalid callback URL',
          status_code: 400,
          status_message: 'Bad Request'
        },
        { status: 400 }
      );
    }

    // === 3. Add Job to Queue ===
    let jobPriority: 'standard' | 'premium';
    if (requestedQuality === 'caption_first') {
      jobPriority = 'standard'; // caption_first jobs get standard priority
    } else {
      jobPriority = requestedQuality; // 'standard' or 'premium' directly map
    }

    const jobId = await addTranscriptionJob(
      {
        url,
        quality: requestedQuality,
        fallbackOnRateLimit,
        userId: authenticatedUserId,
        apiKey: apiKey, 
        callback_url,
        response_format: response_format // Pass the validated or default response_format
      },
      jobPriority // Use the determined jobPriority
    );
    logger.info(`Added transcription job to queue: ${jobId} for user: ${authenticatedUserId}, priority: ${jobPriority}`);

    // === 4. Insert Job Record in DB ===
    try {
      logger.info(`Inserting job record into database: ${jobId}`);
      await db.insert(transcriptionJobs).values({
        id: jobId,
        userId: authenticatedUserId, 
        videoUrl: url,
        quality: requestedQuality,
        status: 'pending_credit_deduction',
        origin: 'EXTERNAL',
        // transcriptionFileUrl will be updated later
      });
      logger.info(`Successfully inserted job record: ${jobId}`);
    } catch (dbError) {
      logger.error(`Database insertion failed for job ${jobId}:`, dbError);
      // Decide how to handle DB insert failure. Options:
      // 1. Log and continue (job is in queue but not DB - potentially problematic)
      // 2. Try to remove job from queue (complex, potential race conditions)
      // 3. Return an error to the client indicating partial failure.
      // For now, let's return a specific error indicating DB failure.
      return NextResponse.json(
        {
          error: 'Job queued but failed to save to database',
          details: dbError instanceof Error ? dbError.message : String(dbError),
          job_id: jobId, // Still provide jobId for potential manual lookup/cleanup
          status_code: 500,
          status_message: 'Internal Server Error'
        },
        { status: 500 }
      );
    }

    // === 5. Return Response ===
    return NextResponse.json(
      {
        status_code: "202",
        status_message: "accepted",
        job_id: jobId,
        quality: requestedQuality
      },
      { status: 202 }
    );

  } catch (error) {
    logger.error('Error creating transcription job:', error);
    
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'Unknown error';

    return NextResponse.json(
      {
        error: 'Failed to create transcription job',
        details: errorMessage,
        status_code: 500,
        status_message: 'Internal Server Error'
      },
      { status: 500 }
    );
  }
}

// GET endpoint to check job status
export async function GET(request: NextRequest) {
  try {
    // Get job ID from query parameters
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json(
        {
          error: 'Job ID is required',
          status_code: 400,
          status_message: 'Bad Request'
        },
        { status: 400 }
      );
    }

    // Get job status
    const jobStatus = await getJobStatus(jobId);

    if (jobStatus.status === 'not_found') {
      return NextResponse.json(
        {
          error: 'Job not found',
          jobId,
          status_code: 404,
          status_message: 'Not Found'
        },
        { status: 404 }
      );
    }

    // If job is completed, return the result with status 200
    if (jobStatus.status === 'completed' && jobStatus.result) {
      // Check if there was an error during processing
      if (jobStatus.result.error) {
        return NextResponse.json(
          {
            error: 'Transcription failed',
            details: jobStatus.result.error,
            job_id: jobId,
            callback_status: jobStatus.result.callback_success ? 'success' : 'failed',
            callback_error: jobStatus.result.callback_error,
            status_code: 500,
            status_message: 'Internal Server Error'
          },
          { status: 500 }
        );
      }

      // Return successful result
      return NextResponse.json(
        {
          transcription: jobStatus.result.transcription,
          quality: jobStatus.result.quality,
          job_id: jobId,
          transcriptionFileUrl: jobStatus.result.filePath,
          srtFileUrl: jobStatus.result.srtFileUrl,
          vttFileUrl: jobStatus.result.vttFileUrl,
          srtFileText: jobStatus.result.srtFileText,
          vttFileText: jobStatus.result.vttFileText,
          callback_status: jobStatus.result.callback_success ? 'success' : 'not_sent',
          callback_error: jobStatus.result.callback_error,
          status_code: 200,
          status_message: 'OK'
        },
        { status: 200 }
      );
    }

    // If job is still in progress, return status 102 (Processing)
    return NextResponse.json(
      {
        status: jobStatus.status,
        progress: jobStatus.progress,
        job_id: jobId,
        status_code: 102,
        status_message: 'Processing'
      },
      { status: 102 }
    );
  } catch (error) {
    logger.error('Error checking job status:', error);
    
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'Unknown error';

    return NextResponse.json(
      {
        error: 'Failed to check job status',
        details: errorMessage,
        status_code: 500,
        status_message: 'Internal Server Error'
      },
      { status: 500 }
    );
  }
} 