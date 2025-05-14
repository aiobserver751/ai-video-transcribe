'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation'; // For the back button
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Download, ExternalLink, Clock, Loader2, FileText } from "lucide-react";
import { format } from "date-fns";
import Image from 'next/image'; // Import next/image
// import Link from "next/link"; // Removed unused import
import axios from "axios";
import { logger } from "@/lib/logger";
import { useQuery } from "@tanstack/react-query"; 
import type { TranscriptionJob } from "@/lib/types"; // Using type import

interface JobDetailPageProps {
  params: {
    jobId: string;
  };
}

// Helper to get YouTube video ID
const getYoutubeVideoId = (url: string | undefined): string => {
  if (!url) return "";
  try {
    const params = new URL(url).searchParams;
    return params.get("v") || "";
  } catch {
    return "";
  }
};

// Helper function to extract subtitle format (SRT/VTT) from a URL
function getSubtitleFormatFromUrl(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null;
  try {
    // Attempt to parse as URL first (for S3 or other full URLs)
    const url = new URL(fileUrl);
    const pathname = url.pathname;
    const extension = pathname.split('.').pop()?.toLowerCase();
    if (extension === 'srt' || extension === 'vtt') {
      return extension.toUpperCase();
    }
  } catch {
    // If not a full URL, it might be a simple path or malformed. Try simple split.
    // This handles cases like local file paths in development that aren't full URLs.
    const parts = fileUrl.split('.');
    if (parts.length > 1) {
      const extension = parts.pop()?.toLowerCase();
      if (extension === 'srt' || extension === 'vtt') {
        return extension.toUpperCase();
      }
    }
  }
  return null;
}

// Type for the raw API response before date conversion
type RawApiJobResponse = Omit<TranscriptionJob, 'createdAt' | 'updatedAt' | 'srtFileText' | 'vttFileText'> & {
  createdAt: string;
  updatedAt: string;
  srt_file_text?: string | null;
  vtt_file_text?: string | null;
};

// Function to fetch a specific job
const fetchJobDetail = async (jobId: string): Promise<TranscriptionJob | null> => {
  if (!jobId) return null;
  logger.info(`[fetchJobDetail] Client-side fetching job: ${jobId}`);
  try {
    const { data: apiData } = await axios.get<RawApiJobResponse>(`/api/jobs/${jobId}`);

    if (!apiData || typeof apiData !== 'object' || !apiData.id) {
      logger.warn(`[fetchJobDetail] Invalid or incomplete data received for job ${jobId}:`, apiData);
      return null;
    }
    // Convert date strings to Date objects and ensure all fields align with TranscriptionJob
    return {
      ...apiData,
      createdAt: new Date(apiData.createdAt),
      updatedAt: new Date(apiData.updatedAt),
      statusMessage: apiData.statusMessage ?? null,
      transcriptionText: apiData.transcriptionText ?? null,
      srtFileText: apiData.srt_file_text ?? null,
      vttFileText: apiData.vtt_file_text ?? null,
      userId: apiData.userId ?? null,
      transcriptionFileUrl: apiData.transcriptionFileUrl ?? null,
      srtFileUrl: apiData.srtFileUrl ?? null,
      vttFileUrl: apiData.vttFileUrl ?? null,
      video_length_minutes_actual: apiData.video_length_minutes_actual ?? null,
      credits_charged: apiData.credits_charged ?? null,
    };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      logger.warn(`[fetchJobDetail] Job ${jobId} not found (404).`);
    } else if (axios.isAxiosError(error)) {
      logger.error(`[fetchJobDetail] Axios error fetching job ${jobId}: ${error.message}`, error.toJSON ? error.toJSON() : error);
    } else {
      logger.error(`[fetchJobDetail] Unknown error fetching job ${jobId}:`, error);
    }
    return null;
  }
};

export default function JobDetailPage({ params }: JobDetailPageProps) {
  const { jobId } = params;
  const router = useRouter();
  const [isClientForDownload, setIsClientForDownload] = useState(false);

  useEffect(() => {
    setIsClientForDownload(true);
  }, []);

  const { data: job, isLoading, error: queryError, refetch } = useQuery<
    TranscriptionJob | null, 
    Error,
    TranscriptionJob | null,
    ["transcriptionJobDetail", string] 
  >({
    queryKey: ["transcriptionJobDetail", jobId],
    queryFn: () => fetchJobDetail(jobId),
    enabled: !!jobId,
    refetchInterval: (data) => {
      // Stop polling if job is completed or failed
      if (data?.status === "completed" || data?.status === "failed") {
        return false;
      }
      return 5000; // Poll every 5 seconds otherwise
    },
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (job) {
      console.log("Job details:", job);
    }
  }, [job]);

  // Calculate subtitle format if applicable
  const subtitleFormat = job && job.quality === 'caption_first' 
    ? getSubtitleFormatFromUrl(job.transcriptionFileUrl) 
    : null;

  const handleDownloadTxt = () => {
    if (!job?.transcriptionText || !isClientForDownload) return;
    const blob = new Blob([job.transcriptionText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `transcription-${job.id}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFormatDownload = async (fileType: 'SRT' | 'VTT' | 'TXT') => {
    if (!isClientForDownload || !job) return;

    let contentToDownload: string | null = null;
    let defaultFilename = `transcription-${job.id}.${fileType.toLowerCase()}`;
    const mimeType = "text/plain;charset=utf-8"; // All are text-based

    if (fileType === 'TXT') {
      contentToDownload = job.transcriptionText || null;
      // Default filename is already good
    } else if (fileType === 'SRT') {
      contentToDownload = job.srtFileText || null;
      if (job.srtFileUrl) defaultFilename = job.srtFileUrl.split('/').pop() || defaultFilename;
      else if (job.id) defaultFilename = `transcription-${job.id}.srt`; // Fallback if URL is null
    } else if (fileType === 'VTT') {
      contentToDownload = job.vttFileText || null;
      if (job.vttFileUrl) defaultFilename = job.vttFileUrl.split('/').pop() || defaultFilename;
      else if (job.id) defaultFilename = `transcription-${job.id}.vtt`; // Fallback if URL is null
    }

    if (!contentToDownload) {
      logger.warn(`[handleFormatDownload] No content found to download for ${fileType} on job ${job.id}`);
      // Optionally, notify user that content is not available (e.g., toast)
      // Buttons should ideally be disabled if content is known to be unavailable.
      return;
    }

    const blob = new Blob([contentToDownload], { type: mimeType });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = defaultFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-8 px-4 flex justify-center items-center h-[calc(100vh-200px)]">
        <Loader2 className="h-16 w-16 animate-spin text-primary" />
      </div>
    );
  }

  if (queryError || !job) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Card className="mx-auto max-w-2xl">
          <CardHeader>
            <CardTitle>Job Not Found or Error</CardTitle>
            <CardDescription>
              The transcription job ID &apos;{jobId}&apos; does not exist, or there was an issue fetching its details.
              {queryError && <p className="text-destructive mt-2">Error: {queryError.message}</p>}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={() => router.push('/jobs')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Jobs List
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // --- Render Job Details ---
  const videoId = getYoutubeVideoId(job.videoUrl);
  const createdAtDate = job.createdAt;
  const updatedAtDate = job.updatedAt;

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-6">
        <Button variant="outline" onClick={() => router.push('/jobs')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Jobs List
        </Button>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
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
              {job.status === "completed" ? (
                <Tabs defaultValue="text" className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="text">Plain Text</TabsTrigger>
                    <TabsTrigger value="srt" disabled={!job.srtFileText && !job.srtFileUrl}>SRT</TabsTrigger>
                    <TabsTrigger value="vtt" disabled={!job.vttFileText && !job.vttFileUrl}>VTT</TabsTrigger>
                  </TabsList>
                  <TabsContent value="text">
                    {job.transcriptionText ? (
                      <div className="bg-muted/50 dark:bg-muted/20 p-4 rounded-md h-64 overflow-y-auto whitespace-pre-wrap text-sm border mt-2">
                        {job.transcriptionText}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground mt-2">Plain text not available.</p>
                    )}
                  </TabsContent>
                  <TabsContent value="srt">
                    {job.srtFileText ? (
                      <div className="bg-muted/50 dark:bg-muted/20 p-4 rounded-md h-64 overflow-y-auto whitespace-pre-wrap text-sm border mt-2">
                        {job.srtFileText}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground mt-2">SRT text content not available for preview. You can try downloading the file.</p>
                    )}
                  </TabsContent>
                  <TabsContent value="vtt">
                    {job.vttFileText ? (
                      <div className="bg-muted/50 dark:bg-muted/20 p-4 rounded-md h-64 overflow-y-auto whitespace-pre-wrap text-sm border mt-2">
                        {job.vttFileText}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground mt-2">VTT text content not available for preview. You can try downloading the file.</p>
                    )}
                  </TabsContent>
                </Tabs>
              ) : job.status === "processing" ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                  <p className="text-center">Your transcription is being processed...</p>
                  <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-4">Refresh Status</Button>
                </div>
              ) : job.status === "failed" ? (
                <div className="flex flex-col items-center justify-center py-12 text-destructive">
                  <div className="rounded-full h-10 w-10 bg-destructive/10 flex items-center justify-center mb-4">
                    <span className="font-bold text-xl">!</span>
                  </div>
                  <p className="text-center">
                    Transcription failed. {job.statusMessage ? `Reason: ${job.statusMessage}` : "Please try submitting again."}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <p className="text-center">Job status: {job.status}. No transcript available yet.</p>
                </div>
              )}
            </CardContent>
            {job.status === "completed" && (
              <CardFooter className="flex justify-end items-center mt-4 space-x-2 border-t pt-4">
                {job.vttFileUrl || job.vttFileText ? ( // Enable if URL or text exists
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleFormatDownload('VTT')}
                    disabled={!isClientForDownload || (!job.vttFileText && !job.vttFileUrl)} // More robust disable
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download VTT
                  </Button>
                ): null}
                {job.srtFileUrl || job.srtFileText ? ( // Enable if URL or text exists
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleFormatDownload('SRT')}
                    disabled={!isClientForDownload || (!job.srtFileText && !job.srtFileUrl)} // More robust disable
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download SRT
                  </Button>
                ): null}
                <Button 
                  onClick={() => handleFormatDownload('TXT')} 
                  disabled={!isClientForDownload || !job.transcriptionText}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download .txt
                </Button>
              </CardFooter>
            )}
          </Card>
        </div>

        <div className="md:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Video Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {videoId && (
                <div className="aspect-video rounded-md overflow-hidden bg-muted/50 dark:bg-muted/20 border relative mb-2">
                  <Image 
                    src={`https://img.youtube.com/vi/${videoId}/0.jpg`} 
                    alt="YouTube thumbnail" 
                    fill
                    style={{ objectFit: 'cover' }}
                    priority
                    onError={(e) => {
                      // Attempt to load hqdefault if 0.jpg fails or hide if that also fails
                      const target = e.currentTarget as HTMLImageElement;
                      if (!target.src.includes('hqdefault.jpg')) { // Avoid loop if hqdefault also fails
                        target.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
                      } else {
                        target.style.display = 'none';
                      }
                    }}
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
                <p className="capitalize text-sm text-muted-foreground">{job.quality === 'caption_first' ? 'Caption First' : job.quality}</p>
              </div>
              {subtitleFormat && job.quality === 'caption_first' && (
                <div>
                  <h3 className="text-sm font-medium mb-1">Subtitle Format:</h3>
                  <p className="text-sm text-muted-foreground">{subtitleFormat}</p>
                </div>
              )}
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
              {job.video_length_minutes_actual !== null && (
                  <div>
                      <h3 className="text-sm font-medium mb-1">Video Length (minutes):</h3>
                      <p className="text-sm text-muted-foreground">{job.video_length_minutes_actual}</p>
                  </div>
              )}
              {job.credits_charged !== null && (
                  <div>
                      <h3 className="text-sm font-medium mb-1">Credits Charged:</h3>
                      <p className="text-sm text-muted-foreground">{job.credits_charged}</p>
                  </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
} 