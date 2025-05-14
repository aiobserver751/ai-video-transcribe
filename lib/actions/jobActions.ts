"use server";

import { z } from "zod";
import { db } from "@/server/db"; // Adjust path if necessary
import { transcriptionJobs, qualityEnum } from "@/server/db/schema"; // Import qualityEnum
import { revalidatePath } from "next/cache"; // To trigger re-fetching on the dashboard
import { getAuthSession } from "@/lib/auth"; // Import the session utility
import { addTranscriptionJob } from "@/lib/queue/transcription-queue";
import { logger } from '../logger';

// Input schema validation using Zod
const SubmitJobSchema = z.object({
  videoUrl: z.string().url({ message: "Please enter a valid URL." }),
  quality: z.enum(qualityEnum.enumValues),
}).superRefine((data, ctx) => {
  if (data.quality === 'caption_first') {
    try {
      const parsedUrl = new URL(data.videoUrl);
      const hostname = parsedUrl.hostname.toLowerCase(); // Normalize hostname
      const isYouTube = (hostname === "youtube.com" || hostname === "www.youtube.com") && parsedUrl.searchParams.has("v");
      const isYoutuBe = hostname === "youtu.be" && parsedUrl.pathname.length > 1;

      if (!isYouTube && !isYoutuBe) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "For 'Caption First' quality, a valid YouTube video URL is required (e.g., youtube.com?v=VIDEO_ID or youtu.be/VIDEO_ID). Other platforms are not supported for this quality setting.",
          path: ["videoUrl"],
        });
      }
    } catch {
      // This might happen if the URL is malformed, though z.string().url() should catch it first.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid URL format. Please enter a valid video URL.",
        path: ["videoUrl"],
      });
    }
  }
  // No specific cross-field validation needed if quality is not 'caption_first',
  // as any valid URL is accepted then.
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
  });

  if (!validatedFields.success) {
    logger.error("[JobAction] Validation Errors:", validatedFields.error.flatten().fieldErrors);
    return {
      success: false,
      error: "Invalid input.",
      fieldErrors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const { videoUrl, quality } = validatedFields.data;
  let jobId: string; // Declare jobId here

  try {
    // --- 3. Add to Queue (Gets jobId) ---
    logger.info(`[JobAction] Adding job for URL ${videoUrl} with quality ${quality} to queue...`);
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