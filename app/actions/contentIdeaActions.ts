'use server';

import { z } from 'zod';
import { getAuthSession } from '@/lib/auth';
import { db } from '@/server/db';
import { transcriptionJobs, contentIdeaJobs, contentIdeaJobTypeEnum, jobStatusEnum } from '@/server/db/schema';
import { addContentIdeaJob } from '@/lib/queue/content-ideas-queue';
import { ContentIdeasService } from '../../server/services/contentIdeasService'; // Corrected import path
import { logger } from '@/lib/logger';
import { eq, desc, and } from 'drizzle-orm'; // Removed unused 'and'

const CreateContentIdeaJobInput = z.object({
  transcriptionId: z.string().min(1, "Transcription ID cannot be empty."),
  jobType: z.enum(contentIdeaJobTypeEnum.enumValues) // 'normal' | 'comments'
});

export interface CreateContentIdeaJobResult {
  success: boolean;
  jobId?: string;
  error?: string;
  errorMessage?: string; // User-friendly message
}

export async function createContentIdeaJobAction(
  input: z.infer<typeof CreateContentIdeaJobInput>
): Promise<CreateContentIdeaJobResult> {
  logger.info('[ContentIdeaAction] Attempting to create content idea job with input:', input);

  const session = await getAuthSession();
  if (!session?.user?.id) {
    logger.warn('[ContentIdeaAction] User not authenticated.');
    return { success: false, error: 'User not authenticated.', errorMessage: "You must be logged in to perform this action." };
  }
  const userId = session.user.id;

  try {
    const validatedInput = CreateContentIdeaJobInput.safeParse(input);
    if (!validatedInput.success) {
      // Corrected Zod error formatting
      const errorMessages = validatedInput.error.errors.map((e) => `${e.path.join('.') || 'input'}: ${e.message}`).join("; ");
      logger.warn(`[createContentIdeaJobAction] Validation failed for user ${userId}: ${errorMessages}`, validatedInput.error.flatten());
      return { success: false, error: "Validation failed", errorMessage: errorMessages };
    }

    const { transcriptionId, jobType } = validatedInput.data;

    // Instantiate the service
    const contentIdeasService = new ContentIdeasService(db, userId);

    // Call the service method to handle the core logic
    const serviceResult = await contentIdeasService.createJob({
      transcriptionId,
      jobType,
    });

    if (!serviceResult.success || !serviceResult.jobId) {
      logger.error('[ContentIdeaAction] Service call failed or jobId missing:', serviceResult);
      return { 
        success: false, 
        error: serviceResult.error || 'Service error', 
        errorMessage: serviceResult.errorMessage || 'Could not create content idea job. Please try again.' 
      };
    }

    // If service call is successful, add to BullMQ queue
    // The service should have already created the DB record with an ID
    const parentTranscriptionJob = await db.query.transcriptionJobs.findFirst({
        where: eq(transcriptionJobs.id, transcriptionId)
    });
    if (!parentTranscriptionJob) {
        // This should ideally be caught by the service, but good to double check
        logger.error(`[ContentIdeaAction] Parent transcription job ${transcriptionId} not found after service call.`);
        return { success: false, error: "Parent transcription job not found.", errorMessage: "Original transcription not found." };
    }

    await addContentIdeaJob({
      contentIdeaJobId: serviceResult.jobId,
      userId,
      transcriptionId,
      jobType,
      videoUrl: parentTranscriptionJob.videoUrl, // Get videoUrl from parent job
    });

    logger.info(`[ContentIdeaAction] Successfully created and queued content idea job ${serviceResult.jobId} for user ${userId}`);
    return {
      success: true,
      jobId: serviceResult.jobId,
    };

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    logger.error('[ContentIdeaAction] Error creating content idea job:', error);
    // Check for specific error types if needed, e.g., insufficient credits from the service layer
    if (errorMessage.includes('Insufficient credits')) { // Example check
        return { success: false, error: 'Insufficient credits', errorMessage };
    }
    return { success: false, error: 'Internal server error', errorMessage: "An unexpected error occurred. Please try again later." };
  }
}

// --- NEW: Action to get content idea jobs for the current user ---
export interface ContentIdeaJobForList {
  id: string;
  jobType: typeof contentIdeaJobTypeEnum.enumValues[number];
  parentTranscriptionId: string;
  parentVideoUrl?: string | null; 
  status: typeof jobStatusEnum.enumValues[number]; // Use jobStatusEnum from schema
  createdAt: string; // Changed from Date to string
  statusMessage?: string | null;
}

export async function getContentIdeaJobsAction(): Promise<{
  success: boolean;
  jobs?: ContentIdeaJobForList[];
  error?: string;
}> {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return { success: false, error: "User not authenticated." };
  }
  const userId = session.user.id;

  try {
    const jobsData = await db.select({
        id: contentIdeaJobs.id,
        jobType: contentIdeaJobs.jobType,
        parentTranscriptionId: contentIdeaJobs.transcriptionId,
        parentVideoUrl: transcriptionJobs.videoUrl, 
        status: contentIdeaJobs.status,
        createdAt: contentIdeaJobs.createdAt,
        statusMessage: contentIdeaJobs.statusMessage,
      })
      .from(contentIdeaJobs)
      .leftJoin(transcriptionJobs, eq(contentIdeaJobs.transcriptionId, transcriptionJobs.id))
      .where(eq(contentIdeaJobs.userId, userId))
      .orderBy(desc(contentIdeaJobs.createdAt));
    
    // Explicitly convert dates to ISO strings for serialization
    const typedJobs: ContentIdeaJobForList[] = jobsData.map(job => ({
      ...job,
      // Ensure createdAt is a string. If it's null/undefined from DB, handle appropriately.
      createdAt: job.createdAt ? new Date(job.createdAt).toISOString() : 'N/A', // Fallback for safety, though schema is NOT NULL
      status: job.status as typeof jobStatusEnum.enumValues[number],
      jobType: job.jobType as typeof contentIdeaJobTypeEnum.enumValues[number],
    }));

    // Ensure the returned object is plain for Next.js serialization
    return { success: true, jobs: JSON.parse(JSON.stringify(typedJobs)) };

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "An unknown error occurred fetching content idea jobs.";
    logger.error(`[getContentIdeaJobsAction] Error for user ${userId}:`, err);
    return { success: false, error: errorMessage };
  }
}

// --- Interface for the structured JSON output from content idea generation ---
export interface ContentIdeaResultJson {
  overview_summary: string;
  content_ideas: Array<{
    title: string;
    description: string;
    format_suggestion: string;
    target_audience_segment: string;
    key_talking_points: string[];
  }>;
  content_strategy_recommendations: {
    primary_theme: string;
    secondary_themes: string[];
    potential_keywords: string[];
    call_to_action_suggestions: string[];
  };
  key_elements_from_transcript: {
    most_engaging_quotes_or_segments: string[];
    identified_problems_solved: string[];
    unique_perspectives_offered: string[];
  };
}

// --- Action to get details for a specific content idea job ---
export interface ContentIdeaJobDetails extends ContentIdeaJobForList { 
  resultTxt?: string | null;
  resultJson?: ContentIdeaResultJson | null; // Use the new specific interface
  parentTranscriptionText?: string | null;
  completedAt?: string | null; // Changed from Date | null to string | null
  creditsCharged: number;
}

export async function getContentIdeaJobDetailsAction(jobId: string): Promise<{
  success: boolean;
  job?: ContentIdeaJobDetails;
  error?: string;
}> {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return { success: false, error: "User not authenticated." };
  }
  const userId = session.user.id;

  if (!jobId) {
    return { success: false, error: "Job ID is required." };
  }

  try {
    const jobDataResult = await db.select({
        // Fields from contentIdeaJobs
        id: contentIdeaJobs.id,
        jobType: contentIdeaJobs.jobType,
        status: contentIdeaJobs.status,
        createdAt: contentIdeaJobs.createdAt,
        completedAt: contentIdeaJobs.completedAt,
        statusMessage: contentIdeaJobs.statusMessage,
        resultTxt: contentIdeaJobs.resultTxt,
        resultJson: contentIdeaJobs.resultJson,
        creditsCharged: contentIdeaJobs.creditsCharged,
        parentTranscriptionId: contentIdeaJobs.transcriptionId, // Alias for clarity if preferred
        // Fields from parent transcriptionJobs
        parentVideoUrl: transcriptionJobs.videoUrl,
        parentTranscriptionText: transcriptionJobs.transcriptionText, // Fetching for context
      })
      .from(contentIdeaJobs)
      .leftJoin(transcriptionJobs, eq(contentIdeaJobs.transcriptionId, transcriptionJobs.id))
      .where(and( // Ensure user owns the job
        eq(contentIdeaJobs.id, jobId),
        eq(contentIdeaJobs.userId, userId)
      ))
      .limit(1);

    if (!jobDataResult || jobDataResult.length === 0) {
      return { success: false, error: "Content idea job not found or user does not have access." };
    }

    const jobFromDb = jobDataResult[0]; // Renamed to avoid conflict with 'job' in return type
    
    // Explicitly convert dates to ISO strings for serialization
    const typedJob: ContentIdeaJobDetails = {
      ...jobFromDb,
      // Ensure createdAt is a string. If it's null/undefined from DB, handle appropriately.
      createdAt: jobFromDb.createdAt ? new Date(jobFromDb.createdAt).toISOString() : 'N/A', // Fallback for safety
      completedAt: jobFromDb.completedAt ? new Date(jobFromDb.completedAt).toISOString() : null,
      status: jobFromDb.status as typeof jobStatusEnum.enumValues[number],
      jobType: jobFromDb.jobType as typeof contentIdeaJobTypeEnum.enumValues[number],
      resultJson: jobFromDb.resultJson as ContentIdeaResultJson | null,
      creditsCharged: jobFromDb.creditsCharged,
    };

    // Ensure the returned object is plain for Next.js serialization
    return { success: true, job: JSON.parse(JSON.stringify(typedJob)) };

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "An unknown error occurred fetching job details.";
    logger.error(`[getContentIdeaJobDetailsAction] Error for job ${jobId}, user ${userId}:`, err);
    return { success: false, error: errorMessage };
  }
} 