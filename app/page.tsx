"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import LandingHero from "@/components/landing/LandingHero";
import LandingFeatures from "@/components/landing/LandingFeatures";
import LandingNavbar from "@/components/landing/LandingNavbar";
import LandingFooter from "@/components/landing/LandingFooter";

export default function HomePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleDemoLogin = async () => {
    setIsLoading(true);
    setTimeout(() => {
      toast.success("Demo login successful!");
      router.push("/dashboard");
      setIsLoading(false);
    }, 1000);
  };

  return (
    <div className="flex flex-col min-h-screen">
      <LandingNavbar />
      
      <main className="flex-1">
        <LandingHero onDemoLogin={handleDemoLogin} isLoading={isLoading} />
        <LandingFeatures />
      </main>
      
      <LandingFooter />
    </div>
  );
}
