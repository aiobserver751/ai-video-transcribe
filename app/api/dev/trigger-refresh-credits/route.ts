import { NextResponse } from 'next/server';
import { refreshFreeTierCredits, type RefreshResult } from '@/server/actions/cronActions'; // Adjust path if your cronActions.ts is elsewhere
import { logger } from '@/lib/logger';

export async function POST(request: Request) {
  // Use the same environment variable name as in the script for consistency
  const EXPECTED_SCRIPT_SECRET = process.env.LOCAL_CRON_SCRIPT_SECRET || "your-default-manual-script-secret";

  const authHeader = request.headers.get('Authorization');
  
  if (EXPECTED_SCRIPT_SECRET === "your-default-manual-script-secret") {
    logger.warn("[MANUAL_REFRESH_API] WARN: Using default LOCAL_CRON_SCRIPT_SECRET for validation. Please set this in your .env file.");
  }

  if (!authHeader || authHeader !== `Bearer ${EXPECTED_SCRIPT_SECRET}`) {
    logger.warn(`[MANUAL_REFRESH_API] Unauthorized attempt. Auth header: ${authHeader}`);
    return NextResponse.json({ error: 'Unauthorized script access' }, { status: 401 });
  }

  // Optional: Add a check for development environment
  if (process.env.NODE_ENV !== 'development') {
    logger.warn('[MANUAL_REFRESH_API] Attempt to trigger outside development environment.');
    return NextResponse.json({ error: 'This endpoint is for development use only.' }, { status: 403 });
  }

  try {
    logger.info('[MANUAL_REFRESH_API] Authorized request. Manually triggering refreshFreeTierCredits...');
    const result: RefreshResult = await refreshFreeTierCredits();
    // Log a summary instead of the full result object if it can be large
    logger.info(`[MANUAL_REFRESH_API] refreshFreeTierCredits completed. Processed: ${result.processedUsers}, Successful: ${result.successfulRefreshes}, Failed: ${result.failedRefreshes}`); 
    return NextResponse.json({ 
      success: true, 
      message: "Refresh job completed.", 
      data: { 
        processedUsers: result.processedUsers, 
        successfulRefreshes: result.successfulRefreshes, 
        failedRefreshes: result.failedRefreshes 
      }
    });
  } catch (error: unknown) {
    let errorMessage = 'Unknown server error';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    logger.error('[MANUAL_REFRESH_API] Error during manual refreshFreeTierCredits:', errorMessage, error);
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
} 