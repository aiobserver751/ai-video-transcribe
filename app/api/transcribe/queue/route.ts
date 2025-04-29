import { NextRequest, NextResponse } from 'next/server';
import { addTranscriptionJob, getJobStatus } from '@/lib/queue/transcription-queue';
import { logger } from '@/lib/logger';
import { db } from '@/server/db'; // Import db instance
import { transcriptionJobs, apiKeys } from '@/server/db/schema'; // Import tables
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
    const { url, quality = 'standard', fallbackOnRateLimit = true, callback_url } = await request.json();

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

    // Validate YouTube URL
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      return NextResponse.json(
        {
          error: 'Invalid YouTube URL',
          status_code: 400,
          status_message: 'Bad Request'
        },
        { status: 400 }
      );
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
    const requestedQuality = quality === 'premium' ? 'premium' : 'standard';
    const jobId = await addTranscriptionJob(
      {
        url,
        quality: requestedQuality,
        fallbackOnRateLimit,
        userId: authenticatedUserId, // Use userId from the validated API key
        apiKey: apiKey, // Pass the validated key for potential future use/logging in job data
        callback_url
      },
      requestedQuality
    );
    logger.info(`Added transcription job to queue: ${jobId} for user: ${authenticatedUserId}`);

    // === 4. Insert Job Record in DB ===
    try {
      logger.info(`Inserting job record into database: ${jobId}`);
      await db.insert(transcriptionJobs).values({
        id: jobId,
        // @ts-expect-error - Linter seems confused about userId type despite schema
        userId: authenticatedUserId, 
        videoUrl: url,
        quality: requestedQuality,
        status: 'pending',
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