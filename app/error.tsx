"use client";

import { useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center max-w-md">
        <h1 className="text-6xl font-bold text-destructive mb-4">Oops!</h1>
        <p className="text-2xl font-semibold text-foreground mb-4">Something went wrong</p>
        <p className="text-muted-foreground mb-8">
          We encountered an unexpected issue. Please try again, or contact support if the problem persists.
        </p>
        <Button
          onClick={(
            // Attempt to recover by trying to re-render the segment
            () => reset()
          )}
          size="lg"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Try Again
        </Button>
      </div>
    </div>
  );
} 