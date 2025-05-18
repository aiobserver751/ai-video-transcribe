'use client'; // Needs to be a client component for usePathname

import Link from 'next/link'; // Import Link
import { usePathname } from 'next/navigation'; // Import usePathname
import { Home, FileText, Settings, Plus, User, CreditCard, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

// Remove props interface - no longer needed
// interface DashboardSidebarProps {
//   activeTab: string;
//   setActiveTab: (tab: string) => void;
// }

// Remove props from component signature
const DashboardSidebar = () => {
  const pathname = usePathname(); // Get current pathname

  // Add href to menu items
  const primaryMenuItems = [
    { id: "dashboard", label: "Dashboard", icon: Home, href: "/dashboard" },
    { id: "jobs", label: "My transcriptions", icon: FileText, href: "/jobs" }, // Assuming /jobs route exists or will exist
    { id: "new", label: "New Transcription", icon: Plus, href: "/transcribe" }, // Assuming /transcribe route exists or will exist
  ];

  const accountMenuItems = [
    { id: "account", label: "Account Information", icon: User, href: "/account" },
    { id: "settings", label: "Settings", icon: Settings, href: "/settings" },
    { id: "billing", label: "Billing", icon: CreditCard, href: "/billing" },
    { id: "usage", label: "Usage", icon: BarChart3, href: "/usage" },
  ];

  return (
    <div className="hidden md:flex flex-col w-64 border-r border-gray-200 bg-white h-full"> {/* Added h-full */}
      <div className="p-4 border-b border-gray-200">
        {/* Logo Area - Wrap with Link to home/dashboard? */}
        <Link href="/dashboard" className="flex items-center gap-2">
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
        </Link>
      </div>
      
      <div className="flex-1 py-6 px-3 overflow-y-auto">
        <nav className="space-y-1">
          {/* Primary Menu Items - Use Link */} 
          {primaryMenuItems.map((item) => (
            <Link key={item.id} href={item.href} passHref legacyBehavior>
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-start gap-2 font-normal hover:bg-gray-100",
                  // Update active state logic
                  pathname === item.href && "bg-gray-100 text-indigo-600"
                )}
                // Remove onClick
                // onClick={() => setActiveTab(item.id)}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Button>
            </Link>
          ))}

          <Separator className="my-4" />

          <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Account Setup</p>
          {/* Account Menu Items - Use Link */}
          {accountMenuItems.map((item) => (
            <Link key={item.id} href={item.href} passHref legacyBehavior>
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-start gap-2 font-normal hover:bg-gray-100",
                   // Update active state logic
                  pathname === item.href && "bg-gray-100 text-indigo-600"
                )}
                // Remove onClick
                // onClick={() => setActiveTab(item.id)} 
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Button>
            </Link>
          ))}
        </nav>
      </div>
      
      {/* Footer - Keep or remove? This seems like static info */}
      {/* <div className="p-4 border-t border-gray-200 mt-auto"> 
        <div className="flex items-center gap-2 text-sm">
          <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-medium">
            U
          </div>
          <div>
            <p className="font-medium">User</p>
            <p className="text-gray-500 text-xs">Free Plan</p>
          </div>
        </div>
      </div> */}
    </div>
  );
};

export default DashboardSidebar;
