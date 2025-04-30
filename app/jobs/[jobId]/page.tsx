"use client"; // Required for hooks, localStorage, document access

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Download, ExternalLink, Clock, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import type { TranscriptionJob } from "@/lib/types";
import { format } from "date-fns";

// Interface for page props including dynamic params
interface JobDetailPageProps {
  params: {
    jobId: string;
  };
}

// Function to fetch a specific job
const fetchJobDetail = async (jobId: string): Promise<TranscriptionJob | null> => {
  if (!jobId) return null;
  try {
    const { data } = await axios.get<TranscriptionJob>(`/api/jobs/${jobId}`);
    // Ensure dates are Date objects
    return { 
        ...data,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
    };
  } catch (error) {
    // Handle 404 specifically, otherwise log and return null
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      console.log(`Job ${jobId} not found.`);
    } else {
      console.error(`Failed to fetch job ${jobId}:`, error);
    }
    return null; // Return null if job not found or on error
  }
};

// Page component receiving params
export default function JobDetailPage({ params }: JobDetailPageProps) {
  const { jobId } = params;
  const router = useRouter();
  const [isClientForDownload, setIsClientForDownload] = useState(false);

  // Fetch job details using useQuery
  const { data: job, isLoading, error } = useQuery<TranscriptionJob | null, Error>({
    // Query key includes jobId to refetch when ID changes
    queryKey: ["transcriptionJobDetail", jobId], 
    queryFn: () => fetchJobDetail(jobId),
    // Optional: Add polling if status needs to update live on this page too
    // refetchInterval: 5000, 
    // TanStack Query handles client-side fetching
    enabled: !!jobId, // Only run query if jobId is available
  });

  // Effect to set client flag for download button (still needs document access)
  useEffect(() => {
    setIsClientForDownload(true);
  }, []);

  const handleDownload = () => {
    if (!job?.transcriptionText || !isClientForDownload) return; 

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

  const handleBackToDashboard = () => {
    router.push("/dashboard"); 
  };

  const getYoutubeVideoId = (url: string): string => {
    try {
      const params = new URL(url).searchParams;
      return params.get("v") || "";
    } catch {
      return "";
    }
  };

  // --- Loading State --- 
  if (isLoading) {
    return (
      <div className="container mx-auto py-8 px-4">
        {/* Simple centered spinner */}
        <div className="flex justify-center items-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
        {/* Optionally, add Skeleton placeholders for the cards */}
      </div>
    );
  }

  // --- Error State (from fetch) --- 
  if (error) {
    return (
       <div className="container mx-auto py-8 px-4">
        <Card className="mx-auto max-w-2xl">
          <CardHeader>
            <CardTitle>Error Loading Job</CardTitle>
            <CardDescription>
               Could not load job details: {error.message}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={handleBackToDashboard}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // --- Job Not Found State (fetched data is null) ---
  if (!job) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Card className="mx-auto max-w-2xl">
          <CardHeader>
            <CardTitle>Job Not Found</CardTitle>
            <CardDescription>
              The transcription job ID &apos;{jobId}&apos; does not exist or you do not have permission to view it.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={handleBackToDashboard}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // --- Render Job Details --- 
  const videoId = getYoutubeVideoId(job.videoUrl);
  // Reconstruct Date objects just in case they are strings after fetching
  const createdAtDate = typeof job.createdAt === 'string' ? new Date(job.createdAt) : job.createdAt;
  const updatedAtDate = typeof job.updatedAt === 'string' ? new Date(job.updatedAt) : job.updatedAt;
  
  return (
    <div className="container mx-auto py-8 px-4">
      {/* Back Button */} 
      <div className="mb-6">
        <Button variant="outline" onClick={handleBackToDashboard}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>
      </div>
      
      <div className="grid md:grid-cols-3 gap-6">
        {/* Transcription Details Card */}
        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle>Transcription Job: {job.id}</CardTitle>
                  <CardDescription className="mt-1 flex items-center gap-1 text-sm">
                    <Clock className="h-3 w-3" />
                     Submitted {format(createdAtDate, "PPpp")}
                  </CardDescription>
                </div>
                <Badge 
                  variant={job.status === "completed" ? "success" : job.status === "failed" ? "destructive" : "secondary"}
                  className="capitalize"
                >
                  {job.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Content based on job status */}
              {job.status === "completed" && job.transcriptionText ? (
                <>
                  <div>
                    <h3 className="text-sm font-medium mb-2">Transcription Preview:</h3>
                    <div className="bg-muted/50 dark:bg-muted/20 p-4 rounded-md h-64 overflow-y-auto whitespace-pre-wrap text-sm border">
                      {job.transcriptionText}
                    </div>
                  </div>
                  <div className="flex justify-end">
                     {/* Only enable download on client */}
                    <Button onClick={handleDownload} disabled={!isClientForDownload}> 
                      <Download className="mr-2 h-4 w-4" />
                      Download Transcription
                    </Button>
                  </div>
                </>
              ) : job.status === "processing" ? (
                 <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                  <p className="text-center">Your transcription is being processed...</p>
                </div>
              ) : (
                 <div className="flex flex-col items-center justify-center py-12 text-destructive">
                  <div className="rounded-full h-10 w-10 bg-destructive/10 flex items-center justify-center mb-4">
                    <span className="font-bold text-xl">!</span>
                  </div>
                  {/* Display status message if available */}
                  <p className="text-center">Transcription failed. {job.statusMessage ? `Reason: ${job.statusMessage}` : "Please try submitting again."}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        
        {/* Video Details Card */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Video Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {videoId && (
                <div className="aspect-video rounded-md overflow-hidden bg-muted/50 dark:bg-muted/20 border">
                  <img 
                    src={`https://img.youtube.com/vi/${videoId}/0.jpg`} 
                    alt="YouTube thumbnail" 
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              
              <div>
                <h3 className="text-sm font-medium mb-1">YouTube URL:</h3>
                <a 
                  href={job.videoUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline flex items-center gap-1 break-all"
                >
                  {job.videoUrl}
                  <ExternalLink className="h-3 w-3 flex-shrink-0 ml-1" />
                </a>
              </div>
              
              <div>
                <h3 className="text-sm font-medium mb-1">Quality:</h3>
                <p className="capitalize text-sm text-muted-foreground">{job.quality}</p>
              </div>
              
              <div>
                <h3 className="text-sm font-medium mb-1">Created:</h3>
                <p className="text-sm text-muted-foreground">{format(createdAtDate, "PPpp")}</p>
              </div>
              
              <div>
                <h3 className="text-sm font-medium mb-1">Last Updated:</h3>
                <p className="text-sm text-muted-foreground">{format(updatedAtDate, "PPpp")}</p>
              </div>
               <div>
                 <h3 className="text-sm font-medium mb-1">Origin:</h3>
                 <p className="capitalize text-sm text-muted-foreground">{job.origin?.toLowerCase() ?? 'Unknown'}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
} 