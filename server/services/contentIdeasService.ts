import { db as defaultDb } from '@/server/db';
import { transcriptionJobs, contentIdeaJobs, creditTransactionTypeEnum, contentIdeaJobTypeEnum, jobStatusEnum } from '@/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { performCreditTransaction, getCreditConfig } from './creditService'; // Removed CreditCalculationResult from import
import { getVideoPlatform } from "@/lib/utils/urlUtils"; // For YouTube check
import { fetchYouTubeComments } from '@/server/utils/youtubeHelper'; // NEW IMPORT

// Defined CreditCalculationResult interface locally
interface CreditCalculationResult {
  cost: number;
  error?: string;
  videoLengthMinutes?: number; // Optional, matches existing structure in creditService if we adapt further
  chargeableUnits?: number;    // Optional
  unitType?: string;           // Optional
}

interface CreateJobInput {
  transcriptionId: string;
  jobType: typeof contentIdeaJobTypeEnum.enumValues[number];
}

interface ServiceResult {
  success: boolean;
  jobId?: string;
  error?: string;
  errorMessage?: string;
  status?: typeof jobStatusEnum.enumValues[number];
}

export class ContentIdeasService {
  private db: typeof defaultDb; // Use inferred type from defaultDb
  private userId: string;

  constructor(dbInstance = defaultDb, userId: string) { // Removed explicit PgDatabase type
    this.db = dbInstance;
    this.userId = userId;
  }

  private async calculateCreditCostForContentIdea(
    jobType: typeof contentIdeaJobTypeEnum.enumValues[number],
    videoUrl: string
  ): Promise<CreditCalculationResult> {
    const creditConfig = await getCreditConfig(); // Fetch current credit costs

    if (jobType === 'normal') {
      return { cost: creditConfig.CONTENT_IDEA_NORMAL_CREDIT_COST, videoLengthMinutes: 0, chargeableUnits: 1, unitType: 'job' };
    }

    if (jobType === 'comments') {
      let minCommentsForAnalysis = 25; // Default value
      const minCommentsEnv = process.env.MIN_YOUTUBE_COMMENTS_FOR_ANALYSIS;
      if (minCommentsEnv) {
        const parsedMin = parseInt(minCommentsEnv, 10);
        if (!isNaN(parsedMin) && parsedMin >= 0) {
          minCommentsForAnalysis = parsedMin;
        } else {
          logger.warn(`[ContentIdeasService] Invalid MIN_YOUTUBE_COMMENTS_FOR_ANALYSIS value: "${minCommentsEnv}". Defaulting to 25.`);
          // minCommentsForAnalysis remains 25 as per initialization
        }
      }

      // Use the new fetchYouTubeComments utility
      const maxCommentsEnv = process.env.MAX_YOUTUBE_COMMENTS_TO_FETCH;
      const commentFetchResult = await fetchYouTubeComments(videoUrl, maxCommentsEnv);

      if (commentFetchResult.error) {
        logger.error(`[ContentIdeasService] Error fetching comments for ${videoUrl}: ${commentFetchResult.error}`);
        // If fetching comments fails, we can't proceed with credit calculation for comment-based jobs.
        return { error: `Failed to fetch comments: ${commentFetchResult.error}`, cost: 0 };
      }

      const commentCount = commentFetchResult.commentCount; // This is the *total* count reported by yt-dlp before our internal truncation
      logger.info(`[ContentIdeasService] Video ${videoUrl} has ${commentCount} total comments reported by yt-dlp.`);

      if (commentCount < minCommentsForAnalysis) {
        return { error: `Not enough comments for analysis. A minimum of ${minCommentsForAnalysis} comments is required.`, cost: 0 };
      }

      let cost = 0;
      // Match comment count to tiers defined in .env
      if (commentCount >= 25 && commentCount <= 100) cost = creditConfig.CONTENT_IDEA_COMMENT_SMALL_CREDIT_COST;
      else if (commentCount > 100 && commentCount <= 500) cost = creditConfig.CONTENT_IDEA_COMMENT_MEDIUM_CREDIT_COST;
      else if (commentCount > 500 && commentCount <= 1000) cost = creditConfig.CONTENT_IDEA_COMMENT_LARGE_CREDIT_COST;
      else if (commentCount > 1000 && commentCount <= 2000) cost = creditConfig.CONTENT_IDEA_COMMENT_XLARGE_CREDIT_COST; 
      else if (commentCount > 2000) { // Exceeds max fetchable/analyzable
        // Option 1: Cap at XLARGE cost if we process up to 2000
        cost = creditConfig.CONTENT_IDEA_COMMENT_XLARGE_CREDIT_COST;
        logger.warn(`[ContentIdeasService] Comment count ${commentCount} exceeds 2000. Capping cost at XLARGE tier for video ${videoUrl}.`);
        // Option 2: Or return an error if we don't want to process >2000 comments
        // return { error: "Video has too many comments (max 2000).", cost: 0 }; 
      } else {
        return { error: "Could not determine comment analysis credit tier.", cost: 0 };
      }
      return { cost, videoLengthMinutes: 0, chargeableUnits: commentCount, unitType: 'comments' };
    }
    return { error: "Invalid job type for credit calculation.", cost: 0 };
  }

  async createJob(input: CreateJobInput): Promise<ServiceResult> {
    logger.info(`[ContentIdeasService] User ${this.userId} attempting to create ${input.jobType} content idea job for transcription ${input.transcriptionId}`);

    // 1. Validate parent transcription job
    const parentJob = await this.db.query.transcriptionJobs.findFirst({
      where: and(
        eq(transcriptionJobs.id, input.transcriptionId),
        eq(transcriptionJobs.userId, this.userId) // Ensure user owns the transcription
      )
    });

    if (!parentJob) {
      logger.warn(`[ContentIdeasService] Transcription job ${input.transcriptionId} not found for user ${this.userId}.`);
      return { success: false, error: "Transcription job not found.", errorMessage: "The original transcription job could not be found or you do not have permission to access it." };
    }

    if (parentJob.status !== 'completed') {
      logger.warn(`[ContentIdeasService] Transcription job ${input.transcriptionId} is not completed. Current status: ${parentJob.status}.`);
      return { success: false, error: "Transcription job not completed.", errorMessage: "Content ideas can only be generated for completed transcriptions." };
    }

    if (input.jobType === 'comments') {
      const platform = getVideoPlatform(parentJob.videoUrl);
      if (platform !== 'youtube') {
        logger.warn(`[ContentIdeasService] Comment analysis requested for non-YouTube URL: ${parentJob.videoUrl} (Platform: ${platform})`);
        return { success: false, error: "Comment analysis only for YouTube.", errorMessage: "Comment analysis is only available for YouTube videos." };
      }
    }

    // 2. Calculate Credit Cost
    const creditCalculation = await this.calculateCreditCostForContentIdea(input.jobType, parentJob.videoUrl);
    if (creditCalculation.error || typeof creditCalculation.cost !== 'number' || creditCalculation.cost < 0) {
      logger.error(`[ContentIdeasService] Credit calculation error for user ${this.userId}, jobType ${input.jobType}: ${creditCalculation.error}`);
      return { success: false, error: "Credit calculation failed.", errorMessage: creditCalculation.error || "Could not determine the credit cost for this operation." };
    }
    const creditsToCharge = creditCalculation.cost;
    
    // If creditCalculation returned an error (e.g., not enough comments), creditsToCharge would be 0.
    // The error message from creditCalculation.error should be used.
    if (creditsToCharge === 0 && creditCalculation.error && input.jobType === 'comments') {
        return { success: false, error: creditCalculation.error, errorMessage: creditCalculation.error };
    }

    // 3. Create the Content Idea Job record (initially pending, or directly with failure status if credits are an issue)
    const newContentIdeaJobId = `ci_${crypto.randomUUID()}`;

    // Attempt to deduct credits
    // Define transaction type based on jobType
    const transactionType: typeof creditTransactionTypeEnum.enumValues[number] = 
      input.jobType === 'normal' ? 'content_idea_normal' : 'content_idea_comments';
    
    const transactionDescription = `Content Ideas: ${input.jobType} for transcription ${input.transcriptionId}`;

    // Create the Content Idea Job record FIRST
    // This ensures the record exists before performCreditTransaction tries to reference it.
    await this.db.insert(contentIdeaJobs).values({
        id: newContentIdeaJobId,
        userId: this.userId,
        transcriptionId: input.transcriptionId,
        jobType: input.jobType,
        videoUrl: parentJob.videoUrl,
        status: 'pending_credit_deduction', // Initial status
        creditsCharged: 0, // Will update after successful credit deduction
        statusMessage: 'Awaiting credit deduction',
        createdAt: new Date(),
    });
    logger.info(`[ContentIdeasService] Created initial content idea job ${newContentIdeaJobId} with status 'pending_credit_deduction'.`);

    // Attempt to deduct credits
    const creditTransaction = await performCreditTransaction(
        this.userId, 
        creditsToCharge, 
        transactionType, // Use the determined specific transaction type
        {
          jobId: input.transcriptionId, // Corrected: This should be the parent transcription ID
          contentIdeaJobId: newContentIdeaJobId, // NEW: Pass the content idea job ID
          customDescription: transactionDescription,
        }
    );

    let finalStatus: typeof jobStatusEnum.enumValues[number] = 'pending_credit_deduction';

    if (!creditTransaction.success) {
        if (creditTransaction.error?.includes('Insufficient credits')) {
            finalStatus = 'failed_insufficient_credits';
        } else {
            finalStatus = 'failed'; // Generic failure if credit transaction failed for other reasons
        }
        logger.error(`[ContentIdeasService] Credit transaction failed for user ${this.userId} creating job ${newContentIdeaJobId}. Reason: ${creditTransaction.error}`);
        // Create the job record even if credit deduction fails, to log the attempt and failure reason
        await this.db.update(contentIdeaJobs).set({
            status: finalStatus,
            statusMessage: creditTransaction.error || "Credit deduction failed.",
            creditsCharged: 0, // No credits were successfully charged
        }).where(eq(contentIdeaJobs.id, newContentIdeaJobId));
        return { 
            success: false, 
            error: creditTransaction.error || "Credit deduction failed.", 
            errorMessage: creditTransaction.error || "Failed to process credits for this job. Please check your balance or contact support.",
            jobId: newContentIdeaJobId, 
            status: finalStatus 
        };
    }

    // Credits successfully deducted (or transaction initiated)
    finalStatus = 'pending'; // Ready to be picked up by the worker

    await this.db.update(contentIdeaJobs).set({
      status: finalStatus,
      creditsCharged: creditsToCharge, // Store the actual credits charged
      statusMessage: 'Credit deduction successful. Job is pending processing.'
    }).where(eq(contentIdeaJobs.id, newContentIdeaJobId));

    logger.info(`[ContentIdeasService] Successfully finalized content idea job ${newContentIdeaJobId} for user ${this.userId} with status ${finalStatus}. Credits charged: ${creditsToCharge}`);
    return {
      success: true,
      jobId: newContentIdeaJobId,
      status: finalStatus
    };
  }
} 