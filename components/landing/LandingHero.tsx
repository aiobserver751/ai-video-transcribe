"use client";

import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

interface LandingHeroProps {
  onDemoLogin: () => void;
  isLoading: boolean;
}

const LandingHero = ({ onDemoLogin, isLoading }: LandingHeroProps) => {
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
                  disabled={isLoading}
                  size="lg" 
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {isLoading ? "Signing in..." : "Sign up for free (no credit card required)"}
                  {!isLoading && <ArrowRight className="ml-2 h-4 w-4" />}
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
    </>
  );
};

export default LandingHero;
