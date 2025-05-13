import { jobStatusEnum, qualityEnum, jobOriginEnum } from "@/server/db/schema"; // Import enums

export interface TranscriptionJob {
  id: string;
  videoUrl: string;
  // Use a more flexible string type or the actual enum type if it can be imported here
  quality: typeof qualityEnum.enumValues[number]; 
  status: typeof jobStatusEnum.enumValues[number];
  origin: typeof jobOriginEnum.enumValues[number];
  statusMessage?: string | null;
  transcriptionText?: string | null;
  createdAt: Date;
  updatedAt: Date;
  userId?: string | null;
  transcriptionFileUrl?: string | null;
  // Added new fields
  video_length_minutes_actual?: number | null;
  credits_charged?: number | null;
} 