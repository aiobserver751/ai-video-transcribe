import type { TranscriptionJob } from "./types";

// Mock data for demonstration (Replace with actual API calls later)
export const initialJobs: TranscriptionJob[] = [
  {
    id: "job123",
    videoUrl: "https://www.youtube.com/watch?v=HKNOlSQz520",
    quality: "premium",
    status: "completed",
    transcriptionText: "This is a sample transcription text...", // Shortened for brevity
    createdAt: new Date(Date.now() - 3600000 * 24 * 2),
    updatedAt: new Date(Date.now() - 3600000 * 24 * 2 + 1800000),
  },
  {
    id: "job456",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    quality: "standard",
    status: "processing",
    createdAt: new Date(Date.now() - 3600000),
    updatedAt: new Date(Date.now() - 3600000),
  },
  {
    id: "job789",
    videoUrl: "https://www.youtube.com/watch?v=invalidurl",
    quality: "standard",
    status: "failed",
    createdAt: new Date(Date.now() - 3600000 * 12),
    updatedAt: new Date(Date.now() - 3600000 * 12 + 900000),
  }
]; 