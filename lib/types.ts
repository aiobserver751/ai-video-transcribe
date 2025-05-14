import { jobStatusEnum, qualityEnum, jobOriginEnum } from "@/server/db/schema"; // Import enums

export type JobQuality = typeof qualityEnum.enumValues[number];
export type JobStatus = typeof jobStatusEnum.enumValues[number];
export type JobOrigin = typeof jobOriginEnum.enumValues[number];

export interface TranscriptionJob {
  id: string;
  userId?: string | null; 
  videoUrl: string;
  quality: JobQuality;
  status: JobStatus;
  origin: JobOrigin;
  statusMessage?: string | null;
  transcriptionText?: string | null;
  srtFileText?: string | null;
  vttFileText?: string | null;
  createdAt: Date;
  updatedAt: Date;
  transcriptionFileUrl?: string | null;
  srtFileUrl?: string | null;
  vttFileUrl?: string | null;
  video_length_minutes_actual?: number | null;
  credits_charged?: number | null;
}

// For User Preferences
export interface UserPreferences {
  defaultQuality?: JobQuality | string; // Allow string for flexibility if values aren't strictly from enum initially
  // Add other preferences here as needed
}

// For API Key validation response
export interface ApiKeyValidationResult {
  isValid: boolean;
  userId?: string; // Or number, depending on your user ID type
  error?: string;
} 