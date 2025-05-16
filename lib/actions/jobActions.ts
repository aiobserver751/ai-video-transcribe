"use server";

import { z } from "zod";
import { db } from "@/server/db"; // Adjust path if necessary
import { transcriptionJobs, qualityEnum } from "@/server/db/schema"; // Import qualityEnum
import { revalidatePath } from "next/cache"; // To trigger re-fetching on the dashboard
import { getAuthSession } from "@/lib/auth"; // Import the session utility
import { addTranscriptionJob } from "@/lib/queue/transcription-queue";
import { logger } from '../logger';
import { getVideoPlatform, isValidPlatformUrl } from "@/lib/utils/urlUtils"; // Added import

// Define an enum for summary types (can be moved to a shared location if needed)
const summaryTypeEnum = z.enum(['none', 'basic', 'extended']);

// Input schema validation using Zod
const SubmitJobSchema = z.object({
  videoUrl: z.string().url({ message: "Please enter a valid URL." })
    .refine(url => isValidPlatformUrl(url), { // Ensure it's a supported platform
      message: "Invalid video URL. Only YouTube, TikTok, and Instagram Reels are supported."
    }),
  quality: z.enum(qualityEnum.enumValues),
  summary_type: summaryTypeEnum.optional().default('none'),
}).superRefine((data, ctx) => {
  const platform = getVideoPlatform(data.videoUrl);
  if (data.quality === 'caption_first') {
    if (platform !== 'youtube') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "For 'Caption First' quality, a valid YouTube video URL is required. Other platforms like TikTok and Instagram Reels are not supported for this quality setting.",
        path: ["videoUrl"],
      });
    }
    // No need for the try-catch for URL parsing here as z.string().url() and getVideoPlatform handle it
  }
  // No specific cross-field validation needed if quality is not 'caption_first'
  // and platform is YouTube, as any valid URL from a supported platform is accepted then.
});

export async function submitJobAction(formData: FormData) {
  // --- 1. Authentication ---
  const session = await getAuthSession(); // Get user session
  // Use optional chaining and nullish coalescing for safety
  const userId = session?.user?.id; // <<< Changed: Keep as string (UUID)

  if (!userId) { // <<< Changed: Check the string directly
    return { success: false, error: "User not authenticated." };
  }
  // Assuming user ID from session is a string (like from JWT sub) that needs parsing if DB expects integer
  // Adjust parsing based on your actual user ID type in the DB and session
  // let userId: number; // <<< Removed: No longer needed
  // try { // <<< Removed: No parsing needed
  //   userId = parseInt(userIdString, 10);
  //   if (isNaN(userId)) throw new Error("User ID is not a number");
  // } catch (e) {
  //    console.error("Failed to parse user ID from session:", userIdString, e);
  //    return { success: false, error: "Invalid user session." };
  // }

  logger.info(`[JobAction] Submit Job Action called by User ID: ${userId}`); // <<< Changed: Log the string ID

  // --- 2. Validation ---
  const validatedFields = SubmitJobSchema.safeParse({
    videoUrl: formData.get("videoUrl"),
    quality: formData.get("quality"),
    summary_type: formData.get("summary_type"), // NEW: Get summary_type from formData
  });

  if (!validatedFields.success) {
    logger.error("[JobAction] Validation Errors:", validatedFields.error.flatten().fieldErrors);
    return {
      success: false,
      error: "Invalid input.",
      fieldErrors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const { videoUrl, quality, summary_type } = validatedFields.data;
  let jobId: string; // Declare jobId here

  try {
    // --- 3. Add to Queue (Gets jobId) ---
    logger.info(`[JobAction] Adding job for URL ${videoUrl} with quality ${quality} and summary ${summary_type} to queue...`); // Updated log
    // Pass data matching Omit<TranscriptionJobData, 'jobId'>
    // Assuming apiKey is not needed for internal jobs & fallback is true
    // Pass userId as optional field
    jobId = await addTranscriptionJob(
        { 
            url: videoUrl, 
            quality: quality, 
            fallbackOnRateLimit: true, // Sensible default for UI jobs
            userId: userId, // <<< Changed: Pass original string ID
            apiKey: "", // No API key for internal job
            // callback_url: undefined // No callback for internal jobs
            summary_type: summary_type, // NEW: Pass summary_type to queue
        }, 
        // Adjust priority: 'caption_first' jobs get 'standard' priority
        quality === 'caption_first' ? 'standard' : quality 
    ); 
    logger.info(`[JobAction] Job added to queue with ID: ${jobId}`);

    // --- 4. Database Interaction (Uses jobId from queue) ---
    logger.info(`[JobAction] Creating preliminary job ${jobId} in DB...`);
    await db.insert(transcriptionJobs).values({
      id: jobId, // Use jobId from queue function
      userId: userId, // <<< Changed: Link to authenticated user using the string ID
      videoUrl: videoUrl,
      quality: quality,
      status: "pending_credit_deduction",
      origin: "INTERNAL", // Mark as internal origin
      // summaryType: summary_type, // Worker will handle actual summary type and storage if needed
      createdAt: new Date(), 
      updatedAt: new Date(),
    });
    logger.info(`[JobAction] Preliminary job ${jobId} created successfully in DB with status 'pending_credit_deduction'.`);

    // --- 5. Trigger Revalidation (Optional but recommended) ---
    // Tells Next.js to refetch data for the dashboard path
    revalidatePath("/dashboard");

    return {
      success: true,
      jobId: jobId,
      message: "Job submitted successfully. Credits will be deducted after video analysis."
    };

  } catch (error) {
    // Improved error logging
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("[JobAction] Error submitting job:", errorMessage, error); 
    // TODO: Implement more robust error handling/rollback if necessary
    return { success: false, error: `Failed to submit job: ${errorMessage}` };
  }
} 