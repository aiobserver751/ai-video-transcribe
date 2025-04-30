"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { signIn } from "next-auth/react";

const LandingNavbar = () => {
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      await signIn("google", { 
        callbackUrl: "/dashboard", 
      });
    } catch (error) {
      console.error("Error during Google sign-in:", error);
      setIsLoggingIn(false);
    }
  };

  return (
    <header className="border-b border-border">
      <div className="container flex h-16 items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6 text-indigo-600"
          >
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
          <span className="text-xl font-bold">TranscribeYT</span>
        </div>
        <nav className="hidden md:flex items-center gap-6">
          <a href="#features" className="text-sm font-medium hover:underline">
            Features
          </a>
          <a href="#pricing" className="text-sm font-medium hover:underline">
            Pricing
          </a>
          <a href="#faq" className="text-sm font-medium hover:underline">
            FAQ
          </a>
        </nav>
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={handleLogin}
            disabled={isLoggingIn}
            className="hidden sm:flex"
          >
            {isLoggingIn ? "Signing in..." : "Sign in with Google"}
          </Button>
          <Button onClick={handleLogin} disabled={isLoggingIn}>
            {isLoggingIn ? "Signing in..." : "Get Started"}
          </Button>
        </div>
      </div>
    </header>
  );
};

export default LandingNavbar;
