"use client";

export default function DashboardPage() {
  // Remove activeTab state, router, job fetching logic, handlers etc.

  // Remove loading/error states related to jobs

  // Simplified return for the main dashboard content
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard Overview</h1>
      {/* TODO: Add relevant dashboard summary components here */}
      <p>Welcome to your dashboard. Summary information will go here.</p>
      
      {/* Ensure NO <DashboardSidebar>, <Sheet>, <Tabs>, <DashboardHeader> are rendered here */}
      {/* The layout file app/(dashboard)/layout.tsx handles Sidebar and Header */}
    </div>
  );
} 