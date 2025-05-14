import { NextResponse, NextRequest } from "next/server";
import { db } from "@/server/db"; // Adjust path to your db instance
import { transcriptionJobs } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { getAuthSession, validateApiKey } from "@/lib/auth"; // Import session & apiKey utilities
import { logger } from '../../../../lib/logger';

interface RouteContext {
  params: {
    jobId: string;
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { jobId } = context.params;
  let userId: string | null = null;
  let authSource: string | null = null;

  if (!jobId) {
    return new NextResponse("Job ID is required", { status: 400 });
  }

  // --- Authentication --- Priority: API Key > Session ---

  // 1. Check for API Key
  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const apiKey = authHeader.substring(7); // Extract key after "Bearer "
    const validatedUserId = await validateApiKey(apiKey);
    if (validatedUserId !== null) {
      userId = String(validatedUserId);
      authSource = "API Key";
    }
  }

  // 2. If no valid API Key, check for Session
  if (userId === null) {
    const session = await getAuthSession();
    const userIdString = session?.user?.id;
     if (userIdString) {
        userId = userIdString;
        authSource = "Session";
    }
  }

  // 3. If neither worked, deny access
  if (userId === null) {
     logger.warn(`[JobsAPI] API /api/jobs/${jobId}: Unauthorized access attempt.`);
    return new NextResponse("Unauthorized", { status: 401 });
  }

  logger.info(`[JobsAPI] API /api/jobs/${jobId} called by User ID: ${userId} (Auth: ${authSource})`);

  try {
    // --- Database Fetch ---
    // Find the job by ID and ensure it belongs to the authenticated user
    const job = await db.query.transcriptionJobs.findFirst({
      where: and(
        eq(transcriptionJobs.id, jobId),
        eq(transcriptionJobs.userId, userId)
      ),
    });

    // --- Response ---
    if (!job) {
      // Return 404 if job not found or doesn't belong to the user
      return new NextResponse("Job not found", { status: 404 });
    }

    // Return the specific job details
    return NextResponse.json(job);

  } catch (error) {
    logger.error(`[JobsAPI] Failed to fetch job ${jobId}:`, error);
    // Return a generic server error response
    return new NextResponse("Internal Server Error", { status: 500 });
  }
} 