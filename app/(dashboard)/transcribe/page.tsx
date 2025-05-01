'use client';

import SubmitJobForm from "@/components/dashboard/SubmitJobForm";

export default function TranscribePage() {
  return (
    <div className="space-y-6 p-4 md:p-8">
      <h1 className="text-2xl font-bold">New Transcription</h1>
      <SubmitJobForm />
    </div>
  );
} 