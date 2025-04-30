"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface LandingHeroProps {
  onDemoLogin: () => void;
  isLoading: boolean;
}

const LandingHero = ({ onDemoLogin, isLoading }: LandingHeroProps) => {
  const router = useRouter();
  const [showGoogleDialog, setShowGoogleDialog] = useState(false);
  const [localIsLoading, setLocalIsLoading] = useState(false);

  const handleLoginClick = () => {
    setShowGoogleDialog(true);
  };

  const handleGoogleAccountSelect = (email: string) => {
    console.log(`Selected Google account: ${email}`);
    setShowGoogleDialog(false);
    setLocalIsLoading(true);
    
    setTimeout(() => {
      router.push("/dashboard");
      setLocalIsLoading(false);
    }, 500);
  };

  return (
    <>
      <section className="w-full py-12 md:py-24 lg:py-32 xl:py-40 bg-white">
        <div className="container px-4 md:px-6">
          <div className="grid gap-6 lg:grid-cols-2 lg:gap-12 xl:grid-cols-2">
            <div className="flex flex-col justify-center space-y-4">
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl lg:text-6xl/none">
                  Convert YouTube Videos to Text in Minutes
                </h1>
                <p className="max-w-[600px] text-gray-500 md:text-xl dark:text-gray-400">
                  Submit any YouTube video URL and get accurate transcriptions delivered to your dashboard. Perfect for content creators, researchers, and students.
                </p>
              </div>
              <div className="flex flex-col gap-2 min-[400px]:flex-row">
                <Button 
                  onClick={onDemoLogin} 
                  disabled={isLoading || localIsLoading}
                  size="lg" 
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {isLoading || localIsLoading ? "Signing in..." : "Try Demo"}
                  {!isLoading && !localIsLoading && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={handleLoginClick}
                  disabled={isLoading || localIsLoading}
                >
                  Sign in with Google
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-center">
              <div className="relative w-full max-w-[500px] aspect-video rounded-xl border bg-gray-100 overflow-hidden shadow-lg">
                <img 
                  src={`https://images.unsplash.com/photo-1488590528505-98d2b5aba04b`} 
                  alt="Laptop on desk" 
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <Dialog open={showGoogleDialog} onOpenChange={setShowGoogleDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sign in with Google</DialogTitle>
            <DialogDescription>
              Choose an account to continue to TranscribeYT
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col space-y-3 py-4">
            <GoogleAccount 
              email="user@gmail.com" 
              name="John Doe"
              onClick={() => handleGoogleAccountSelect("user@gmail.com")}
            />
            <GoogleAccount 
              email="work@gmail.com" 
              name="John Doe (Work)"
              onClick={() => handleGoogleAccountSelect("work@gmail.com")}
            />
            <GoogleAccount 
              email="personal@gmail.com" 
              name="John Doe (Personal)"
              onClick={() => handleGoogleAccountSelect("personal@gmail.com")}
            />
            <div className="mt-2 flex justify-center">
              <Button variant="outline" size="sm">
                Use another account
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

const GoogleAccount = ({ 
  email, 
  name, 
  onClick 
}: { 
  email: string; 
  name: string; 
  onClick: () => void 
}) => {
  return (
    <button
      onClick={onClick}
      className="flex items-center space-x-3 rounded-md border p-3 hover:bg-slate-100 transition-colors text-left w-full"
    >
      <div className="h-10 w-10 overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-medium">
        {name.charAt(0)}
      </div>
      <div>
        <p className="font-medium">{name}</p>
        <p className="text-sm text-gray-500">{email}</p>
      </div>
    </button>
  );
};

export default LandingHero;
