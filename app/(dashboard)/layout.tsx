import React from 'react';
import DashboardSidebar from '@/components/dashboard/DashboardSidebar';
import DashboardHeader from '@/components/dashboard/DashboardHeader'; 
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";

// Layout for all dashboard-related pages
export default function DashboardLayout({
  children, // will be a page or nested layout
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-50">
      {/* Static Desktop Sidebar */}
      <DashboardSidebar />

      {/* Mobile Sidebar in Sheet */}
      <Sheet>
        <SheetTrigger asChild>
          {/* Position trigger fixed for mobile view */}
          <Button variant="outline" size="icon" className="md:hidden fixed top-4 left-4 z-50 bg-background">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-64">
          {/* Render sidebar inside the sheet for mobile */}
          <DashboardSidebar />
        </SheetContent>
      </Sheet>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-y-auto">
        {/* Add Header here if it should be part of the layout */}
        <DashboardHeader /> 
        {/* Page content is rendered here */}
        <div className="flex-1 p-4 md:p-8 pt-6">
           {children}
        </div>
      </main>
    </div>
  );
} 