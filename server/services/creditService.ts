import { db } from "@/server/db";
import { users, creditTransactions, type creditTransactionTypeEnum, type qualityEnum as QualityEnumType } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { z } from 'zod';
import { logger } from "@/lib/logger"; // Assuming you might want to use logger here too

logger.info('[CreditService] Credit Service DB instance:', db ? 'Loaded' : 'Not Loaded'); // DIAGNOSTIC LOG

// --- Environment Variable Loading & Validation ---
const creditEnvSchema = z.object({FREE_TIER_INITIAL_CREDITS: z.coerce.number().int().positive(), FREE_TIER_REFRESH_CREDITS: z.coerce.number().int().positive(),FREE_TIER_REFRESH_INTERVAL_DAYS: z.coerce.number().int().positive(),  FREE_TIER_MAX_CREDITS: z.coerce.number().int().positive(),STARTER_TIER_MONTHLY_CREDITS: z.coerce.number().int().positive(),  PRO_TIER_MONTHLY_CREDITS: z.coerce.number().int().positive(),  CREDITS_CAPTION_FIRST_FIXED: z.coerce.number().int().positive(),  CREDITS_PER_10_MIN_STANDARD: z.coerce.number().int().positive(),  CREDITS_PER_10_MIN_PREMIUM: z.coerce.number().int().positive(),  CREDITS_BASIC_SUMMARY_FIXED: z.coerce.number().int().positive(),  CREDITS_EXTENDED_SUMMARY_FIXED: z.coerce.number().int().positive(),});
let creditConfig: ReturnType<typeof creditEnvSchema.parse> | undefined;

export function getCreditConfig() {
  if (!creditConfig) {
    try {
      creditConfig = creditEnvSchema.parse({
        FREE_TIER_INITIAL_CREDITS: process.env.FREE_TIER_INITIAL_CREDITS,
        FREE_TIER_REFRESH_CREDITS: process.env.FREE_TIER_REFRESH_CREDITS,
        FREE_TIER_REFRESH_INTERVAL_DAYS: process.env.FREE_TIER_REFRESH_INTERVAL_DAYS,
        FREE_TIER_MAX_CREDITS: process.env.FREE_TIER_MAX_CREDITS,
        STARTER_TIER_MONTHLY_CREDITS: process.env.STARTER_TIER_MONTHLY_CREDITS,
        PRO_TIER_MONTHLY_CREDITS: process.env.PRO_TIER_MONTHLY_CREDITS,
        CREDITS_CAPTION_FIRST_FIXED: process.env.CREDITS_CAPTION_FIRST_FIXED,
        CREDITS_PER_10_MIN_STANDARD: process.env.CREDITS_PER_10_MIN_STANDARD,
        CREDITS_PER_10_MIN_PREMIUM: process.env.CREDITS_PER_10_MIN_PREMIUM,
        CREDITS_BASIC_SUMMARY_FIXED: process.env.CREDITS_BASIC_SUMMARY_FIXED,
        CREDITS_EXTENDED_SUMMARY_FIXED: process.env.CREDITS_EXTENDED_SUMMARY_FIXED,
      });
    } catch (error) {
      logger.error("[CreditService] Invalid credit system environment variables:", error); // Changed to logger
      throw new Error("Credit system configuration is invalid. Check environment variables.");
    }
  }
  return creditConfig;
}

// --- Credit Calculation Service ---
export function calculateCreditCost(
  jobQuality: typeof QualityEnumType.enumValues[number],
  videoLengthMinutesActual: number | null): number {
  const config = getCreditConfig();
  switch (jobQuality) {
    case 'caption_first':
      return config.CREDITS_CAPTION_FIRST_FIXED;
    case 'standard':
      if (videoLengthMinutesActual === null || videoLengthMinutesActual < 0) {
        // Consider logging this error before throwing
        logger.warn('[CreditService] Valid video length is required for Standard quality transcription cost calculation.');
        throw new Error('Valid video length is required for Standard quality transcription cost calculation.');
      }
      const blocksStandard = Math.max(1, Math.ceil(videoLengthMinutesActual / 10));
      return blocksStandard * config.CREDITS_PER_10_MIN_STANDARD;
    case 'premium':
      if (videoLengthMinutesActual === null || videoLengthMinutesActual < 0) {
        // Consider logging this error before throwing
        logger.warn('[CreditService] Valid video length is required for Premium quality transcription cost calculation.');
        throw new Error('Valid video length is required for Premium quality transcription cost calculation.');
      }
      const blocksPremium = Math.max(1, Math.ceil(videoLengthMinutesActual / 10));
      return blocksPremium * config.CREDITS_PER_10_MIN_PREMIUM;
    default:
      logger.error(`[CreditService] Unknown job quality for credit calculation: ${jobQuality}`);
      throw new Error(`Unknown job quality for credit calculation: ${jobQuality}`);
  }
}

// --- Credit Management Service ---
interface PerformCreditTransactionDetails {
  jobId?: string;
  videoLengthMinutesCharged?: number;
  customDescription?: string;
}

interface PerformCreditTransactionResult {
  success: boolean;
  newBalance?: number;
  error?: string;
  transactionId?: string;
}

export async function performCreditTransaction(
  userId: string,
  transactionAmount: number, 
  transactionType: typeof creditTransactionTypeEnum.enumValues[number],
  details: PerformCreditTransactionDetails = {}
): Promise<PerformCreditTransactionResult> {
  const config = getCreditConfig();

  if (transactionAmount < 0) {
    logger.warn(`[CreditService] performCreditTransaction called with negative amount: ${transactionAmount} for user ${userId}`);
    return { success: false, error: "Transaction amount cannot be negative." };
  }

  try {
    // MODIFIED: Removed db.transaction wrapper.
    // Operations will now use 'db.' directly and are not atomic.

    // Fetch user. Note: Without 'for("update")' from a transaction, there's a slight chance of a race condition
    // if multiple credit operations for the SAME user happen at the exact same microsecond.
    // Given typical web request patterns, this risk is usually low for this kind of operation.
    const currentUserArray = await db
      .select({ id: users.id, credit_balance: users.credit_balance, subscriptionTier: users.subscriptionTier })
      .from(users)
      .where(eq(users.id, userId))
      // .for("update") // This cannot be used without a transaction
      .limit(1);

    if (!currentUserArray || currentUserArray.length === 0) {
      logger.error(`[CreditService] performCreditTransaction: User not found with ID ${userId}`);
      // Since we're not in a transaction, no need to throw to rollback. Return error directly.
      return { success: false, error: "User not found." }; 
    }
    const user = currentUserArray[0];
    const creditsBefore = user.credit_balance;
    let creditsAfter: number;
    let actualAmountProcessed = transactionAmount;

    const isAddition = [
      'initial_allocation',
      'free_tier_refresh',
      'paid_tier_renewal',
      'job_failure_refund',
      'manual_adjustment_add',
    ].includes(transactionType);

    if (isAddition) {
      creditsAfter = creditsBefore + actualAmountProcessed;
      // Special handling for free_tier_refresh to cap at FREE_TIER_MAX_CREDITS
      if (transactionType === 'free_tier_refresh' && user.subscriptionTier === 'free') {
        if (creditsBefore >= config.FREE_TIER_MAX_CREDITS) {
          actualAmountProcessed = 0; // No credits to add
          creditsAfter = creditsBefore; // Balance remains the same
        } else if (creditsAfter > config.FREE_TIER_MAX_CREDITS) {
          actualAmountProcessed = config.FREE_TIER_MAX_CREDITS - creditsBefore; // Credits to add to reach max
          creditsAfter = config.FREE_TIER_MAX_CREDITS; // Cap balance at max
        }
        // For other additions, no cap is applied here (e.g. initial_allocation, paid_tier_renewal)
      }
      // Special handling for paid_tier_renewal - balance becomes the transactionAmount
      if (transactionType === 'paid_tier_renewal') {
        creditsAfter = actualAmountProcessed; // Set balance directly to new tier's allowance
      }
    } else { // Deduction
      if (creditsBefore < actualAmountProcessed) {
        logger.warn(`[CreditService] performCreditTransaction: Insufficient credits for user ${userId}. Has ${creditsBefore}, needs ${actualAmountProcessed}. Type: ${transactionType}`);
        return { success: false, error: "Insufficient credits." };
      }
      creditsAfter = creditsBefore - actualAmountProcessed;
    }

    if (creditsAfter < 0) {
      // This should ideally be caught by 'Insufficient credits' for deductions,
      // or calculations for additions should prevent this.
      logger.error(`[CreditService] performCreditTransaction: Calculated negative balance for user ${userId}. Before: ${creditsBefore}, Amount: ${actualAmountProcessed}, Type: ${transactionType}, After: ${creditsAfter}`);
      return { success: false, error: "Credit balance calculation resulted in a negative value." };
    }

    // Only update user balance if it actually changed
    if (creditsBefore !== creditsAfter){
      await db
        .update(users)
        .set({ credit_balance: creditsAfter })
        .where(eq(users.id, userId));
      logger.info(`[CreditService] Updated credit balance for user ${userId} from ${creditsBefore} to ${creditsAfter}`);
    } else {
      logger.info(`[CreditService] Credit balance for user ${userId} remains ${creditsBefore} (no change needed). Type: ${transactionType}, Amount: ${actualAmountProcessed}`);
    }

    // Update refresh timestamp only if credits were actually added during a free refresh
    if (transactionType === 'free_tier_refresh' && isAddition && actualAmountProcessed > 0) {
      await db
        .update(users)
        .set({ credits_refreshed_at: new Date() })
        .where(eq(users.id, userId));
      logger.info(`[CreditService] Updated credits_refreshed_at for user ${userId} due to ${transactionType}`);
    }

    const description = details.customDescription ||
      `${isAddition ? (actualAmountProcessed > 0 ? 'Added' : (transactionType === 'free_tier_refresh' ? 'Refresh attempt (at max/no change)' : 'Adjusted')) : 'Spent'} ${actualAmountProcessed} credits: ${transactionType}${details.jobId ? ` (Job ID: ${details.jobId})` : ''}`;

    let transactionId: string | undefined = undefined;
    // Log transaction if it's a deduction, or an addition that actually processed credits, or any free_tier_refresh attempt
    if (!isAddition || actualAmountProcessed > 0 || transactionType === 'free_tier_refresh') {
      const [newTransaction] = await db
        .insert(creditTransactions)
        .values({
          userId: userId,
          jobId: details.jobId || null,
          amount: actualAmountProcessed, // Log the actual amount processed
          type: transactionType,
          description: description,
          video_length_minutes_charged: details.videoLengthMinutesCharged || null,
          user_credits_before: creditsBefore,
          user_credits_after: creditsAfter,
        })
        .returning({ id: creditTransactions.id });
      
      if (!newTransaction?.id) {
        logger.error(`[CreditService] performCreditTransaction: Failed to insert credit transaction log for user ${userId} and type ${transactionType}, but balance may have been updated.`);
        // Return success:true because the primary goal (balance update, if any) might have succeeded.
        // The caller (e.g. Auth event) might not need to fail entirely due to logging issue.
        // However, this is a data integrity concern that should be monitored.
        return { success: true, newBalance: creditsAfter, error: "Failed to log transaction, but balance updated." };
      }
      transactionId = newTransaction.id;
      logger.info(`[CreditService] Logged credit transaction ${transactionId} for user ${userId}. Type: ${transactionType}, Amount: ${actualAmountProcessed}`);
    }

    return {
      success: true,
      newBalance: creditsAfter,
      transactionId: transactionId,
    };

  } catch (error) {
    logger.error(`[CreditService] Critical error in performCreditTransaction for user ${userId}, type ${transactionType}:`, error);
    let errorMessage = "An unexpected error occurred during the credit transaction.";
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    // If an error occurs mid-way (e.g., after updating balance but before logging),
    // the state might be inconsistent. This is the risk of not using DB transactions.
    return { success: false, error: errorMessage };
  }
}