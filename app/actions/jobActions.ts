'use server';

import { db } from '@/server/db';
import { transcriptionJobs } from '@/server/db/schema'; // Assuming this is your table
import { eq } from 'drizzle-orm';
import type { TranscriptionJob } from '@/lib/types';

export async function getJobDetails(jobId: string): Promise<TranscriptionJob | null> {
  if (!jobId) {
    return null;
  }

  try {
    const job = await db
      .select({
        id: transcriptionJobs.id,
        videoUrl: transcriptionJobs.videoUrl,
        quality: transcriptionJobs.quality,
        status: transcriptionJobs.status,
        origin: transcriptionJobs.origin,
        statusMessage: transcriptionJobs.statusMessage,
        transcriptionText: transcriptionJobs.transcriptionText,
        createdAt: transcriptionJobs.createdAt,
        updatedAt: transcriptionJobs.updatedAt,
        userId: transcriptionJobs.userId,
        transcriptionFileUrl: transcriptionJobs.transcriptionFileUrl,
      })
      .from(transcriptionJobs)
      .where(eq(transcriptionJobs.id, jobId))
      .limit(1);

    if (job.length === 0) {
      return null;
    }

    // Drizzle returns dates as strings if not configured otherwise at driver/db level,
    // or if they are actual date objects, they are fine.
    // The TranscriptionJob type expects Date objects.
    // We need to ensure they are Date objects before returning.
    const result = job[0];
    return {
      ...result,
      createdAt: new Date(result.createdAt),
      updatedAt: new Date(result.updatedAt),
      // Ensure quality and status match the literal types if necessary, though select should handle it.
      quality: result.quality as 'standard' | 'premium',
      status: result.status as 'pending' | 'processing' | 'completed' | 'failed',
      origin: result.origin as 'INTERNAL' | 'EXTERNAL', // Assuming origin is also an enum in schema
    };

  } catch (error) {
    console.error(`Failed to fetch job details for job ${jobId}:`, error);
    // Depending on error handling strategy, you might throw the error or return null
    return null; 
  }
} 