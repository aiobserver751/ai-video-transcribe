import { getJobDetails } from "@/app/actions/jobActions";
// import type { TranscriptionJob } from "@/lib/types"; // Type inferred from server action
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
import { ArrowLeft, ExternalLink, Clock, Loader2 } from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";
import JobDetailsClientInteractions from "./JobDetailsClientInteractions"; // We will create this next

interface JobDetailPageProps {
  params: {
    jobId: string;
  };
}

const getYoutubeVideoId = (url: string | undefined): string => {
  if (!url) return "";
  try {
    const params = new URL(url).searchParams;
    return params.get("v") || "";
  } catch {
    return "";
  }
};

export default async function JobDetailPage({ params }: JobDetailPageProps) {
  const { jobId } = params;
  const job = await getJobDetails(jobId);

  // --- Job Not Found State (or error fetching) ---
  if (!job) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Card className="mx-auto max-w-2xl">
          <CardHeader>
            <CardTitle>Job Not Found or Error</CardTitle>
            <CardDescription>
              The transcription job ID &apos;{jobId}&apos; does not exist, or there was an issue fetching its details.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild>
              <Link href="/jobs">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Jobs List
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // --- Render Job Details --- 
  const videoId = getYoutubeVideoId(job.videoUrl);
  // Ensure dates are Date objects (Server Action should already handle this)
  const createdAtDate = job.createdAt; // Already a Date object from server action
  const updatedAtDate = job.updatedAt; // Already a Date object from server action
  
  return (
    <div className="container mx-auto py-8 px-4">
      {/* Back Button - moved to client component or use Link for simple back */}
      <div className="mb-6">
        <Button variant="outline" asChild>
            <Link href="/jobs"> 
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Jobs List
            </Link>
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
              {job.status === "completed" && job.transcriptionText ? (
                <>
                  <div>
                    <h3 className="text-sm font-medium mb-2">Transcription Preview:</h3>
                    <div className="bg-muted/50 dark:bg-muted/20 p-4 rounded-md h-64 overflow-y-auto whitespace-pre-wrap text-sm border">
                      {job.transcriptionText}
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <JobDetailsClientInteractions job={job} />
                  </div>
                </>
              ) : job.status === "processing" ? (
                 <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                  <p className="text-center">Your transcription is being processed...</p>
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