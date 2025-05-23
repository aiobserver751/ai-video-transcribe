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
import { ArrowLeft, Download, ExternalLink, Clock, Loader2, Lightbulb } from "lucide-react";
import { format } from "date-fns";
import Image from 'next/image'; // Import next/image
import axios from "axios";
import { logger } from "@/lib/logger";
import { useQuery } from "@tanstack/react-query"; 
import type { TranscriptionJob as GlobalTranscriptionJobType } from "@/lib/types"; // Using type import
import { createContentIdeaJobAction, type CreateContentIdeaJobResult } from "@/app/actions/contentIdeaActions"; // Import the server action and its result type
import Link from 'next/link'; // For linking to the new content idea job
import { contentIdeaJobTypeEnum } from '@/server/db/schema'; // NEW IMPORT
import { getVideoPlatform } from '@/lib/utils/urlUtils'; // NEW IMPORT

// Extend the global type or define a local one that includes summaries
interface TranscriptionJob extends GlobalTranscriptionJobType {
  basicSummary?: string | null;
  extendedSummary?: string | null;
  youtubeCommentCount?: number | null;
}

// NEW: State for content idea generation process
interface ContentIdeaGenerationState {
  isLoading: boolean;
  error: string | null;
  successMessage: string | null;
  newJobId: string | null; 
}

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
// Ensure this matches the fields actually returned by your /api/jobs/[jobId] endpoint
type RawApiJobResponse = Omit<TranscriptionJob, 'createdAt' | 'updatedAt' | 'srtFileText' | 'vttFileText' | 'youtubeCommentCount'> & {
  createdAt: string;
  updatedAt: string;
  srt_file_text?: string | null; // Assuming API might still send these as snake_case
  vtt_file_text?: string | null; // Assuming API might still send these as snake_case
  // EXPECTING CAMEL CASE FROM API FOR SUMMARIES as Drizzle returns this by default
  // and the /api/jobs/[jobId] route currently passes it through directly.
  basicSummary?: string | null; 
  extendedSummary?: string | null;
  youtubeCommentCount?: number | null;
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
      srtFileText: apiData.srt_file_text ?? null, // Keep mapping if these are indeed snake_case
      vttFileText: apiData.vtt_file_text ?? null, // Keep mapping if these are indeed snake_case
      // USE CAMEL CASE DIRECTLY as per RawApiJobResponse expectation
      basicSummary: apiData.basicSummary ?? null,
      extendedSummary: apiData.extendedSummary ?? null,
      youtubeCommentCount: apiData.youtubeCommentCount ?? null,
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
  const [contentIdeaStates, setContentIdeaStates] = useState<{
    normal: ContentIdeaGenerationState;
    comments: ContentIdeaGenerationState;
  }>({
    normal: { isLoading: false, error: null, successMessage: null, newJobId: null },
    comments: { isLoading: false, error: null, successMessage: null, newJobId: null },
  });

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
    refetchInterval: (query) => {
      const jobData = query.state.data;
      if (jobData?.status === "completed" || jobData?.status === "failed" || jobData?.status === "failed_insufficient_credits") { // Also stop polling on credit failure
        return false;
      }
      return 5000;
    },
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

  // NEW: Handler for downloading summaries
  const handleDownloadSummary = (summaryType: 'basic' | 'extended') => {
    if (!job || !isClientForDownload) return;
    const summaryText = summaryType === 'basic' ? job.basicSummary : job.extendedSummary;
    if (!summaryText) return;

    const blob = new Blob([summaryText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${summaryType}_summary-${job.id}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // UPDATED: Handler for initiating content idea generation
  const handleGenerateContentIdeas = async (jobType: typeof contentIdeaJobTypeEnum.enumValues[number]) => {
    if (!job || job.status !== 'completed') {
      const errorMsg = "Content ideas can only be generated for completed transcription jobs.";
      // Determine which state to update based on jobType
      const stateKeyToUpdateOnError = jobType === contentIdeaJobTypeEnum.enumValues[0] ? 'normal' : 'comments';
      setContentIdeaStates(prev => ({ 
        ...prev, 
        [stateKeyToUpdateOnError]: { 
          isLoading: false, 
          error: errorMsg, 
          successMessage: null, // Clear success message on new error
          newJobId: null  // Clear newJobId on new error for this type
        } 
      }));
      return;
    }

    const stateKey = jobType === contentIdeaJobTypeEnum.enumValues[0] ? 'normal' : 'comments';

    setContentIdeaStates(prev => ({
      ...prev,
      [stateKey]: { isLoading: true, error: null, successMessage: null, newJobId: null }, // Reset state for this type on new generation attempt
    }));

    try {
      const result: CreateContentIdeaJobResult = await createContentIdeaJobAction({
        transcriptionId: job.id,
        jobType: jobType,
      });

      if (result.success && result.jobId) {
        setContentIdeaStates(prev => ({
          ...prev,
          [stateKey]: {
            isLoading: false,
            error: null,
            successMessage: `Content idea job (${jobType}) successfully started! (ID: ${result.jobId})`,
            newJobId: result.jobId,
          },
        }));
      } else {
        setContentIdeaStates(prev => ({
          ...prev,
          [stateKey]: {
            isLoading: false,
            error: result.errorMessage || result.error || "Failed to start content idea job.",
            successMessage: null,
            newJobId: null,
          },
        }));
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      logger.error('[JobDetailPage] Error calling createContentIdeaJobAction:', err);
      setContentIdeaStates(prev => ({
        ...prev,
        [stateKey]: {
          isLoading: false,
          error: errorMessage,
          successMessage: null,
          newJobId: null,
        },
      }));
    }
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
  const isYouTubeVideo = getVideoPlatform(job.videoUrl) === 'youtube'; // NEW: Check if YouTube video

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
              {isYouTubeVideo && job.youtubeCommentCount !== null && typeof job.youtubeCommentCount === 'number' && (
                <div>
                  <h3 className="text-sm font-medium mb-1">YouTube Comment Count:</h3>
                  <p className="text-sm text-muted-foreground">{job.youtubeCommentCount.toLocaleString()}</p>
                </div>
              )}
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

      {/* Summary Display Card - NOW USING PRE-WRAP FOR RAW DISPLAY */}
      {job.status === "completed" && (job.basicSummary || job.extendedSummary) && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>
              {job.basicSummary ? "Basic Summary" : "Extended Summary"}
            </CardTitle>
            <CardDescription>
              AI-generated summary of the transcription.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Apply styling from the experimental raw text container */}
            <div className="bg-muted/50 dark:bg-muted/20 p-4 rounded-md h-auto max-h-96 overflow-y-auto whitespace-pre-wrap text-sm border mt-2">
              {job.basicSummary || job.extendedSummary || "Summary not available."}
            </div>
          </CardContent>
          <CardFooter className="flex justify-end">
            <Button 
              onClick={() => handleDownloadSummary(job.basicSummary ? 'basic' : 'extended')} 
              disabled={!isClientForDownload}
            >
              <Download className="mr-2 h-4 w-4" />
              Download Summary
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* === NEW CONTENT INSIGHTS SECTION === */}
      {job.status === "completed" && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Lightbulb className="mr-2 h-5 w-5 text-primary" /> Generate Content Insights
            </CardTitle>
            <CardDescription>
              Explore different ways to generate new content ideas based on this transcription.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isYouTubeVideo ? (
              // Two-column layout for YouTube videos
              <div className="grid md:grid-cols-2 gap-6">
                {/* --- Normal Analysis Card (YouTube Left Column) --- */}
                <Card className="flex flex-col">
                  <CardHeader>
                    <CardTitle>Transcript Analysis</CardTitle>
                    <CardDescription>Get content ideas based on the full transcript text.</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-grow space-y-3">
                    <p className="text-sm text-muted-foreground">
                      This analysis delves into the core themes, keywords, and narratives present in the video&apos;s transcription. 
                      Ideal for brainstorming blog posts, new video topics, or social media updates derived directly from the original content.
                    </p>
                  </CardContent>
                  <CardFooter className="mt-auto">
                    {contentIdeaStates.normal.newJobId ? (
                      <Button asChild className="w-full">
                        <Link href={`/content-ideas/${contentIdeaStates.normal.newJobId}`}>
                          View Transcript Analysis Job <ExternalLink className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                    ) : (
                      <Button 
                        onClick={() => handleGenerateContentIdeas(contentIdeaJobTypeEnum.enumValues[0])}
                        disabled={contentIdeaStates.normal.isLoading || contentIdeaStates.comments.isLoading}
                        className="w-full"
                      >
                        {contentIdeaStates.normal.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} 
                        Generate from Transcript
                      </Button>
                    )}
                  </CardFooter>
                  {/* Display errors or success messages for normal analysis */} 
                  {(contentIdeaStates.normal.error || contentIdeaStates.normal.successMessage) && (
                    <div className="p-4 text-sm">
                      {contentIdeaStates.normal.error && <p className="text-destructive">Error: {contentIdeaStates.normal.error}</p>}
                      {contentIdeaStates.normal.successMessage && !contentIdeaStates.normal.newJobId && <p className="text-green-600">{contentIdeaStates.normal.successMessage}</p>}
                    </div>
                  )}
                </Card>

                {/* --- Comment Analysis Card (YouTube Right Column) --- */}
                <Card className="flex flex-col">
                  <CardHeader>
                    <CardTitle>YouTube Comment Analysis</CardTitle>
                    <CardDescription>Uncover insights from audience engagement.</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-grow space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Analyze the YouTube comments to understand audience sentiment, frequently asked questions, and suggestions. 
                      This can spark ideas for follow-up content that directly addresses your viewers&apos; interests.
                    </p>
                    {job.youtubeCommentCount !== null && typeof job.youtubeCommentCount === 'number' ? (
                      <p className="text-sm font-medium">Estimated comments to analyze: <Badge variant="secondary">{job.youtubeCommentCount.toLocaleString()}</Badge></p>
                    ) : (
                      <p className="text-sm text-muted-foreground">Comment count not yet available for estimation.</p>
                    )}
                    {/* Placeholder for credit table/tiers */}
                    <div className="text-xs text-muted-foreground p-2 border rounded-md">
                      <p className="font-semibold mb-1">Credit Tiers for Comment Analysis (Example):</p>
                      <ul className="list-disc list-inside space-y-0.5">
                        <li>0 - 100 comments: 5 credits</li>
                        <li>101 - 500 comments: 15 credits</li>
                        <li>501 - 2000 comments: 40 credits</li>
                        <li>2000+ comments: Contact us</li>
                      </ul>
                      <p className="mt-1">Actual cost calculated when job is submitted.</p>
                    </div>
                  </CardContent>
                  <CardFooter className="mt-auto">
                    {contentIdeaStates.comments.newJobId ? (
                      <Button asChild className="w-full">
                        <Link href={`/content-ideas/${contentIdeaStates.comments.newJobId}`}>
                          View Comment Analysis Job <ExternalLink className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                    ) : (
                      <Button 
                        onClick={() => handleGenerateContentIdeas(contentIdeaJobTypeEnum.enumValues[1])}
                        disabled={contentIdeaStates.normal.isLoading || contentIdeaStates.comments.isLoading || job.youtubeCommentCount === null} // Also disable if no comment count
                        className="w-full"
                      >
                        {contentIdeaStates.comments.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} 
                        Analyze YouTube Comments
                      </Button>
                    )}
                  </CardFooter>
                   {/* Display errors or success messages for comment analysis */} 
                  {(contentIdeaStates.comments.error || contentIdeaStates.comments.successMessage) && (
                    <div className="p-4 text-sm">
                      {contentIdeaStates.comments.error && <p className="text-destructive">Error: {contentIdeaStates.comments.error}</p>}
                      {contentIdeaStates.comments.successMessage && !contentIdeaStates.comments.newJobId && <p className="text-green-600">{contentIdeaStates.comments.successMessage}</p>}
                    </div>
                  )}
                </Card>
              </div>
            ) : (
              // Single card layout for non-YouTube videos
              <Card className="flex flex-col max-w-lg mx-auto"> {/* Centered and max-width for single card */}
                <CardHeader>
                  <CardTitle>Transcript Analysis</CardTitle>
                  <CardDescription>Get content ideas based on the full transcript text.</CardDescription>
                </CardHeader>
                <CardContent className="flex-grow space-y-3">
                  <p className="text-sm text-muted-foreground">
                    This analysis delves into the core themes, keywords, and narratives present in the video&apos;s transcription. 
                    Ideal for brainstorming blog posts, new video topics, or social media updates derived directly from the original content.
                  </p>
                </CardContent>
                <CardFooter className="mt-auto">
                  {contentIdeaStates.normal.newJobId ? (
                    <Button asChild className="w-full">
                      <Link href={`/content-ideas/${contentIdeaStates.normal.newJobId}`}>
                        View Transcript Analysis Job <ExternalLink className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  ) : (
                    <Button 
                      onClick={() => handleGenerateContentIdeas(contentIdeaJobTypeEnum.enumValues[0])}
                      disabled={contentIdeaStates.normal.isLoading}
                      className="w-full"
                    >
                      {contentIdeaStates.normal.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} 
                      Generate Ideas from Transcript
                    </Button>
                  )}
                </CardFooter>
                {/* Display errors or success messages for normal analysis (non-YouTube) */} 
                {(contentIdeaStates.normal.error || contentIdeaStates.normal.successMessage) && (
                  <div className="p-4 text-sm">
                    {contentIdeaStates.normal.error && <p className="text-destructive">Error: {contentIdeaStates.normal.error}</p>}
                    {contentIdeaStates.normal.successMessage && !contentIdeaStates.normal.newJobId && <p className="text-green-600">{contentIdeaStates.normal.successMessage}</p>}
                  </div>
                )}
              </Card>
            )}
          </CardContent>
        </Card>
      )}

    </div>
  );
} 