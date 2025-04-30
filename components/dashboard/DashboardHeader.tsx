"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Bell, Search } from "lucide-react";

const DashboardHeader = () => {
  const router = useRouter();

  const handleLogout = () => {
    // In a real app, you would implement proper logout logic using next-auth signOut
    // For now, just navigate to home page
    router.push("/");
  };

  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="container mx-auto h-16 flex items-center justify-between px-4">
        <div className="md:hidden">
          {/* Mobile menu button would go here */}
        </div>
        
        <div className="hidden md:flex items-center gap-4 flex-1">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search jobs..."
              className="w-full rounded-md border border-gray-200 pl-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <button className="relative w-8 h-8 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-100">
            <Bell className="h-5 w-5" />
            <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-red-500"></span>
          </button>
          
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-medium">
              U
            </div>
            
            <div className="hidden md:block">
              <p className="text-sm font-medium">User</p>
              <p className="text-xs text-gray-500">user@example.com</p>
            </div>
          </div>
          
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Logout
          </Button>
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
