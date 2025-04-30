
import { Home, FileText, Settings, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DashboardSidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const DashboardSidebar = ({ activeTab, setActiveTab }: DashboardSidebarProps) => {
  const menuItems = [
    { id: "jobs", label: "My Jobs", icon: FileText },
    { id: "new", label: "New Transcription", icon: Plus },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="hidden md:flex flex-col w-64 border-r border-gray-200 bg-white">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
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
        </div>
      </div>
      
      <div className="flex-1 py-6 px-3">
        <nav className="space-y-1">
          <Button
            variant="ghost"
            className={cn(
              "w-full justify-start gap-2 font-normal hover:bg-gray-100",
              activeTab === "dashboard" && "bg-gray-100 text-indigo-600"
            )}
            onClick={() => setActiveTab("dashboard")}
          >
            <Home className="h-5 w-5" />
            Dashboard
          </Button>
          
          {menuItems.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              className={cn(
                "w-full justify-start gap-2 font-normal hover:bg-gray-100",
                activeTab === item.id && "bg-gray-100 text-indigo-600"
              )}
              onClick={() => setActiveTab(item.id)}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Button>
          ))}
        </nav>
      </div>
      
      <div className="p-4 border-t border-gray-200">
        <div className="flex items-center gap-2 text-sm">
          <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-medium">
            U
          </div>
          <div>
            <p className="font-medium">User</p>
            <p className="text-gray-500 text-xs">Free Plan</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardSidebar;
