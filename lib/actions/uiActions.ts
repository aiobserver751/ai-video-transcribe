"use server";

// import { z } from "zod"; // Removed unused import
import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "@/lib/logger"; // Assuming logger setup
import { isYouTubeUrl } from "@/lib/utils/urlUtils"; // Added import

const execAsync = promisify(exec);

// Removed YouTubeUrlSchema and isYouTubeUrlForUICheck as we now use the centralized isYouTubeUrl

export async function checkYouTubeCaptionAvailability(url: string): Promise<{
  captionsAvailable: boolean;
  durationInMinutes: number | null;
  error?: string;
}> {
  if (!isYouTubeUrl(url)) { // Use imported isYouTubeUrl
    // If it's not a YouTube URL, captions are considered unavailable by this function's scope.
    // The SubmitJobForm will show a more specific message for TikTok/Instagram if caption_first is selected.
    return { captionsAvailable: false, durationInMinutes: null, error: 'Caption checking is only applicable to YouTube URLs.' };
  }

  try {
    logger.info(`[uiActions] Checking caption/duration for YouTube URL (using -j): ${url}`);
    
    // Single call to yt-dlp to get all metadata as JSON
    const command = `yt-dlp -j --no-warnings --skip-download "${url}"`; // Added --skip-download for safety, though -j implies it.
    const { stdout, stderr } = await execAsync(command);

    if (stderr && !stdout) { // If stderr has content AND stdout is empty, likely a critical error from yt-dlp
        logger.error(`[uiActions] yt-dlp critical error for ${url}: ${stderr}`);
        return { captionsAvailable: false, durationInMinutes: null, error: `yt-dlp error: ${stderr.substring(0, 200)}` };
    } 
    // Log warnings from stderr if stdout also exists (yt-dlp might put non-critical info here)
    if (stderr && stdout) {
        logger.warn(`[uiActions] yt-dlp warnings for ${url}: ${stderr}`);
    }

    if (!stdout) {
      logger.error(`[uiActions] No stdout from yt-dlp -j for ${url}`);
      return { captionsAvailable: false, durationInMinutes: null, error: 'No data received from video processor.' };
    }

    let videoInfo;
    try {
      videoInfo = JSON.parse(stdout);
    } catch (parseError: unknown) {
      const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
      logger.error(`[uiActions] Failed to parse yt-dlp JSON output for ${url}: ${errorMessage}. Output was: ${stdout.substring(0,500)}`);
      return { captionsAvailable: false, durationInMinutes: null, error: 'Failed to parse video information.' };
    }

    let durationInMinutes: number | null = null;
    if (videoInfo && typeof videoInfo.duration === 'number') {
      if (videoInfo.duration > 0) {
        durationInMinutes = Math.max(1, Math.ceil(videoInfo.duration / 60));
      } else {
        durationInMinutes = 0; // Duration is 0 or less, treat as 0 minutes (e.g. for upcoming live streams)
      }
    } else {
      logger.warn(`[uiActions] Duration not found or invalid in yt-dlp JSON for ${url}. videoInfo.duration: ${videoInfo?.duration}`);
      // Duration isn't strictly critical for the UI pre-check for caption availability, can proceed with null or 0.
      // Let's use 0 to indicate N/A or unreadable, as some flows might expect a number.
      durationInMinutes = 0; 
    }

    let captionsAvailable = false;
    // Check for user-uploaded English subtitles
    if (videoInfo && videoInfo.subtitles && videoInfo.subtitles.en && Array.isArray(videoInfo.subtitles.en) && videoInfo.subtitles.en.length > 0) {
      captionsAvailable = true;
      logger.info(`[uiActions] Found user-uploaded English subtitles for ${url} via JSON.`);
    }
    // If not found, check for auto-generated English subtitles
    if (!captionsAvailable && videoInfo && videoInfo.automatic_captions && videoInfo.automatic_captions.en && Array.isArray(videoInfo.automatic_captions.en) && videoInfo.automatic_captions.en.length > 0) {
      captionsAvailable = true;
      logger.info(`[uiActions] Found auto-generated English subtitles for ${url} via JSON.`);
    }

    if (!captionsAvailable) {
      logger.info(`[uiActions] No English subtitles (manual or auto) reported in JSON for ${url}`);
    }

    logger.info(`[uiActions] Result for ${url}: Captions: ${captionsAvailable}, Duration: ${durationInMinutes} min`);
    return { captionsAvailable, durationInMinutes };

  } catch (error: unknown) {
    const execError = error as (Error & { stdout?: string; stderr?: string }); // Type assertion for exec errors
    const errorMessage = execError.message || String(error);
    logger.error(`[uiActions] Outer error in checkYouTubeCaptionAvailability for ${url}: ${errorMessage}`);
    if (execError.stderr) {
      logger.error(`[uiActions] Stderr from failing command: ${execError.stderr}`);
    }
    if (execError.stdout) {
      logger.error(`[uiActions] Stdout from failing command: ${execError.stdout}`);
    }    
    
    // Check for common yt-dlp specific error messages in stderr or message
    const fullErrorText = `${errorMessage} ${execError.stderr || ''}`;
    if (fullErrorText.includes('Unsupported URL')) {
      return { captionsAvailable: false, durationInMinutes: null, error: 'Invalid or unsupported URL.' };
    }
    if (fullErrorText.includes('Video unavailable')) {
      return { captionsAvailable: false, durationInMinutes: null, error: 'Video is unavailable.' };
    }
    if (fullErrorText.includes('Private video')) {
      return { captionsAvailable: false, durationInMinutes: null, error: 'Video is private.' };
    }
    if (fullErrorText.includes('Premiere in') || fullErrorText.includes('live event in')){
      return { captionsAvailable: false, durationInMinutes: 0, error: 'Video is an upcoming live stream/premiere.' };
    }

    return { captionsAvailable: false, durationInMinutes: null, error: `Failed to check captions: ${errorMessage.substring(0,100)}` };
  }
}

// Keep existing createPresignedUrl, deleteJobAction, etc.
// ... existing code ... 