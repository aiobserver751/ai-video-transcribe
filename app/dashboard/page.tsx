"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import JobsList from "@/components/dashboard/JobsList";
import SubmitJobForm from "@/components/dashboard/SubmitJobForm";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import type { TranscriptionJob } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";

// Function to fetch jobs from the backend API
const fetchJobs = async (): Promise<TranscriptionJob[]> => {
  // Assuming API returns the array directly now
  try {
    // Expect the API to return TranscriptionJob[] directly
    const { data } = await axios.get<TranscriptionJob[]>("/api/jobs");
    // Ensure dates are Date objects (APIs often return strings)
    // Use data directly since it's the array
    return (data || []).map((job) => ({ 
        ...job,
        createdAt: new Date(job.createdAt),
        updatedAt: new Date(job.updatedAt),
    }));
  } catch (error) {
      console.error("Failed to fetch jobs:", error);
      return []; // Return empty array on error
  }
};

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState("jobs");
  const router = useRouter();

  // Fetch jobs using useQuery, refetch every 5 seconds
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
      <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
        <DashboardSidebar activeTab={activeTab} setActiveTab={setActiveTab} />
        <div className="flex-1">
          <DashboardHeader />
          <main className="container mx-auto py-6 px-4">
            <h1 className="text-2xl font-bold mb-6">Transcription Jobs</h1>
            <div className="space-y-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          </main>
        </div>
      </div>
    );
  }
  
  // Error state
  if (fetchError) {
       return (
          <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900 items-center justify-center">
              <p className="text-red-500">Error loading jobs: {fetchError.message}</p>
          </div>
      )
  }

  // Main return
  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
      <DashboardSidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <div className="flex-1">
        <DashboardHeader />
        <main className="container mx-auto py-6 px-4">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6">
              <TabsTrigger value="jobs">My Jobs</TabsTrigger>
              <TabsTrigger value="new">New Transcription</TabsTrigger>
            </TabsList>
            <TabsContent value="jobs" className="space-y-6">
              <h1 className="text-2xl font-bold">Transcription Jobs</h1>
              {/* Pass jobs array, handle potential undefined */}
              <JobsList jobs={jobs || []} onViewDetails={handleViewJobDetails} />
            </TabsContent>
            <TabsContent value="new">
              <h1 className="text-2xl font-bold mb-6">Submit New Transcription</h1>
              {/* Render SubmitJobForm - it now handles its own submission state */}
              <SubmitJobForm />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
} 