"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import LandingHero from "@/components/landing/LandingHero";
import LandingFeatures from "@/components/landing/LandingFeatures";
import LandingPricing from "@/components/landing/PricingSection";
import LandingNavbar from "@/components/landing/LandingNavbar";
import LandingFooter from "@/components/landing/LandingFooter";
import { displayToast } from "@/lib/toastUtils";

export default function HomePage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (status === "authenticated" && session) {
      router.push("/dashboard");
    }
  }, [session, status, router]);

  const handleDemoLogin = async () => {
    setIsLoading(true);
    setTimeout(() => {
      displayToast("homePage.demoLoginSuccess", "success");
      router.push("/dashboard");
      setIsLoading(false);
    }, 1000);
  };

  if (status === "loading" || (status === "authenticated" && session)) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="flex flex-col min-h-screen">
        <LandingNavbar />
        
        <main className="flex-1">
          <LandingHero onDemoLogin={handleDemoLogin} isLoading={isLoading} />
          <LandingFeatures />
          <LandingPricing />
        </main>
        
        <LandingFooter />
      </div>
    );
  }

  return null;
}
