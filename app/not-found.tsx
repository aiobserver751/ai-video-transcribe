"use client"; // Needed for onClick handler if using router.push, but Link is preferred

// import { useRouter } from "next/navigation"; // Use Next.js router - Removed as Link is used
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link"; // Use Next.js Link for navigation

// This component is automatically rendered by Next.js for 404 errors
export default function NotFound() {
  // const router = useRouter(); // Removed

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center max-w-md">
        <h1 className="text-6xl font-bold text-primary mb-4">404</h1>
        <p className="text-2xl font-semibold text-foreground mb-4">Page Not Found</p>
        <p className="text-muted-foreground mb-8">
          Sorry, the page you are looking for does not exist or has been moved.
        </p>
        {/* Option 1: Button using router.push */}
        {/* <Button onClick={() => router.push('/')} size="lg"> */}
        {/*  <ArrowLeft className="mr-2 h-4 w-4" /> */}
        {/*  Return to Home */}
        {/* </Button> */}

        {/* Option 2: Link component (more conventional for simple navigation) */}
        <Button asChild size="lg"> 
          <Link href="/">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Return to Home
          </Link>
        </Button>
      </div>
    </div>
  );
} 