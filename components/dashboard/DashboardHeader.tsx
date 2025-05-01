"use client";

import { Button } from "@/components/ui/button";
// import { useRouter } from "next/navigation"; // Remove unused import
import { Bell, Search } from "lucide-react";
import { signOut } from "next-auth/react";
import { useUserProfile } from "@/context/UserProfileContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";

const DashboardHeader = () => {
  // const router = useRouter(); // Remove unused variable
  const { profile, isLoading } = useUserProfile();

  const handleLogout = async () => {
    await signOut({ callbackUrl: '/' });
  };

  const initials = profile?.name
    ? profile.name.split(' ').map((n) => n[0]).join('').toUpperCase()
    : profile?.email?.[0].toUpperCase() ?? 'U';

  return (
    <header className="bg-white dark:bg-gray-950 shadow-sm border-b border-gray-200 dark:border-gray-800">
      <div className="container mx-auto h-16 flex items-center justify-between px-4">
        <div className="md:hidden">
          {/* Mobile menu button is handled in layout now */}
        </div>
        
        <div className="hidden md:flex items-center gap-4 flex-1">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500 dark:text-gray-400" />
            <input
              type="text"
              placeholder="Search jobs..."
              className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 pl-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <button className="relative w-8 h-8 rounded-full flex items-center justify-center text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <Bell className="h-5 w-5" />
            <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-red-500"></span>
          </button>
          
          <div className="flex items-center gap-2">
            {isLoading ? (
              <Skeleton className="h-8 w-8 rounded-full" />
            ) : (
              <Avatar className="h-8 w-8">
                {profile?.image && <AvatarImage src={profile.image} alt={profile.name ?? 'User Avatar'} />}
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            )}
            
            <div className="hidden md:block">
              {isLoading ? (
                <div className="space-y-1">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-3 w-28" />
                </div>
              ) : (
                <>
                  <p className="text-sm font-medium">{profile?.name ?? 'User'}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{profile?.email ?? 'No email'}</p>
                </>
              )}
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
