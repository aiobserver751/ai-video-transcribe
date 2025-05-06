export interface TranscriptionJob {
  id: string;
  videoUrl: string;
  quality: "standard" | "premium";
  status: "processing" | "completed" | "failed" | "pending";
  origin: "INTERNAL" | "EXTERNAL";
  statusMessage?: string | null;
  transcriptionText?: string | null;
  createdAt: Date;
  updatedAt: Date;
  userId?: string | null;
  transcriptionFileUrl?: string | null;
} 