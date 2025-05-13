"use client";

import { useState, useTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { AlertCircle, Loader2 } from "lucide-react";
import { submitJobAction } from "@/lib/actions/jobActions";
import { checkYouTubeCaptionAvailability } from "@/lib/actions/uiActions";
import { useUserProfile } from "@/context/UserProfileContext";
import {
  Alert, AlertDescription, AlertTitle
} from "@/components/ui/alert";

// Helper to check for YouTube URL (can be moved to a utils file if used elsewhere)
const isActuallyYouTubeUrl = (url: string): boolean => {
  if (!url) return false;
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    return (
      (hostname === "youtube.com" || hostname === "www.youtube.com") &&
      parsedUrl.searchParams.has("v")
    ) || (hostname === "youtu.be" && parsedUrl.pathname.length > 1);
  } catch {
    return false;
  }
};

const SubmitJobForm = () => {
  const { profile, isLoading: isLoadingProfile } = useUserProfile();
  const [videoUrl, setVideoUrl] = useState("");
  const [quality, setQuality] = useState<"caption_first" | "standard" | "premium">("standard");
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<{ videoUrl?: string[]; quality?: string[] }>({});

  // State for caption check
  const [isCheckingCaptions, setIsCheckingCaptions] = useState(false);
  const [captionCheckError, setCaptionCheckError] = useState<string | null>(null);
  const [captionsAvailable, setCaptionsAvailable] = useState<boolean | null>(null);
  const [estimatedDuration, setEstimatedDuration] = useState<number | null>(null);

  const isPaidUser = profile?.subscriptionTier === 'starter' || profile?.subscriptionTier === 'pro';

  // Effect to check for captions when URL or quality changes
  useEffect(() => {
    // Reset caption check state whenever URL or quality changes
    setCaptionCheckError(null);
    setCaptionsAvailable(null);
    setEstimatedDuration(null);
    // Don't clear fieldErrors.videoUrl here as it might come from the main submission attempt

    if (quality === "caption_first" && isActuallyYouTubeUrl(videoUrl)) {
      setIsCheckingCaptions(true);
      checkYouTubeCaptionAvailability(videoUrl)
        .then((result) => {
          // If an error string is present in the result, the check itself had an issue or yt-dlp failed.
          if (result.error) {
            setCaptionCheckError(result.error);
            setCaptionsAvailable(false); // Can't know if an error occurred during the check
            setEstimatedDuration(null); // Duration might be null if error happened early
          } else {
            // No error from the check function, means yt-dlp call was successful and JSON was parsed.
            // Now check the actual availability.
            setCaptionsAvailable(result.captionsAvailable);
            setEstimatedDuration(result.durationInMinutes ?? null);
            if (!result.captionsAvailable) {
              // If the command ran fine but no captions were found, set a specific message.
              setCaptionCheckError("No English captions (standard or auto) seem to be available for this video.");
            } else {
              setCaptionCheckError(null); // Clear any previous error if captions are now found
            }
          }
        })
        .catch((e: unknown) => {
          const errorMsg = e instanceof Error ? e.message : String(e);
          setCaptionCheckError(`An unexpected client-side error occurred: ${errorMsg.substring(0,100)}`);
          setCaptionsAvailable(false);
          setEstimatedDuration(null);
        })
        .finally(() => {
          setIsCheckingCaptions(false);
        });
    } else {
      // If not caption_first or not a YouTube URL, ensure checking is false
      setIsCheckingCaptions(false);
    }
  }, [videoUrl, quality]);

  // Form submission handler
  const handleSubmit = async (formData: FormData) => {
    setFieldErrors({}); // Clear previous field errors
    // We keep captionCheckError visible if it was set, as it's relevant context

    const currentVideoUrl = formData.get("videoUrl") as string;
    const currentQuality = formData.get("quality") as typeof quality;

    // Specific check for caption_first before submitting
    if (currentQuality === "caption_first") {
      if (!isActuallyYouTubeUrl(currentVideoUrl)) {
        toast.error("For 'Caption First' quality, a valid YouTube URL is required.");
        setFieldErrors({ videoUrl: ["A YouTube URL is required for Caption First quality."] });
        return;
      }
      if (captionsAvailable === false && !isCheckingCaptions) { // Check if captions are known to be unavailable
        toast.error("Cannot submit: Captions are not available for this video for 'Caption First' quality.");
        // fieldErrors for videoUrl might be set by captionCheckError already if it was a yt-dlp issue
        // If captionCheckError is already set, don't overwrite it with a generic one.
        if (!captionCheckError) {
             setCaptionCheckError("Captions are not available for this video. Please choose another video or quality.");
        }
        return;
      }
      if (isCheckingCaptions) {
        toast.info("Please wait, still checking for caption availability.");
        return;
      }
    }

    startTransition(async () => {
      const result = await submitJobAction(formData);

      if (result.success) {
        toast.success(`Job ${result.jobId} submitted successfully!`);
        setVideoUrl("");
        setQuality("standard");
        setFieldErrors({});
        setCaptionCheckError(null); // Clear caption check error on successful main submission
        setCaptionsAvailable(null);
        setEstimatedDuration(null);
      } else {
        toast.error(result.error || "Failed to submit job.");
        if (result.fieldErrors) {
          setFieldErrors(result.fieldErrors);
          // If the error is for videoUrl, and it's a caption_first YouTube error from the server,
          // it might be redundant with captionCheckError. Prioritize server error here.
          if (result.fieldErrors.videoUrl && quality === 'caption_first' && isActuallyYouTubeUrl(videoUrl)) {
            setCaptionCheckError(null); // Clear local caption check error if server gives a videoUrl error for this case
          }
        }
      }
    });
  };
  
  const canSubmit = 
    !isPending && 
    !isCheckingCaptions && 
    (quality !== "caption_first" || !isActuallyYouTubeUrl(videoUrl) || captionsAvailable === true);


  return (
    <>
      <Card>
        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(new FormData(e.currentTarget)); }}>
          <CardHeader>
            <CardTitle>Submit New Job</CardTitle>
            <CardDescription>
              Enter a video URL to create a new transcription job.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="videoUrl" className="text-sm font-medium">
                Video URL (YouTube, TikTok, Instagram, etc.)
              </label>
              <Input
                id="videoUrl"
                name="videoUrl"
                placeholder="https://www.youtube.com/watch?v=... or other video URL"
                value={videoUrl}
                onChange={(e) => { 
                  setVideoUrl(e.target.value); 
                  setFieldErrors(prev => ({ ...prev, videoUrl: undefined })); 
                }}
                required
                disabled={isPending || isCheckingCaptions}
              />
              {fieldErrors?.videoUrl && <p className="text-xs text-red-500 mt-1">{fieldErrors.videoUrl[0]}</p>}
            </div>
            <div className="space-y-2">
              <label htmlFor="quality" className="text-sm font-medium">
                Transcription Quality
              </label>
              <input type="hidden" name="quality" value={quality} />
              <Select
                value={quality}
                onValueChange={(value: string) => {
                  setQuality(value as "caption_first" | "standard" | "premium");
                  setFieldErrors(prev => ({ ...prev, quality: undefined })); 
                }}
                disabled={isPending || isLoadingProfile || isCheckingCaptions}
              >
                <SelectTrigger id="quality">
                  <SelectValue placeholder="Select quality" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="caption_first">Caption First (YouTube Only)</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  {isPaidUser && <SelectItem value="premium">Premium</SelectItem>}
                </SelectContent>
              </Select>
              {fieldErrors?.quality && <p className="text-xs text-red-500 mt-1">{fieldErrors.quality[0]}</p>}
              
              {/* Dynamic helper text and caption check UI */}
              <div className="mt-2 text-xs">
                {isCheckingCaptions && quality === "caption_first" && (
                  <div className="flex items-center text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Checking for available YouTube captions...
                  </div>
                )}
                {captionCheckError && quality === "caption_first" && isActuallyYouTubeUrl(videoUrl) && (
                   <Alert variant="destructive" className="mt-2">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Caption Issue</AlertTitle>
                    <AlertDescription>{captionCheckError}</AlertDescription>
                  </Alert>
                )}
                {captionsAvailable && quality === "caption_first" && isActuallyYouTubeUrl(videoUrl) && !captionCheckError && (
                  <div className="text-green-600">
                    YouTube captions detected. {estimatedDuration ? `Estimated video duration: ${estimatedDuration} min.` : ''}
                  </div>
                )}
                 <p className="text-gray-500 mt-1">
                  {quality === "caption_first"
                    ? "Fastest option for YouTube videos if captions are available. Uses existing YouTube captions (manual or auto-generated) and converts to text."
                    : quality === "standard"
                    ? "Good balance of accuracy and speed for various platforms (YouTube, TikTok, etc.)."
                    : "Highest accuracy, suitable for critical audio from various platforms."
                  }
                </p>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button type="button" variant="outline" onClick={() => { 
              setVideoUrl(""); 
              setQuality("standard"); 
              setFieldErrors({}); 
              setCaptionCheckError(null); 
              setCaptionsAvailable(null); 
              setEstimatedDuration(null);
              setIsCheckingCaptions(false);
            }} disabled={isPending || isCheckingCaptions}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || isPending || isCheckingCaptions }>
              {(isPending || isCheckingCaptions) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isPending ? "Submitting..." : isCheckingCaptions && quality === 'caption_first' ? "Checking..." : "Submit for Transcription"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* Help Section Card */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Transcription Options & Credits Guide</CardTitle>
          <CardDescription>
            Understand the different transcription methods, their processing times, quality, and credit costs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto border rounded-md">
            <table className="w-full caption-bottom text-sm">
              <thead className="[&_tr]:border-b">
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th scope="col" className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Method</th>
                  <th scope="col" className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Processing Time</th>
                  <th scope="col" className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Quality</th>
                  <th scope="col" className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Best For</th>
                  <th scope="col" className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Credits</th>
                  <th scope="col" className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Notes</th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                <tr className="border-b">
                  <td className="p-4 align-middle font-medium whitespace-nowrap">Caption First</td>
                  <td className="p-4 align-middle whitespace-nowrap">~5-15 sec (any length)</td>
                  <td className="p-4 align-middle">Varies by source</td>
                  <td className="p-4 align-middle">Quick reference, official content</td>
                  <td className="p-4 align-middle whitespace-nowrap">1 credit (fixed)</td>
                  <td className="p-4 align-middle">Only available on some YouTube videos</td>
                </tr>
                <tr className="border-b">
                  <td className="p-4 align-middle font-medium whitespace-nowrap">Standard Quality</td>
                  <td className="p-4 align-middle whitespace-nowrap">~3-5 min per 10 min of video</td>
                  <td className="p-4 align-middle">Good accuracy (~85-90%)</td>
                  <td className="p-4 align-middle">Clear speech, general content</td>
                  <td className="p-4 align-middle whitespace-nowrap">5 credits per 10 min</td>
                  <td className="p-4 align-middle">Uses open-source Whisper</td>
                </tr>
                <tr className="border-b">
                  <td className="p-4 align-middle font-medium whitespace-nowrap">Premium Quality</td>
                  <td className="p-4 align-middle whitespace-nowrap">~1-2 min per 10 min of video</td>
                  <td className="p-4 align-middle">High accuracy (~95%+)</td>
                  <td className="p-4 align-middle">Accents, technical content</td>
                  <td className="p-4 align-middle whitespace-nowrap">10 credits per 10 min</td>
                  <td className="p-4 align-middle">Uses Groq&apos;s Whisper Large-v3</td>
                </tr>
                <tr className="border-b">
                  <td className="p-4 align-middle font-medium whitespace-nowrap">Basic Summary</td>
                  <td className="p-4 align-middle whitespace-nowrap">~10-20 seconds</td>
                  <td className="p-4 align-middle">Key points only</td>
                  <td className="p-4 align-middle">Quick overview</td>
                  <td className="p-4 align-middle whitespace-nowrap">2 credits (fixed)</td>
                  <td className="p-4 align-middle">Available for Starter and Pro plans</td>
                </tr>
                <tr>
                  <td className="p-4 align-middle font-medium whitespace-nowrap">Extended Summary</td>
                  <td className="p-4 align-middle whitespace-nowrap">~20-30 seconds</td>
                  <td className="p-4 align-middle">Detailed insights</td>
                  <td className="p-4 align-middle">Content analysis</td>
                  <td className="p-4 align-middle whitespace-nowrap">5 credits (fixed)</td>
                  <td className="p-4 align-middle">Available for Starter and Pro plans</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Note: Video length is rounded to the nearest 10 minutes for credit calculation. For example, an 11-minute video would count as 10 minutes for credit purposes.
          </p>
        </CardContent>
      </Card>
    </>
  );
};

export default SubmitJobForm;
