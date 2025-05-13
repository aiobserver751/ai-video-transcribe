'use server';

import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { and, eq, lt, or, isNull, lte } from 'drizzle-orm';
import {
  performCreditTransaction,
  getCreditConfig,
} from '@/server/services/creditService';
import { logger } from '@/lib/logger';

// Interface definition for the result
export interface RefreshResult {
  processedUsers: number;
  successfulRefreshes: number;
  failedRefreshes: number;
  errors: { userId: string; error: string }[];
}

/**
 * Cron job action to refresh credits for eligible free tier users.
 * Free tier users receive FREE_TIER_REFRESH_CREDITS every FREE_TIER_REFRESH_INTERVAL_DAYS,
 * up to a maximum of FREE_TIER_MAX_CREDITS.
 */
export async function refreshFreeTierCredits(): Promise<RefreshResult> {
  logger.info('[CRON_JOB] Starting refreshFreeTierCredits job.');
  const config = getCreditConfig();
  const results: RefreshResult = {
    processedUsers: 0,
    successfulRefreshes: 0,
    failedRefreshes: 0,
    errors: [],
  };

  try {
    const refreshIntervalDays = config.FREE_TIER_REFRESH_INTERVAL_DAYS;
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - refreshIntervalDays);

    logger.info(`[CRON_JOB] Refresh interval: ${refreshIntervalDays} days. Looking for users last refreshed before ${dateThreshold.toISOString()}`);

    const eligibleUsers = await db
      .select({
        id: users.id,
        email: users.email,
        credit_balance: users.credit_balance,
        credits_refreshed_at: users.credits_refreshed_at,
      })
      .from(users)
      .where(
        and(
          eq(users.subscriptionTier, 'free'),
          lt(users.credit_balance, config.FREE_TIER_MAX_CREDITS),
          or(
            isNull(users.credits_refreshed_at),
            lte(users.credits_refreshed_at, dateThreshold)
          )
        )
      );

    results.processedUsers = eligibleUsers.length;
    logger.info(`[CRON_JOB] Found ${eligibleUsers.length} eligible users for credit refresh.`);

    if (eligibleUsers.length === 0) {
      logger.info('[CRON_JOB] No eligible users found. Exiting job.');
      return results;
    }

    for (const user of eligibleUsers) {
      logger.info(`[CRON_JOB] Processing user ${user.id} (Email: ${user.email}, Current Balance: ${user.credit_balance}) for credit refresh.`);
      
      const transactionResult = await performCreditTransaction(
        user.id,
        config.FREE_TIER_REFRESH_CREDITS,
        'free_tier_refresh',
        {
          customDescription: `Periodic ${config.FREE_TIER_REFRESH_CREDITS} credit refresh for free tier.`,
        }
      );

      if (transactionResult.success) {
        results.successfulRefreshes++;
        logger.info(`[CRON_JOB] Successfully refreshed credits for user ${user.id}. New balance: ${transactionResult.newBalance}`);
      } else {
        results.failedRefreshes++;
        results.errors.push({ userId: user.id, error: transactionResult.error || 'Unknown error' });
        logger.error(`[CRON_JOB] Failed to refresh credits for user ${user.id}: ${transactionResult.error}`);
      }
    }

    logger.info(`[CRON_JOB] refreshFreeTierCredits job finished. Processed: ${results.processedUsers}, Successful: ${results.successfulRefreshes}, Failed: ${results.failedRefreshes}`);
    if (results.failedRefreshes > 0) {
      logger.warn(`[CRON_JOB] Failures occurred. Errors: ${JSON.stringify(results.errors)}`);
    }

  } catch (error: unknown) {
    let L_errorMessage = 'Unknown error in cron job';
    if (error instanceof Error) {
        L_errorMessage = error.message;
    }
    logger.error(`[CRON_JOB] CRITICAL ERROR in refreshFreeTierCredits job: ${L_errorMessage}`, error);
  }
  return results;
}

// Example of how this might be called by a scheduler via an API route:
// in app/api/cron/refresh-free-credits/route.ts
// import { refreshFreeTierCredits } from '@/server/actions/cronActions';
// import { NextResponse } from 'next/server';
// export async function GET(request: Request) {
//   // Add authentication/secret key check here if needed
//   try {
//     const result = await refreshFreeTierCredits();
//     return NextResponse.json({ success: true, data: result });
//   } catch (error: any) {
//     return NextResponse.json({ success: false, error: error.message }, { status: 500 });
//   }
// } 