'use server';

import { db } from '@/server/db';
import { transcriptionJobs } from '@/server/db/schema'; // Assuming this is your table
import { eq, and, gte, lte, sql } from 'drizzle-orm';
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
        srtFileText: transcriptionJobs.srt_file_text,
        vttFileText: transcriptionJobs.vtt_file_text,
        createdAt: transcriptionJobs.createdAt,
        updatedAt: transcriptionJobs.updatedAt,
        userId: transcriptionJobs.userId,
        transcriptionFileUrl: transcriptionJobs.transcriptionFileUrl,
        srtFileUrl: transcriptionJobs.srtFileUrl,
        vttFileUrl: transcriptionJobs.vttFileUrl,
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
      srtFileText: job.srtFileText ?? null,
      vttFileText: job.vttFileText ?? null,
      userId: job.userId ?? null,
      transcriptionFileUrl: job.transcriptionFileUrl ?? null,
      srtFileUrl: job.srtFileUrl ?? null,
      vttFileUrl: job.vttFileUrl ?? null,
    } as TranscriptionJob; // Cast is okay if you are sure of the shape

  } catch (error) {
    console.error(`Failed to fetch job details for job ${jobId}:`, error);
    return null; 
  }
}

export async function getWeeklyTranscriptionCount(userId: string): Promise<number> {
  noStore(); // Opt out of caching for this action

  if (!userId) {
    console.error("getWeeklyTranscriptionCount: userId is required");
    return 0;
  }

  try {
    const today = new Date();
    const dayOfWeek = today.getDay(); // Sunday - 0, Monday - 1, ..., Saturday - 6
    
    // Calculate the start of the week (assuming week starts on Sunday)
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);

    // Calculate the end of the week (assuming week ends on Saturday)
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const result = await db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(transcriptionJobs)
      .where(
        and(
          eq(transcriptionJobs.userId, userId),
          gte(transcriptionJobs.createdAt, startOfWeek),
          lte(transcriptionJobs.createdAt, endOfWeek)
        )
      );
      
    return result[0]?.count || 0;
  } catch (error) {
    console.error(`Failed to fetch weekly transcription count for user ${userId}:`, error);
    return 0; // Return 0 in case of an error
  }
}

// Updated function to get daily transcription stats for a number of days
export async function getDailyTranscriptionStats(
  userId: string, 
  numberOfDays: number = 7
): Promise<{ date: string; transcriptions: number; summaries: number }[]> {
  noStore();

  if (!userId) {
    console.error("getDailyTranscriptionStats: userId is required");
    return [];
  }
  if (numberOfDays <= 0) {
    console.error("getDailyTranscriptionStats: numberOfDays must be positive");
    return [];
  }

  try {
    const endDate = new Date(); // Today
    endDate.setHours(23, 59, 59, 999); // End of today

    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - (numberOfDays - 1)); // Go back (numberOfDays - 1) days to include today
    startDate.setHours(0, 0, 0, 0); // Start of that day

    // Fetch jobs within the date range
    const jobs = await db
      .select({
        createdAt: transcriptionJobs.createdAt,
        basicSummary: transcriptionJobs.basicSummary,
        extendedSummary: transcriptionJobs.extendedSummary,
      })
      .from(transcriptionJobs)
      .where(
        and(
          eq(transcriptionJobs.userId, userId),
          gte(transcriptionJobs.createdAt, startDate),
          lte(transcriptionJobs.createdAt, endDate)
        )
      )
      .orderBy(transcriptionJobs.createdAt); // Order by date to make grouping easier

    // Initialize daily counts
    const dailyCounts: { [key: string]: { transcriptions: number; summaries: number } } = {};
    for (let i = 0; i < numberOfDays; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const dateString = d.toISOString().split('T')[0];
      dailyCounts[dateString] = { transcriptions: 0, summaries: 0 };
    }

    // Populate counts from fetched jobs
    for (const job of jobs) {
      if (job.createdAt) {
        const dateString = new Date(job.createdAt).toISOString().split('T')[0];
        if (dailyCounts[dateString] !== undefined) {
          dailyCounts[dateString].transcriptions++;
          if ((job.basicSummary && job.basicSummary.trim() !== '') || 
              (job.extendedSummary && job.extendedSummary.trim() !== '')) {
            dailyCounts[dateString].summaries++;
          }
        }
      }
    }

    // Convert to the desired array format, sorted by date
    const result = Object.entries(dailyCounts)
      .map(([date, counts]) => ({ 
        date, 
        transcriptions: counts.transcriptions, 
        summaries: counts.summaries 
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return result;

  } catch (error) {
    console.error(`Failed to fetch daily transcription stats for user ${userId}:`, error);
    return []; // Return empty array in case of an error
  }
} 