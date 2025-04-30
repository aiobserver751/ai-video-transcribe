"use client";

import { useState, useTransition } from "react";
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
import { Loader2 } from "lucide-react";
import { submitJobAction } from "@/lib/actions/jobActions";

const SubmitJobForm = () => {
  const [videoUrl, setVideoUrl] = useState("");
  const [quality, setQuality] = useState<"standard" | "premium">("standard");
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<{ videoUrl?: string[], quality?: string[] }>({});

  // Validate YouTube URL
  const isValidYoutubeUrl = (url: string) => {
    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname;
      
      // Check if it's a YouTube domain
      if (
        hostname === "youtube.com" ||
        hostname === "www.youtube.com" ||
        hostname === "youtu.be"
      ) {
        // For youtube.com or www.youtube.com, check for 'v' parameter
        if (hostname === "youtube.com" || hostname === "www.youtube.com") {
          return parsedUrl.searchParams.has("v");
        }
        // For youtu.be, the video ID is in the pathname
        return parsedUrl.pathname.length > 1;
      }
      return false;
    } catch (e) {
      console.error("URL validation error:", e);
      return false;
    }
  };

  // Form submission handler
  const handleSubmit = async (formData: FormData) => {
    setFieldErrors({}); // Clear previous errors

    // Basic client-side checks
    const url = formData.get("videoUrl") as string;
    if (!url) {
      toast.error("Please enter a YouTube video URL");
      setFieldErrors({ videoUrl: ["URL is required."] });
      return;
    }
    if (!isValidYoutubeUrl(url)) {
      toast.error("Please enter a valid YouTube video URL");
      setFieldErrors({ videoUrl: ["Invalid YouTube URL format."] });
      return;
    }

    // Use startTransition to wrap the server action call
    startTransition(async () => {
      const result = await submitJobAction(formData);

      if (result.success) {
        toast.success(`Job ${result.jobId} submitted successfully!`);
        setVideoUrl(""); // Clear form on success
        setQuality("standard");
        setFieldErrors({});
      } else {
        toast.error(result.error || "Failed to submit job.");
        if (result.fieldErrors) {
          setFieldErrors(result.fieldErrors);
        }
      }
    });
  };

  return (
    <Card>
      <form action={handleSubmit}>
        <CardHeader>
          <CardTitle>Submit YouTube Video</CardTitle>
          <CardDescription>
            Enter a YouTube video URL to create a new transcription job.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="videoUrl" className="text-sm font-medium">
              YouTube Video URL
            </label>
            <Input
              id="videoUrl"
              name="videoUrl"
              placeholder="https://www.youtube.com/watch?v=..."
              value={videoUrl}
              onChange={(e) => { setVideoUrl(e.target.value); setFieldErrors({}); }}
              required
              disabled={isPending}
            />
            {fieldErrors?.videoUrl && <p className="text-xs text-red-500">{fieldErrors.videoUrl[0]}</p>}
          </div>
          <div className="space-y-2">
            <label htmlFor="quality" className="text-sm font-medium">
              Transcription Quality
            </label>
            <input type="hidden" name="quality" value={quality} />
            <Select
              value={quality}
              onValueChange={(value: string) => { setQuality(value as "standard" | "premium"); setFieldErrors({}); }}
              disabled={isPending}
            >
              <SelectTrigger id="quality">
                <SelectValue placeholder="Select quality" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="premium">Premium</SelectItem>
              </SelectContent>
            </Select>
            {fieldErrors?.quality && <p className="text-xs text-red-500">{fieldErrors.quality[0]}</p>}
            <p className="text-xs text-gray-500">
              Premium quality offers higher accuracy and speaker identification.
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button type="button" variant="outline" disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isPending ? "Submitting..." : "Submit for Transcription"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};

export default SubmitJobForm;
