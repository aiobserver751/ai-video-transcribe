import { NextResponse, NextRequest } from "next/server"; // Import NextRequest
import { db } from "@/server/db"; // Adjust path to your db instance
import { transcriptionJobs } from "@/server/db/schema";
import { eq, desc } from "drizzle-orm";
import { getAuthSession, validateApiKey } from "@/lib/auth"; // Import session & apiKey utilities
import { logger } from '../../../lib/logger';

export async function GET(request: NextRequest) { // Use NextRequest to access headers
  let userId: string | null = null;
  let authSource: string | null = null;

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
    logger.warn("[JobsAPI] API /api/jobs: Unauthorized access attempt.");
    return new NextResponse("Unauthorized", { status: 401 });
  }

  logger.info(`[JobsAPI] API /api/jobs called by User ID: ${userId} (Auth: ${authSource})`);

  try {
    // --- Database Fetch ---
    const userJobs = await db.query.transcriptionJobs.findMany({
      where: eq(transcriptionJobs.userId, userId),
      orderBy: [desc(transcriptionJobs.createdAt)],
      // Add other fields if needed, or select specific columns
    });

    // --- Response ---
    // Return jobs directly, TanStack Query expects the array
    return NextResponse.json(userJobs);

  } catch (error) {
    logger.error("[JobsAPI] Failed to fetch jobs:", error);
    // Return a generic server error response
    return new NextResponse("Internal ServerError", { status: 500 });
  }
} 