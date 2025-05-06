'use client';

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import type { TranscriptionJob } from "@/lib/types";

interface JobDetailsClientInteractionsProps {
  job: TranscriptionJob;
}

export default function JobDetailsClientInteractions({ job }: JobDetailsClientInteractionsProps) {
  const [isClientForDownload, setIsClientForDownload] = useState(false);

  useEffect(() => {
    // Ensure this runs only on the client after hydration
    setIsClientForDownload(true);
  }, []);

  const handleDownload = () => {
    if (!job.transcriptionText || !isClientForDownload) return;

    const blob = new Blob([job.transcriptionText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `transcription-${job.id}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (job.status === "completed" && job.transcriptionText) {
    return (
      <Button onClick={handleDownload} disabled={!isClientForDownload}>
        <Download className="mr-2 h-4 w-4" />
        Download Transcription
      </Button>
    );
  }

  return null; // Don't render anything if not completed or no text
} 