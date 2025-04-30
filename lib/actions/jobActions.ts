"use server";

import { z } from "zod";
import { db } from "@/server/db"; // Adjust path if necessary
import { transcriptionJobs } from "@/server/db/schema";
import { revalidatePath } from "next/cache"; // To trigger re-fetching on the dashboard
import { getAuthSession } from "@/lib/auth"; // Import the session utility
import { addTranscriptionJob } from "@/lib/queue/transcription-queue";

// Input schema validation using Zod
const SubmitJobSchema = z.object({
  videoUrl: z.string().url({ message: "Please enter a valid URL." }).refine(
    (url) => {
        try {
            const parsedUrl = new URL(url);
            const hostname = parsedUrl.hostname;
            if (hostname === "youtube.com" || hostname === "www.youtube.com") {
                return parsedUrl.searchParams.has("v");
            }
            if (hostname === "youtu.be") {
                return parsedUrl.pathname.length > 1;
            }
            return false;
        } catch {
            return false;
        }
    }, { message: "Please enter a valid YouTube video URL."}
  ),
  quality: z.enum(["standard", "premium"]),
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

  console.log(`Submit Job Action called by User ID: ${userId}`); // <<< Changed: Log the string ID

  // --- 2. Validation ---
  const validatedFields = SubmitJobSchema.safeParse({
    videoUrl: formData.get("videoUrl"),
    quality: formData.get("quality"),
  });

  if (!validatedFields.success) {
    console.error("Validation Errors:", validatedFields.error.flatten().fieldErrors);
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
    console.log(`Adding job for URL ${videoUrl} to queue...`);
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
        quality // Pass quality also as priority hint
    ); 
    console.log(`Job added to queue with ID: ${jobId}`);

    // --- 4. Database Interaction (Uses jobId from queue) ---
    console.log(`Creating job ${jobId} in DB...`);
    await db.insert(transcriptionJobs).values({
      id: jobId, // Use jobId from queue function
      userId: userId, // <<< Changed: Link to authenticated user using the string ID
      videoUrl: videoUrl,
      quality: quality,
      status: "pending", // Initial status
      origin: "INTERNAL", // Mark as internal origin
      createdAt: new Date(), 
      updatedAt: new Date(), 
    });
    console.log(`Job ${jobId} created successfully in DB.`);

    // --- 5. Trigger Revalidation (Optional but recommended) ---
    // Tells Next.js to refetch data for the dashboard path
    revalidatePath("/dashboard");

    return { success: true, jobId: jobId };

  } catch (error) {
    // Improved error logging
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error submitting job:", errorMessage, error); 
    // TODO: Implement more robust error handling/rollback if necessary
    return { success: false, error: `Failed to submit job: ${errorMessage}` };
  }
} 