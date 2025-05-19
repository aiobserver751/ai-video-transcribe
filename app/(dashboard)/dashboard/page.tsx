"use client";

// import { useSession } from 'next-auth/react'; // Removed as session is not used
import { useUserProfile } from '@/context/UserProfileContext';
import { useQuery } from '@tanstack/react-query';
import { getDailyTranscriptionStats } from '@/app/actions/jobActions'; // Updated server action
import { BarChart, DonutChart, Legend } from '@tremor/react';
import { Loader2, AlertTriangle } from 'lucide-react'; // For loading/error indicators
import { Button } from '@/components/ui/button'; // Assuming Button component is available
// import { format } from 'date-fns'; // Removed as format is not used
import { useState } from 'react'; // Import useState
import { getCreditSpendingBreakdown, SpendingBreakdownItem } from '@/app/actions/creditActions'; // Import new action and type
import useEmblaCarousel from 'embla-carousel-react'; // Import Embla Carousel
import Autoplay from 'embla-carousel-autoplay'; // Import Autoplay plugin

// Placeholder for Tremor chart import - will add later
// import { BarChart } from '@tremor/react'; 

// Define the expected shape of our daily stats items
interface DailyStat {
  date: string;
  transcriptions: number;
  summaries: number; // Added summaries count
}

export default function DashboardPage() {
  // const { data: session } = useSession(); // Removed as session is not used
  const { profile } = useUserProfile();
  const userId = profile?.id;
  const [activityDaysToShow, setActivityDaysToShow] = useState<number>(7); // Renamed for clarity
  const [creditDaysToShow, setCreditDaysToShow] = useState<number>(14); // New state for credit chart

  const dailyStatsQueryKey = ['dailyTranscriptionStats', userId, activityDaysToShow] as const;

  const {
    data: dailyStats,
    isLoading: dailyStatsLoading,
    error: dailyStatsError,
  } = useQuery<DailyStat[], Error, DailyStat[], typeof dailyStatsQueryKey>({
    queryKey: dailyStatsQueryKey,
    queryFn: async () => {
      if (!userId) return [];
      return getDailyTranscriptionStats(userId, activityDaysToShow);
    },
    enabled: !!userId,
    placeholderData: [],
  });

  // Query for Credit Spending Breakdown (Card 3)
  const creditSpendingQueryKey = ['creditSpendingBreakdown', userId, creditDaysToShow] as const;
  const {
    data: creditSpendingData,
    isLoading: creditSpendingLoading,
    error: creditSpendingError,
  } = useQuery<SpendingBreakdownItem[], Error, SpendingBreakdownItem[], typeof creditSpendingQueryKey>({
    queryKey: creditSpendingQueryKey,
    queryFn: async () => {
      if (!userId) return [];
      return getCreditSpendingBreakdown(userId, creditDaysToShow); // Pass new state to action
    },
    enabled: !!userId,
    placeholderData: [],
  });

  // DEBUGGING: Log credit spending query state
  // console.log("Credit Spending - Loading:", creditSpendingLoading, "Error:", creditSpendingError, "Data:", creditSpendingData);

  const usageTips = [
    "Tip 1: Upload clear audio for best transcription results!",
    "Tip 2: Use our summary feature to get quick insights.",
    "Tip 3: Check your credit balance regularly from the sidebar.",
    "Tip 4: Premium transcriptions offer higher accuracy for noisy audio.",
    "Tip 5: Explore content ideas based on your transcriptions!"
  ];

  const [emblaRef] = useEmblaCarousel({ loop: true }, [Autoplay({ delay: 4000 })]); // Initialize Embla with Autoplay

  // Old query for weeklyTranscriptionCount - This will be removed entirely
  // const queryKey = ['weeklyTranscriptionCount', userId] as const; 
  // const {
  //   data: weeklyTranscriptionCount,
  //   isLoading: countLoading,
  //   error: countError,
  // } = useQuery<number, Error, number, typeof queryKey>({
  //   queryKey: queryKey,
  //   queryFn: async () => { 
  //     if (!userId) return 0; 
  //     return getWeeklyTranscriptionCount(userId); // This function is being replaced
  //   },
  //   enabled: !!userId,
  // });

  // New query for daily stats will be added here later

  // Remove activeTab state, router, job fetching logic, handlers etc.

  // Remove loading/error states related to jobs

  // Simplified return for the main dashboard content
  return (
    <div className="space-y-6">
      {/* <h1 className="text-2xl font-bold">Dashboard Overview</h1> */}
      {/* <p>Welcome to your dashboard. Summary information will go here.</p> */}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Daily Activity (Last {activityDaysToShow} Days)</h2>
            <div className="flex space-x-2">
              <Button 
                variant={activityDaysToShow === 7 ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActivityDaysToShow(7)}
              >
                7 Days
              </Button>
              <Button 
                variant={activityDaysToShow === 14 ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActivityDaysToShow(14)}
              >
                14 Days
              </Button>
            </div>
          </div>

          {dailyStatsLoading && (
            <div className="flex items-center justify-center h-72">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              <p className="ml-2 text-gray-500">Loading chart data...</p>
            </div>
          )}
          {dailyStatsError && (
            <div className="flex flex-col items-center justify-center h-72 text-red-500">
              <AlertTriangle className="h-8 w-8 mb-2" />
              <p>Error loading chart data.</p>
              {dailyStatsError.message && <p className="text-sm">{dailyStatsError.message}</p>}
            </div>
          )}
          {!dailyStatsLoading && !dailyStatsError && dailyStats && (
            <>
              {dailyStats.length > 0 ? (
                <BarChart
                  className="mt-2 h-72"
                  data={dailyStats}
                  index="date"
                  categories={['transcriptions', 'summaries']}
                  colors={['blue', 'green']}
                  yAxisWidth={30}
                  showLegend={true}
                  showTooltip={false}
                />
              ) : (
                <div className="flex items-center justify-center h-72">
                  <p className="text-gray-500">No activity data available for the last {activityDaysToShow} days.</p>
                </div>
              )}
            </>
          )}
        </div>
        {/* Card 2 - YouTube Embed */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-4">Watch Our Quick Start Guide</h2>
          <div className="aspect-w-16 aspect-h-9"> {/* Tailwind aspect ratio for 16:9 video */}
            <iframe 
              className="w-full h-full"
              src="https://www.youtube.com/embed/dQw4w9WgXcQ" 
              title="YouTube video player" 
              frameBorder="0" 
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
              referrerPolicy="strict-origin-when-cross-origin" 
              allowFullScreen
            ></iframe>
          </div>
        </div>
        {/* Card 3 - Credit Spending Breakdown */}
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Credit Usage Breakdown (Last {creditDaysToShow} Days)</h2>
            <div className="flex space-x-2">
              <Button 
                variant={creditDaysToShow === 7 ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCreditDaysToShow(7)}
              >
                7 Days
              </Button>
              <Button 
                variant={creditDaysToShow === 14 ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCreditDaysToShow(14)}
              >
                14 Days
              </Button>
            </div>
          </div>

          {creditSpendingLoading && (
            <div className="flex items-center justify-center h-72">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              <p className="ml-2 text-gray-500">Loading spending data...</p>
            </div>
          )}
          {creditSpendingError && (
            <div className="flex flex-col items-center justify-center h-72 text-red-500">
              <AlertTriangle className="h-8 w-8 mb-2" />
              <p>Error loading spending data.</p>
              {creditSpendingError.message && <p className="text-sm">{creditSpendingError.message}</p>}
            </div>
          )}
          {!creditSpendingLoading && !creditSpendingError && creditSpendingData && (
            <>
              {creditSpendingData.length > 0 ? (
                <div className="flex flex-col items-center" key={creditDaysToShow}>
                  <DonutChart
                    className="mt-2 h-72"
                    data={creditSpendingData}
                    category="value"
                    index="name"
                    colors={['rose', 'yellow', 'orange', 'cyan', 'indigo']}
                    variant="pie"
                    valueFormatter={(number) => `${Intl.NumberFormat('us').format(number).toString()} Credits`}
                    showAnimation={true}
                  />
                  <Legend
                    className="mt-4"
                    categories={creditSpendingData.map(item => item.name)}
                    colors={['rose', 'yellow', 'orange', 'cyan', 'indigo']}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-center h-72">
                  <p className="text-gray-500">No credit spending data available for the last {creditDaysToShow} days.</p>
                </div>
              )}
            </>
          )}
        </div>
        {/* Card 4 - Usage Tips Carousel */}
        <div className="bg-white p-6 rounded-lg shadow flex flex-col h-full"> {/* Ensure card can grow if needed, added h-full and flex-col */}
          <h2 className="text-lg font-semibold mb-4 text-slate-800">Quick Tips</h2>
          <div className="embla overflow-hidden rounded-md" ref={emblaRef}> {/* Added rounded-md to viewport */}
            <div className="embla__container flex"> {/* Embla container */}
              {usageTips.map((tip, index) => (
                <div className="embla__slide flex-[0_0_100%] min-w-0" key={index}> {/* Embla slide, removed pl/pr */}
                  {/* Tip Box Styling */}
                  <div className="h-48 flex flex-col items-center justify-center text-center p-6 bg-sky-50 border border-sky-100 rounded-lg shadow-sm">
                    <p className="text-slate-700 text-base leading-relaxed font-medium">{tip}</p> {/* Increased font size, changed color, added font-medium */}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {/* Ensure NO <DashboardSidebar>, <Sheet>, <Tabs>, <DashboardHeader> are rendered here */}
      {/* The layout file app/(dashboard)/layout.tsx handles Sidebar and Header */}
    </div>
  );
} 