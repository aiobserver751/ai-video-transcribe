'use server';

import { db } from '@/server/db';
import { transcriptionJobs } from '@/server/db/schema'; // Assuming this is your table
import { eq } from 'drizzle-orm';
import type { TranscriptionJob } from '@/lib/types';
import { unstable_noStore as noStore } from 'next/cache'; // Import unstable_noStore

export async function getJobDetails(jobId: string): Promise<TranscriptionJob | null> {
  noStore(); // Opt out of caching for this action

  if (!jobId) {
    return null;
  }

  try {
    const jobResult = await db
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
        video_length_minutes_actual: transcriptionJobs.video_length_minutes_actual,
        credits_charged: transcriptionJobs.credits_charged
      })
      .from(transcriptionJobs)
      .where(eq(transcriptionJobs.id, jobId))
      .limit(1);

    if (jobResult.length === 0) {
      return null;
    }

    const job = jobResult[0];

    // Ensure all fields match the TranscriptionJob type, especially enums
    return {
      ...job,
      createdAt: new Date(job.createdAt),
      updatedAt: new Date(job.updatedAt),
      quality: job.quality, // Should align with qualityEnum from schema
      status: job.status,   // Should align with jobStatusEnum from schema
      origin: job.origin,   // Should align with jobOriginEnum from schema
      video_length_minutes_actual: job.video_length_minutes_actual ?? null,
      credits_charged: job.credits_charged ?? null,
      // Ensure other optional fields are handled (e.g., ?? null)
      statusMessage: job.statusMessage ?? null,
      transcriptionText: job.transcriptionText ?? null,
      userId: job.userId ?? null,
      transcriptionFileUrl: job.transcriptionFileUrl ?? null,
    } as TranscriptionJob; // Cast is okay if you are sure of the shape

  } catch (error) {
    console.error(`Failed to fetch job details for job ${jobId}:`, error);
    return null; 
  }
} 