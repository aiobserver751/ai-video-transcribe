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
import { AlertCircle, Loader2, CheckCircle } from "lucide-react";
import { submitJobAction } from "@/lib/actions/jobActions";
import { checkYouTubeCaptionAvailability } from "@/lib/actions/uiActions";
import { useUserProfile } from "@/context/UserProfileContext";
import {
  Alert, AlertDescription, AlertTitle
} from "@/components/ui/alert";
import { displayToast } from "@/lib/toastUtils";
import { getVideoPlatform, isYouTubeUrl } from "@/lib/utils/urlUtils";

// Helper to check for YouTube URL (can be moved to a utils file if used elsewhere)
// const isActuallyYouTubeUrl = (url: string): boolean => { // Removed local helper
//   if (!url) return false;
//   try {
//     const parsedUrl = new URL(url);
//     const hostname = parsedUrl.hostname.toLowerCase();
//     return (
//       (hostname === "youtube.com" || hostname === "www.youtube.com") &&
//       parsedUrl.searchParams.has("v")
//     ) || (hostname === "youtu.be" && parsedUrl.pathname.length > 1);
//   } catch {
//     return false;
//   }
// };

const SubmitJobForm = () => {
  const { profile, isLoading: isLoadingProfile } = useUserProfile();
  const [videoUrl, setVideoUrl] = useState("");
  const [quality, setQuality] = useState<"caption_first" | "standard" | "premium">("standard");
  const [summaryType, setSummaryType] = useState<"none" | "basic" | "extended">("none");
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<{ videoUrl?: string[]; quality?: string[]; summary_type?: string[] }>({});

  // State for caption check
  const [isCheckingCaptions, setIsCheckingCaptions] = useState(false);
  const [captionCheckError, setCaptionCheckError] = useState<string | null>(null);
  const [captionsAvailable, setCaptionsAvailable] = useState<boolean | null>(null);
  const [estimatedDuration, setEstimatedDuration] = useState<number | null>(null);
  const [platformSpecificMessage, setPlatformSpecificMessage] = useState<string | null>(null);

  const isPaidUser = profile?.subscriptionTier === 'starter' || profile?.subscriptionTier === 'pro';

  // Effect to check for captions when URL or quality changes
  useEffect(() => {
    setCaptionCheckError(null);
    setCaptionsAvailable(null);
    setEstimatedDuration(null);
    setPlatformSpecificMessage(null); // Reset platform message

    const platform = getVideoPlatform(videoUrl);

    if (quality === "caption_first") {
      if (platform === "youtube") {
        setIsCheckingCaptions(true);
        checkYouTubeCaptionAvailability(videoUrl)
          .then((result) => {
            if (result.error) {
              setCaptionCheckError(result.error);
              setCaptionsAvailable(false);
              setEstimatedDuration(null);
            } else {
              setCaptionsAvailable(result.captionsAvailable);
              setEstimatedDuration(result.durationInMinutes ?? null);
              if (!result.captionsAvailable) {
                setCaptionCheckError("No English captions (standard or auto) seem to be available for this video.");
              } else {
                setCaptionCheckError(null);
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
      } else if (platform === "tiktok" || platform === "instagram") {
        setPlatformSpecificMessage("Caption First quality is only available for YouTube videos. Please select Standard or Premium.");
        setIsCheckingCaptions(false);
      } else {
        // Not a known platform or empty URL, but quality is caption_first
        setIsCheckingCaptions(false);
        // Optionally, set a generic message if URL is present but not YT/TikTok/Insta
        // if (videoUrl) setCaptionCheckError("Caption First is only for YouTube videos.");
      }
    } else {
      // Quality is not 'caption_first', no pre-checks needed
      setIsCheckingCaptions(false);
    }
  }, [videoUrl, quality]);

  // Form submission handler
  const handleSubmit = async (formData: FormData) => {
    setFieldErrors({});
    // Do not clear captionCheckError or platformSpecificMessage here, they are relevant context

    const currentVideoUrl = formData.get("videoUrl") as string;
    const currentQuality = formData.get("quality") as typeof quality;
    const currentSummaryType = summaryType;
    const platform = getVideoPlatform(currentVideoUrl);

    if (currentQuality === "caption_first") {
      if (platform !== "youtube") {
        setFieldErrors({ videoUrl: ["Caption First quality is only supported for YouTube URLs."] });
        if(!platformSpecificMessage) { 
            displayToast("submitJobForm.youtubeUrlRequiredForCaptionFirst", "error");
        }
        return;
      }
      if (!isYouTubeUrl(currentVideoUrl)) {
        displayToast("submitJobForm.youtubeUrlRequiredForCaptionFirst", "error");
        setFieldErrors({ videoUrl: ["A YouTube URL is required for Caption First quality."] });
        return;
      }
      if (captionsAvailable === false && !isCheckingCaptions) {
        displayToast("submitJobForm.captionsNotAvailableForCaptionFirst", "error");
        if (!captionCheckError) {
             setCaptionCheckError("Captions are not available for this video. Please choose another video or quality.");
        }
        return;
      }
      if (isCheckingCaptions) {
        displayToast("submitJobForm.checkingCaptionAvailability", "info");
        return;
      }
    }

    if ((platform === "tiktok" || platform === "instagram") && currentQuality === "caption_first") {
        setFieldErrors({ quality: ["Caption First is not available for this platform. Please select Standard or Premium."] });
        if(!platformSpecificMessage){
            toast.error("Caption First is not available for this platform. Please select Standard or Premium.");
        }
        return;
    }

    startTransition(async () => {
      // Create a new FormData object to include summary_type from state if not directly in form elements
      const augmentedFormData = new FormData();
      augmentedFormData.append("videoUrl", currentVideoUrl);
      augmentedFormData.append("quality", currentQuality);
      augmentedFormData.append("summary_type", currentSummaryType); // Add summaryType to the form data
      // Potentially copy other fields if your submitJobAction expects them and they are not covered by get("videoUrl") etc.
      // For now, assuming submitJobAction is adapted or only needs these specific fields from augmentedFormData

      const result = await submitJobAction(augmentedFormData); // Use augmentedFormData

      if (result.success) {
        displayToast("submitJobForm.jobSubmittedSuccess", "success", { jobId: result.jobId || "N/A" });
        setVideoUrl("");
        setQuality("standard");
        setSummaryType("none"); // Reset summary type
        setFieldErrors({});
        setCaptionCheckError(null); // Clear caption check error on successful main submission
        setCaptionsAvailable(null);
        setEstimatedDuration(null);
      } else {
        // For the general error, we might want to pass the server's error message as a parameter
        // or have a more generic message in the JSON.
        // For now, let's use a default message if result.error is not specific enough
        // or consider adding a new key for this specific fallback.
        // The current messages.frontend.json has "Failed to submit job." for jobSubmitFailed.
        // We can enhance this by passing `result.error` to a new placeholder.
        // Let's assume `jobSubmitFailed` can take a {details} param.
        // If not, we might need a new key like "jobSubmitFailedWithDetails"
        // Or, the displayToast can have a default message parameter.
        
        // Option 1: Use existing key and pass result.error as a parameter if the JSON supports it
        // displayToast("submitJobForm.jobSubmitFailed", "error", { details: result.error || "Unknown reason" });

        // Option 2: Use the default message from JSON if result.error is generic
        // This requires messages.json to have "Failed to submit job." as the description for "submitJobForm.jobSubmitFailed"
        // and we pass `result.error` as a default override IF the JSON key is not found or to supplement it.
        // The current displayToast uses defaultMessages if path isn't found.
        // For now, let's assume the "jobSubmitFailed" key is sufficient, and `result.error` is for logging or more detailed internal state.
        // If `result.error` IS the user-facing message, then the JSON shouldn't be used for it, or should have a generic wrapper.

        // Given the current JSON: "description": "Failed to submit job."
        // If result.error contains a more specific user-friendly message, it should be used.
        // Let's refine this: If result.error is present, it's likely the intended user message.
        if (result.error) {
            toast.error(result.error); // Keep direct use if the error string is from server and meant for display
        } else {
            displayToast("submitJobForm.jobSubmitFailed", "error");
        }
        
        if (result.fieldErrors) {
          setFieldErrors(result.fieldErrors);
          // If the error is for videoUrl, and it's a caption_first YouTube error from the server,
          // it might be redundant with captionCheckError. Prioritize server error here.
          if (result.fieldErrors.videoUrl && quality === 'caption_first' && isYouTubeUrl(videoUrl)) {
            setCaptionCheckError(null); 
          }
        }
      }
    });
  };
  
  const isNonYouTubeCaptionFirstSelected = quality === "caption_first" && (getVideoPlatform(videoUrl) === 'tiktok' || getVideoPlatform(videoUrl) === 'instagram');

  const canSubmit =
    !isPending &&
    !isCheckingCaptions &&
    !isNonYouTubeCaptionFirstSelected && 
    (quality !== "caption_first" || !isYouTubeUrl(videoUrl) || captionsAvailable === true);


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
                Video URL (YouTube, TikTok, Instagram Reel, etc.)
              </label>
              <Input
                id="videoUrl"
                name="videoUrl"
                placeholder="https://www.youtube.com/watch?v=... or TikTok/Instagram Reel URL"
                value={videoUrl}
                onChange={(e) => { 
                  setVideoUrl(e.target.value); 
                  setFieldErrors(prev => ({ ...prev, videoUrl: undefined }));
                  setPlatformSpecificMessage(null); // Reset message on URL change
                }}
                required
                disabled={isPending || isCheckingCaptions}
              />
              {fieldErrors?.videoUrl && <p className="text-xs text-red-500 mt-1">{fieldErrors.videoUrl[0]}</p>}
              {platformSpecificMessage && (
                <Alert variant="destructive" className="mt-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Information</AlertTitle>
                  <AlertDescription>{platformSpecificMessage}</AlertDescription>
                </Alert>
              )}
            </div>
            <div className="space-y-2">
              <label htmlFor="quality" className="text-sm font-medium">
                Transcription Quality
              </label>
              <input type="hidden" name="quality" value={quality} />
              <Select
                value={quality}
                onValueChange={(value: string) => {
                  setQuality(value as typeof quality);
                  setFieldErrors(prev => ({ ...prev, quality: undefined }));
                  setPlatformSpecificMessage(null); // Reset message on quality change
                }}
                disabled={isPending || isLoadingProfile || isCheckingCaptions}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select quality" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="caption_first">Caption First (YouTube Only)</SelectItem>
                  <SelectItem value="standard">Standard (Audio)</SelectItem>
                  <SelectItem value="premium">Premium (Audio)</SelectItem>
                </SelectContent>
              </Select>
              {fieldErrors?.quality && <p className="text-xs text-red-500 mt-1">{fieldErrors.quality[0]}</p>}
              {captionCheckError && quality === 'caption_first' && isYouTubeUrl(videoUrl) && (
                <Alert variant={captionsAvailable === false ? "destructive" : "default"} className="mt-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{captionsAvailable === false ? "Captions Unavailable" : "Caption Info"}</AlertTitle>
                  <AlertDescription>{captionCheckError}</AlertDescription>
                </Alert>
              )}
              {captionsAvailable && quality === 'caption_first' && isYouTubeUrl(videoUrl) && !captionCheckError && (
                <Alert variant="default" className="mt-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <AlertTitle className="text-green-700">Captions Available</AlertTitle>
                  <AlertDescription className="text-green-600">
                    YouTube captions detected. 
                    {estimatedDuration ? `Estimated video duration: ${estimatedDuration} min.` : ''}
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {/* NEW: Summary Type Selection */}
            {isPaidUser && (
              <div className="space-y-2">
                <label htmlFor="summary_type" className="text-sm font-medium">
                  Summary Type (Optional)
                </label>
                <Select
                  value={summaryType}
                  onValueChange={(value: string) => {
                    setSummaryType(value as "none" | "basic" | "extended");
                    setFieldErrors(prev => ({ ...prev, summary_type: undefined })); 
                  }}
                  disabled={isPending || isLoadingProfile || isCheckingCaptions}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select summary type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="basic">Basic Summary (2 credits)</SelectItem>
                    <SelectItem value="extended">Extended Summary (5 credits)</SelectItem>
                  </SelectContent>
                </Select>
                {fieldErrors?.summary_type && <p className="text-xs text-red-500 mt-1">{fieldErrors.summary_type[0]}</p>}
                 <p className="text-gray-500 text-xs mt-1">
                  Generate a concise (basic) or detailed (extended) summary of the transcript.
                </p>
              </div>
            )}
            {!isPaidUser && (
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-500">
                        Summary Type
                    </label>
                    <Select disabled={true}>
                        <SelectTrigger>
                            <SelectValue placeholder="Upgrade for summaries" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">Summaries available on paid plans</SelectItem>
                        </SelectContent>
                    </Select>
                    <p className="text-gray-500 text-xs mt-1">
                        Upgrade to a Starter or Pro plan to enable automatic summary generation.
                    </p>
                </div>
            )}
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button type="button" variant="outline" onClick={() => { 
              setVideoUrl(""); 
              setQuality("standard"); 
              setSummaryType("none"); // Reset summary type on cancel
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
