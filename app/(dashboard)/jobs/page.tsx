'use client';

// import { useState } from "react"; // Remove unused import
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import type { TranscriptionJob } from "@/lib/types";
import JobsList from "@/components/dashboard/JobsList";
import { Skeleton } from "@/components/ui/skeleton";

// Function to fetch jobs - moved here
const fetchJobs = async (): Promise<TranscriptionJob[]> => {
  try {
    const { data } = await axios.get<TranscriptionJob[]>("/api/jobs");
    return (data || []).map((job) => ({ 
        ...job,
        createdAt: new Date(job.createdAt),
        updatedAt: new Date(job.updatedAt),
    }));
  } catch (error) {
      console.error("Failed to fetch jobs:", error);
      return []; 
  }
};

export default function JobsPage() {
  const router = useRouter();

  // Fetch jobs using useQuery - moved here
  const { data: jobs, isLoading: isLoadingJobs, error: fetchError } = useQuery<TranscriptionJob[], Error>({
    queryKey: ["transcriptionJobs"],
    queryFn: fetchJobs,
    refetchInterval: 5000, 
  });

  const handleViewJobDetails = (jobId: string) => {
    router.push(`/jobs/${jobId}`);
  };

  // Loading state
   if (isLoadingJobs) {
    return (
        <div className="space-y-4 p-6">
            <h1 className="text-2xl font-bold mb-6">My Jobs</h1>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
        </div>
    );
  }
  
  // Error state
  if (fetchError) {
       return (
           <div className="p-6">
               <h1 className="text-2xl font-bold mb-6 text-red-600">Error Loading Jobs</h1>
               <p className="text-red-500">Could not load transcription jobs: {fetchError.message}</p>
           </div>
       )
  }

  // Display Jobs List
  return (
    <div className="space-y-6 p-4 md:p-8">
      <h1 className="text-2xl font-bold">My Jobs</h1>
      <JobsList jobs={jobs || []} onViewDetails={handleViewJobDetails} />
    </div>
  );
} 