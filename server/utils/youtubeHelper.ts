import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '@/lib/logger';

const execAsync = promisify(exec);

export interface YouTubeComment {
  text: string;
  author: string;
  author_id: string;
  author_url: string;
  id: string;
  timestamp: number; // Unix timestamp
  time_text: string; // e.g., "1 week ago"
  like_count?: number;
  is_favorited?: boolean;
  author_is_uploader?: boolean;
  parent?: string; // 'root' or comment_id for replies
  replies?: YouTubeComment[]; // yt-dlp can fetch replies
  // Note: actual structure may vary slightly, adjust as needed based on yt-dlp output
}

export interface FetchYouTubeCommentsResult {
  comments: YouTubeComment[];
  commentCount: number;
  error?: string;
  rawOutput?: string; // For debugging
}

/**
 * Fetches comments from a YouTube video URL using yt-dlp.
 * @param videoUrl The URL of the YouTube video.
 * @param maxComments The maximum number of comments to return (approximate, as yt-dlp fetches in pages).
 * @returns A promise that resolves to FetchYouTubeCommentsResult.
 */
export async function fetchYouTubeComments(
  videoUrl: string,
  maxCommentsToFetchEnv: string | undefined
): Promise<FetchYouTubeCommentsResult> {
  const maxComments = parseInt(maxCommentsToFetchEnv || '2000', 10); // Default to 2000 if env not set

  // Using --get-comments with --dump-json will include comments in the main JSON output
  // yt-dlp usually fetches comments in pages, so we might get slightly more than maxComments
  // if the limit falls in the middle of a page. We'll truncate later if needed.
  // Sorting by "newest" is generally good for relevance if we have to truncate.
  // Some extractors might not support sorting, so we make it best-effort.
  // The --comment-sort-key newest is not a standard yt-dlp option. 
  // yt-dlp fetches comments as provided by the YouTube API, usually newest first or top comments.
  // We will handle truncation after fetching.
  
  const command = `yt-dlp --skip-download --dump-json --get-comments --no-warnings "${videoUrl}"`;
  logger.info(`[youtubeHelper] Fetching comments for ${videoUrl} with command: ${command}`);

  try {
    const { stdout, stderr } = await execAsync(command, { maxBuffer: 1024 * 1024 * 10 }); // 10MB buffer

    if (stderr && !stdout) {
      logger.error(`[youtubeHelper] yt-dlp critical error for ${videoUrl}: ${stderr}`);
      return { comments: [], commentCount: 0, error: `yt-dlp error: ${stderr.substring(0, 500)}` };
    }
    if (stderr && stdout) {
      logger.warn(`[youtubeHelper] yt-dlp warnings for ${videoUrl}: ${stderr}`);
    }

    if (!stdout) {
      logger.error(`[youtubeHelper] No stdout from yt-dlp for comments: ${videoUrl}`);
      return { comments: [], commentCount: 0, error: 'No data received from video processor for comments.' };
    }

    let videoInfo;
    try {
      videoInfo = JSON.parse(stdout);
    } catch (parseError: unknown) {
      const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
      logger.error(`[youtubeHelper] Failed to parse yt-dlp JSON output for comments: ${errorMessage}. Output snippet: ${stdout.substring(0, 1000)}`);
      return { comments: [], commentCount: 0, error: 'Failed to parse video comment information.', rawOutput: stdout.substring(0,2000) };
    }

    if (!videoInfo.comments || !Array.isArray(videoInfo.comments)) {
      logger.warn(`[youtubeHelper] 'comments' field not found or not an array in yt-dlp output for ${videoUrl}. Video might have comments disabled or an unexpected API response.`);
      // It's possible for a video to have 0 comments, or for comments to be disabled.
      // This isn't strictly an error if the 'comments' key is present but empty or null.
      // However, if the 'comments' key is missing entirely from a successful yt-dlp JSON dump, it might indicate an issue.
      // For now, treat as 0 comments if key is missing or not an array.
      return { comments: [], commentCount: 0 };
    }
    
    let fetchedComments: YouTubeComment[] = videoInfo.comments;
    
    // yt-dlp's --get-comments sometimes returns comments and their replies nested.
    // For a flat list and accurate count, we might need to flatten them.
    // However, the initial requirement is just to fetch and count for credit calculation.
    // The scoring algorithm might want to handle replies differently.
    // For now, we'll count based on the top-level comments array provided by yt-dlp.
    // The actual number of comments might be higher if replies are deeply nested and not part of this top-level array count.
    // Let's assume videoInfo.comments is a flat list of top-level comments for now, or includes replies in its structure.
    // For a more accurate "total" count including replies, a recursive flattening might be needed.

    const commentCount = fetchedComments.length; // Initial count
    
    // Truncate if necessary (primary top-level comments)
    if (fetchedComments.length > maxComments) {
      logger.info(`[youtubeHelper] Truncating ${fetchedComments.length} comments to ${maxComments} for ${videoUrl}`);
      fetchedComments = fetchedComments.slice(0, maxComments);
    }
    
    logger.info(`[youtubeHelper] Successfully fetched ${fetchedComments.length} comments (out of ${commentCount} total top-level) for ${videoUrl}.`);
    return { comments: fetchedComments, commentCount: commentCount }; // Return original count for billing, but truncated list for processing.

  } catch (error: unknown) {
    const execError = error as (Error & { stdout?: string; stderr?: string });
    const errorMessage = execError.message || String(error);
    logger.error(`[youtubeHelper] Error in fetchYouTubeComments for ${videoUrl}: ${errorMessage}`);
    if (execError.stderr) logger.error(`[youtubeHelper] Stderr from failing command: ${execError.stderr}`);
    if (execError.stdout) logger.error(`[youtubeHelper] Stdout from failing command: ${execError.stdout}`);
    return { comments: [], commentCount: 0, error: `Failed to fetch comments: ${errorMessage.substring(0, 200)}`, rawOutput: execError.stdout || execError.stderr };
  }
}

export interface ScoredComment extends YouTubeComment {
  scores: {
    relevance?: number;    // Placeholder
    quality?: number;      // Placeholder
    engagement?: number;
    recency?: number;      // Placeholder
    uniqueness?: number;   // Placeholder
    combined?: number;     // Placeholder
  };
  processedText: string; // Text after basic cleaning
}

export interface ProcessedCommentsResult {
  scoredComments: ScoredComment[];
  filteredCount: number; // How many were filtered out before scoring
  error?: string;
}

const MIN_COMMENT_LENGTH_WORDS = 5;

/**
 * Filters, processes, and scores YouTube comments based on various criteria.
 * (Initial implementation: basic filtering. Scoring to be added.)
 * @param comments Raw comments from fetchYouTubeComments.
 * @param transcriptText The text of the video transcript for context (optional, for future relevance scoring).
 * @returns A promise that resolves to ProcessedCommentsResult.
 */
export async function processAndScoreComments(
  rawComments: YouTubeComment[],
  _transcriptText?: string // Optional for now, will be used for relevance scoring
): Promise<ProcessedCommentsResult> {
  if (false) { console.log(_transcriptText); } // Temporary: Mark as used to satisfy linter
  if (!rawComments) {
    return { scoredComments: [], filteredCount: 0, error: "Input comments array is undefined." };
  }

  logger.info(`[youtubeHelper] Starting processing and scoring for ${rawComments.length} raw comments.`);
  let filteredCount = 0;
  
  const processedComments: ScoredComment[] = [];

  for (const comment of rawComments) {
    // 1. Basic Filtering
    const text = comment.text ? comment.text.trim() : "";
    if (!text) {
      filteredCount++;
      continue;
    }

    // Filter short comments
    if (text.split(/\s+/).length < MIN_COMMENT_LENGTH_WORDS) {
      filteredCount++;
      continue;
    }

    // Filter comments without any alphabetic characters (e.g., just emojis or numbers)
    if (!/[a-zA-Z]/.test(text)) {
      filteredCount++;
      continue;
    }

    // TODO: Spam/toxic comment filtering (can be basic keywords or more advanced)

    // 2. Basic Processing (more can be added, e.g., removing excessive punctuation, lowercasing for some scoring)
    const processedText = text; // For now, just use the trimmed text

    // 3. Engagement Score (simple example using like_count)
    const engagementScore = comment.like_count !== undefined ? Math.log1p(comment.like_count) : 0; // Log scale for likes

    // Placeholder for other scores
    processedComments.push({
      ...comment,
      processedText,
      scores: {
        engagement: engagementScore,
        // Other scores will be calculated later
      },
    });
  }

  // TODO: Implement Relevance, Quality, Recency, Uniqueness, and Combined scoring
  // TODO: Implement final sorting and selection based on combined score and diversity

  logger.info(`[youtubeHelper] Finished initial processing. ${processedComments.length} comments passed basic filters. ${filteredCount} comments filtered out.`);
  
  return {
    scoredComments: processedComments, // For now, these are just partially scored
    filteredCount,
  };
} 