'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { getContentIdeaJobDetailsAction, type ContentIdeaJobDetails } from '@/app/actions/contentIdeaActions';
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
import { ArrowLeft, Download, ExternalLink, Clock, Loader2, AlertCircle, Lightbulb, FileText } from "lucide-react";
import { format } from "date-fns";

interface ContentIdeaJobDetailPageProps {
  params: {
    contentIdeaJobId: string;
  };
}

// Helper function to get badge variant (can be shared or defined locally)
const getStatusBadgeVariant = (status: ContentIdeaJobDetails['status'] | undefined) => {
  if (!status) return 'outline';
  switch (status) {
    case 'completed': return 'success';
    case 'failed':
    case 'failed_insufficient_credits': 
      return 'destructive';
    case 'processing': return 'secondary';
    case 'pending':
    case 'pending_credit_deduction':
    default: return 'outline';
  }
};

export default function ContentIdeaDetailPage({ params }: ContentIdeaJobDetailPageProps) {
  const { contentIdeaJobId } = params;
  const router = useRouter();
  const [isClientForDownload, setIsClientForDownload] = useState(false);

  useEffect(() => {
    setIsClientForDownload(true);
  }, []);

  const {
    data: queryResult,
    isLoading,
    error: queryError,
    refetch,
  } = useQuery<
    { success: boolean; job?: ContentIdeaJobDetails; error?: string },
    Error,
    { success: boolean; job?: ContentIdeaJobDetails; error?: string },
    ["contentIdeaJobDetail", string] // Query key
  >({
    queryKey: ["contentIdeaJobDetail", contentIdeaJobId],
    queryFn: () => getContentIdeaJobDetailsAction(contentIdeaJobId),
    enabled: !!contentIdeaJobId,
    refetchInterval: (query) => {
      const jobData = query.state.data?.job;
      if (jobData?.status === "completed" || jobData?.status === "failed" || jobData?.status === "failed_insufficient_credits") {
        return false; // Stop polling if job is in a terminal state
      }
      return 5000; // Poll every 5 seconds otherwise
    },
  });

  const job = queryResult?.job;

  const handleDownloadTextResult = () => {
    if (!job || !job.resultTxt || !isClientForDownload) return;
    const blob = new Blob([job.resultTxt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `content_ideas_${job.id}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-8 px-4 flex justify-center items-center h-[calc(100vh-200px)]">
        <Loader2 className="h-16 w-16 animate-spin text-primary" />
      </div>
    );
  }

  if (queryError || !job || !queryResult?.success) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Button variant="outline" onClick={() => router.push('/content-ideas')} className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Content Ideas List
        </Button>
        <Card className="mx-auto max-w-2xl">
          <CardHeader>
            <CardTitle>Job Not Found or Error</CardTitle>
            <CardDescription>
              The content idea job ID &apos;{contentIdeaJobId}&apos; does not exist, or there was an issue fetching its details.
              {queryError && <p className="text-destructive mt-2">Error: {queryError.message}</p>}
              {queryResult?.error && <p className="text-destructive mt-2">Server Error: {queryResult.error}</p>}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-6">
        <Button variant="outline" onClick={() => router.push('/content-ideas')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Content Ideas List
        </Button>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Main Content Area */} 
        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="flex items-center">
                    <Lightbulb className="mr-2 h-6 w-6" /> Content Idea Job: {job.id}
                  </CardTitle>
                  <CardDescription className="mt-1 flex items-center gap-1 text-sm">
                    <Clock className="h-3 w-3" />
                    Submitted {format(new Date(job.createdAt), "PPpp")}
                  </CardDescription>
                </div>
                <Badge variant={getStatusBadgeVariant(job.status)} className="capitalize">
                  {job.status.replace('_',' ')}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {job.status === 'processing' && (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                  <p className="text-center">Your content ideas are being generated...</p>
                  <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-4">Refresh Status</Button>
                </div>
              )}
              {job.status === 'failed' && (
                <div className="text-center py-10 text-destructive">
                  <AlertCircle className="mx-auto h-10 w-10 mb-2" />
                  <p className="font-semibold">Generation Failed</p>
                  {job.statusMessage && <p className="text-sm">Reason: {job.statusMessage}</p>}
                </div>
              )}
              {job.status === 'completed' && job.resultTxt && (
                <div>
                  <h3 className="text-lg font-semibold mb-2">Generated Ideas (Text Output)</h3>
                  <div className="bg-muted/50 dark:bg-muted/20 p-4 rounded-md h-auto max-h-[500px] overflow-y-auto whitespace-pre-wrap text-sm border">
                    {job.resultTxt}
                  </div>
                </div>
              )}
              {job.status === 'completed' && !job.resultTxt && (
                 <p className="text-sm text-muted-foreground">Text result not available for this job.</p>
              )}
            </CardContent>
            {job.status === 'completed' && job.resultTxt && (
              <CardFooter className="flex justify-end border-t pt-4 mt-4">
                <Button onClick={handleDownloadTextResult} disabled={!isClientForDownload}>
                  <Download className="mr-2 h-4 w-4" />
                  Download .txt Result
                </Button>
              </CardFooter>
            )}
          </Card>
        </div>

        {/* Sidebar for Details */} 
        <div className="md:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Job Properties</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <h4 className="font-medium mb-0.5">Job Type:</h4>
                <p className="capitalize text-muted-foreground">{job.jobType.replace('_', ' ')}</p>
              </div>
              {job.parentVideoUrl && (
                <div>
                  <h4 className="font-medium mb-0.5">Original Video:</h4>
                  <a
                    href={job.parentVideoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1 break-all"
                  >
                    {job.parentVideoUrl}
                    <ExternalLink className="h-3 w-3 flex-shrink-0 ml-1" />
                  </a>
                </div>
              )}
              <div>
                <h4 className="font-medium mb-0.5">Parent Transcription ID:</h4>
                <Link href={`/jobs/${job.parentTranscriptionId}`} className="text-primary hover:underline flex items-center gap-1 break-all">
                  {job.parentTranscriptionId}
                  <FileText className="h-3 w-3 flex-shrink-0 ml-1" />
                </Link>
              </div>
              {job.completedAt && (
                 <div>
                  <h4 className="font-medium mb-0.5">Completed:</h4>
                  <p className="text-muted-foreground">{format(new Date(job.completedAt), "PPpp")}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
} 