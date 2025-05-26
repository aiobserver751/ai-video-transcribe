import { Queue, Worker, QueueEvents } from 'bullmq';
import { createRedisConnection, QUEUE_NAMES, defaultJobOptions, PRIORITY } from './config'; // Assuming PRIORITY might be used later
import { logger } from '../logger';
import { db } from '../../server/db'; // Adjusted path assuming standard project structure
import { contentIdeaJobs, contentIdeaJobTypeEnum, transcriptionJobs as transcriptionJobsSchema } from '../../server/db/schema'; // Removed jobStatusEnum, corrected schema import name
import { eq } from 'drizzle-orm';
import { generateNormalContentIdeas, generateCommentBasedContentIdeas } from '../../server/services/openaiService'; // Import the new service function
import { fetchYouTubeComments, processAndScoreComments, ScoredComment } from '../../server/utils/youtubeHelper'; // Import comment utilities

// --- Service Imports (Placeholder - to be implemented in later phases) ---
// import { OpenAIService } from '../../server/services/openaiService'; // For normal analysis & comment summary
// import { YouTubeCommentService } from '../../server/services/youtubeCommentService'; // For fetching/processing comments

// Define the structure of the job data for content ideas
export interface ContentIdeaJobData {
  contentIdeaJobId: string; // Primary key from content_idea_jobs table
  userId: string;
  transcriptionId: string;
  jobType: typeof contentIdeaJobTypeEnum.enumValues[number]; // 'normal' | 'comments'
  videoUrl: string;
  // Potentially add other relevant data needed by the worker, e.g., transcription text if needed directly
}

// Define the structure of the result returned by the worker (optional, can be simple status)
export interface ContentIdeaJobResult {
  success: boolean;
  message?: string;
  error?: string;
}

// Check if we're in build mode or Redis is disabled
const isRedisDisabled = process.env.DISABLE_REDIS_CONNECTION === 'true' || 
                       process.env.SKIP_REDIS_VALIDATION === 'true' ||
                       process.env.NODE_ENV === 'test' ||
                       process.env.NEXT_PHASE === 'phase-production-build' ||
                       process.env.BUILD_SKIP_STATIC_GENERATION === 'true';

// Lazy initialization of queues to prevent connections during build
let _contentIdeasQueue: Queue<ContentIdeaJobData, ContentIdeaJobResult> | null = null;
let _contentIdeasQueueEvents: QueueEvents | null = null;

// Getter for content ideas queue with lazy initialization
function getContentIdeasQueue(): Queue<ContentIdeaJobData, ContentIdeaJobResult> {
  if (isRedisDisabled) {
    logger.info('Redis disabled, returning mock queue for content ideas');
    // Return a mock queue object for build time
    return {
      add: () => Promise.resolve({ id: 'mock-job-id' }),
      getJob: () => Promise.resolve(null),
      close: () => Promise.resolve(),
      // Add other methods as needed for mock
    } as unknown as Queue<ContentIdeaJobData, ContentIdeaJobResult>;
  }

  if (!_contentIdeasQueue) {
    _contentIdeasQueue = new Queue<ContentIdeaJobData, ContentIdeaJobResult>(
      QUEUE_NAMES.CONTENT_IDEAS,
      {
        connection: createRedisConnection(),
        defaultJobOptions
      }
    );
  }
  
  return _contentIdeasQueue;
}

// Getter for content ideas queue events with lazy initialization
function getContentIdeasQueueEvents(): QueueEvents {
  if (isRedisDisabled) {
    logger.info('Redis disabled, returning mock queue events for content ideas');
    return {
      on: () => {},
      off: () => {},
      close: () => Promise.resolve(),
    } as unknown as QueueEvents;
  }

  if (!_contentIdeasQueueEvents) {
    _contentIdeasQueueEvents = new QueueEvents(QUEUE_NAMES.CONTENT_IDEAS, {
      connection: createRedisConnection()
    });
  }
  
  return _contentIdeasQueueEvents;
}

// Export getters instead of direct instances
export const contentIdeasQueue = new Proxy({} as Queue<ContentIdeaJobData, ContentIdeaJobResult>, {
  get(target, prop) {
    return getContentIdeasQueue()[prop as keyof Queue<ContentIdeaJobData, ContentIdeaJobResult>];
  }
});

export const contentIdeasQueueEvents = new Proxy({} as QueueEvents, {
  get(target, prop) {
    return getContentIdeasQueueEvents()[prop as keyof QueueEvents];
  }
});

// Add a content idea job to the queue
export async function addContentIdeaJob(
  data: ContentIdeaJobData,
  priorityValue: number = PRIORITY.STANDARD // Default to standard priority
): Promise<string> {
  // The jobId for BullMQ should be unique, using the DB job ID directly is good
  const bullJobId = data.contentIdeaJobId;

  await contentIdeasQueue.add(
    data.jobType, // Job name could be the type of analysis e.g., 'normal' or 'comments'
    data,
    {
      jobId: bullJobId,
      priority: priorityValue,
    }
  );
  logger.info(`[${bullJobId}] Content idea job added to queue. Type: ${data.jobType}`);
  return bullJobId;
}

// Worker for processing content idea jobs
export function startContentIdeasWorker(concurrency = 3) { // Adjust concurrency as needed
  const worker = new Worker<ContentIdeaJobData, ContentIdeaJobResult>(
    QUEUE_NAMES.CONTENT_IDEAS,
    async (job) => {
      const { contentIdeaJobId, transcriptionId, jobType, videoUrl } = job.data;
      logger.info(`[${contentIdeaJobId}] Starting processing for content idea job. Type: ${jobType}`);

      try {
        // Update job status to 'processing'
        await db.update(contentIdeaJobs)
          .set({ status: 'processing' })
          .where(eq(contentIdeaJobs.id, contentIdeaJobId));

        await job.updateProgress({ percentage: 10, stage: 'starting', message: 'Job picked up by worker' });

        let resultTxt: string | undefined | null = null;
        let resultJson: object | undefined | null = null;

        if (jobType === 'normal') {
          logger.info(`[${contentIdeaJobId}] Starting 'normal' content idea processing for transcription ID: ${transcriptionId}. Attempting to fetch transcription data.`);
          
          const transcriptionRecord = await db.query.transcriptionJobs.findFirst({
            where: eq(transcriptionJobsSchema.id, transcriptionId),
            columns: {
              transcriptionText: true,
              basicSummary: true,
              extendedSummary: true,
            }
          });

          if (!transcriptionRecord) {
            logger.error(`[${contentIdeaJobId}] CRITICAL: Transcription record not found in DB for ID: ${transcriptionId}. Cannot proceed.`);
            throw new Error(`Transcription record not found for ID: ${transcriptionId}`);
          }
          logger.info(`[${contentIdeaJobId}] Fetched transcription record from DB. Checking for transcriptionText presence.`);

          if (!transcriptionRecord.transcriptionText) {
            logger.error(`[${contentIdeaJobId}] CRITICAL: Transcription text is missing in fetched DB record for ID: ${transcriptionId}. Text is null or empty.`);
            throw new Error(`Transcription text not found for transcription ID: ${transcriptionId}`);
          }
          logger.info(`[${contentIdeaJobId}] Transcription text found. Length: ${transcriptionRecord.transcriptionText.length}.`);
          
          const inputText = transcriptionRecord.transcriptionText;
          const summaryToUse = transcriptionRecord.extendedSummary || transcriptionRecord.basicSummary || null;

          logger.debug(`[${contentIdeaJobId}] Prepared inputText (len: ${inputText.length}, first 100 chars): ${inputText.substring(0,100)}`);
          logger.debug(`[${contentIdeaJobId}] Prepared summaryToUse (len: ${summaryToUse ? summaryToUse.length : 'N/A'}, first 100 chars): ${summaryToUse ? summaryToUse.substring(0,100) : 'null or empty'}`);
          
          logger.info(`[${contentIdeaJobId}] About to call openaiService.generateNormalContentIdeas.`);
          const openAIResults = await generateNormalContentIdeas(inputText, summaryToUse);
          logger.info(`[${contentIdeaJobId}] Returned from openaiService.generateNormalContentIdeas. Result text present: ${!!openAIResults.resultTxt}, Result JSON present: ${!!openAIResults.resultJson}`);

          resultTxt = openAIResults.resultTxt;
          resultJson = openAIResults.resultJson;

          if (!resultTxt && !resultJson) {
            throw new Error('OpenAI service returned no text and no JSON content for normal analysis.');
          }

          await job.updateProgress({ percentage: 80, stage: 'llm_completed', message: 'Ideas generated' });
          logger.info(`[${contentIdeaJobId}] Normal Analysis LLM call completed.`);

        } else if (jobType === 'comments') {
          logger.info(`[${contentIdeaJobId}] Performing Comment Analysis for video: ${videoUrl}...`);
          
          // 1. Fetch parent transcription text
          await job.updateProgress({ percentage: 15, stage: 'fetching_transcript', message: 'Fetching parent transcript' });
          const transcriptionRecord = await db.query.transcriptionJobs.findFirst({
            where: eq(transcriptionJobsSchema.id, transcriptionId),
            columns: { transcriptionText: true }
          });

          if (!transcriptionRecord || !transcriptionRecord.transcriptionText) {
            throw new Error(`Transcription text not found for transcription ID: ${transcriptionId} (for comment analysis)`);
          }
          const transcriptText = transcriptionRecord.transcriptionText;
          logger.info(`[${contentIdeaJobId}] Parent transcript fetched.`);

          // 2. Fetch YouTube comments
          await job.updateProgress({ percentage: 30, stage: 'fetching_comments', message: 'Fetching YouTube comments' });
          const maxCommentsEnv = process.env.MAX_YOUTUBE_COMMENTS_TO_FETCH;
          const commentFetchResult = await fetchYouTubeComments(videoUrl, maxCommentsEnv);

          if (commentFetchResult.error || !commentFetchResult.comments) {
            throw new Error(`Failed to fetch YouTube comments for ${videoUrl}: ${commentFetchResult.error || 'No comments returned'}`);
          }
          logger.info(`[${contentIdeaJobId}] Fetched ${commentFetchResult.comments.length} raw comments (out of ${commentFetchResult.commentCount} total).`);

          // 3. Process and Score Comments
          await job.updateProgress({ percentage: 50, stage: 'processing_comments', message: 'Processing & scoring comments' });
          const processedCommentResult = await processAndScoreComments(commentFetchResult.comments, transcriptText);

          if (processedCommentResult.error || !processedCommentResult.scoredComments) {
            throw new Error(`Failed to process/score comments for ${videoUrl}: ${processedCommentResult.error || 'No scored comments returned'}`);
          }
          logger.info(`[${contentIdeaJobId}] Processed ${processedCommentResult.scoredComments.length} comments. ${processedCommentResult.filteredCount} were filtered out.`);

          // 4. Prepare comments string for LLM (take top N scored comments, e.g., top 20-50, or based on total length)
          // For now, let's take up to the first 50 meaningfully scored comments. This needs refinement.
          // A more sophisticated approach would be to consider token limits and overall context window.
          const topCommentsForLLM = processedCommentResult.scoredComments
            .sort((a, b) => (b.scores.combined || b.scores.engagement || 0) - (a.scores.combined || a.scores.engagement || 0)) // Sort by combined or engagement
            .slice(0, 50) // Take top 50
            .map((c: ScoredComment, index: number) => `Comment ${index + 1} (Likes: ${c.like_count || 0}):\n${c.processedText}`)
            .join("\n\n---\n\n");
          
          if (!topCommentsForLLM.trim()) {
            // This could happen if all comments were filtered out, or if processing failed to produce usable text.
            logger.warn(`[${contentIdeaJobId}] No comments available to send to LLM after processing. Using transcript only.`);
             // Decide how to handle: Fallback to normal analysis? Or generate error? For now, proceed but LLM might not be effective.
          }
          await job.updateProgress({ percentage: 65, stage: 'preparing_llm_input', message: 'Preparing input for LLM' });

          // 5. Call LLM via OpenAIService
          logger.info(`[${contentIdeaJobId}] Calling OpenAI service for comment-based content ideas.`);
          const openAIResults = await generateCommentBasedContentIdeas(transcriptText, topCommentsForLLM);
          resultTxt = openAIResults.resultTxt;
          resultJson = openAIResults.resultJson;

          if (!resultTxt && !resultJson) {
            throw new Error('OpenAI service returned no text and no JSON content for comment analysis.');
          }
          await job.updateProgress({ percentage: 90, stage: 'llm_completed', message: 'Ideas generated from comments' });
          logger.info(`[${contentIdeaJobId}] Comment Analysis LLM call completed.`);

        } else {
          throw new Error(`Unsupported job type: ${jobType}`);
        }

        // Update job status to 'completed' and store results
        await db.update(contentIdeaJobs)
          .set({
            status: 'completed',
            completedAt: new Date(),
            resultTxt: resultTxt, // resultTxt can be string or null
            resultJson: resultJson, // resultJson can be object or null
            statusMessage: null,
          })
          .where(eq(contentIdeaJobs.id, contentIdeaJobId));

        await job.updateProgress({ percentage: 100, stage: 'completed', message: 'Job completed successfully' });
        logger.info(`[${contentIdeaJobId}] Job completed successfully.`);
        return { success: true, message: 'Job processed successfully' };

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`[${contentIdeaJobId}] Error processing content idea job: ${errorMessage}`, error);

        await db.update(contentIdeaJobs)
          .set({ status: 'failed', statusMessage: errorMessage })
          .where(eq(contentIdeaJobs.id, contentIdeaJobId));
        
        // No need to call job.moveToFailed(), BullMQ handles this if error is thrown
        throw error; // Propagate error to BullMQ to mark job as failed
      }
    },
    {
      connection: createRedisConnection(),
      concurrency,
      autorun: true, // Start worker automatically
    }
  );

  worker.on('completed', (job, result: ContentIdeaJobResult | undefined) => {
    if (job && result) {
      logger.info(`Job ${job.id} (Content Idea) completed. Result: ${result.message}`);
    } else if (job) {
      logger.warn(`Job ${job.id} (Content Idea) completed but result object is missing or malformed.`);
    }
  });

  worker.on('failed', (job, error) => {
    const jobMsg = job ? `Job ${job.id} (Content Idea)` : 'A content idea job';
    logger.error(`${jobMsg} failed. Error: ${error.message}.`);
  });

  worker.on('error', (error: Error) => {
    logger.error(`Content Ideas Worker error: ${error.message}`);
  });

  logger.info(`Content Ideas worker started with concurrency: ${concurrency}`);
  return worker;
} 