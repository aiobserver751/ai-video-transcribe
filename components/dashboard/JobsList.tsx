'use client';

import { useState } from "react";
import { useRouter } from 'next/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type TranscriptionJob } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { FileText, PlusCircle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { differenceInDays } from "date-fns";

// Define possible badge variants based on shadcn/ui (adjust if needed)
type BadgeVariant = BadgeProps["variant"];

// --- Constants ---
const ITEMS_PER_PAGE = 25; // Number of jobs per page

interface JobsListProps {
  jobs: TranscriptionJob[];
  onViewDetails: (jobId: string) => void;
}

const JobsList = ({ jobs, onViewDetails }: JobsListProps) => {
  const router = useRouter();
  
  // State for filters
  const [typeFilter, setTypeFilter] = useState('all'); // 'all', 'normal', 'api'
  const [createdFilter, setCreatedFilter] = useState('all'); // 'all', '7', '30'
  // State for pagination
  const [currentPage, setCurrentPage] = useState(1);

  // Function to get status badge color
  const getStatusBadgeVariant = (status: string): BadgeVariant => {
    switch (status) {
      case "completed":
        return "success";
      case "processing":
      case "pending_credit_deduction": // Treat as processing for badge color
        return "default";
      case "failed":
      case "failed_insufficient_credits": // Treat as failed for badge color
        return "destructive";
      default:
        return "secondary";
    }
  };

  // Filter jobs based on state
  const filteredJobs = jobs.filter(job => {
    // Type filter
    const typeMatch = typeFilter === 'all' || 
                      (typeFilter === 'normal' && job.origin === 'INTERNAL') ||
                      (typeFilter === 'api' && job.origin === 'EXTERNAL');

    // Created date filter
    const now = new Date();
    const jobAgeDays = differenceInDays(now, job.createdAt);
    const createdMatch = createdFilter === 'all' ||
                         (createdFilter === '7' && jobAgeDays <= 7) ||
                         (createdFilter === '30' && jobAgeDays <= 30);

    return typeMatch && createdMatch;
  });

  // --- Pagination Logic ---
  const totalPages = Math.ceil(filteredJobs.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  // Get the slice of jobs for the current page
  const paginatedJobs = filteredJobs.slice(startIndex, endIndex);

  // --- Event Handlers ---
  const handlePreviousPage = () => {
    setCurrentPage((prev) => Math.max(prev - 1, 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(prev + 1, totalPages));
  };

  // --- Reset page number when filters change ---
  // (Consider if needed - might be slightly jarring)
  // useEffect(() => {
  //   setCurrentPage(1);
  // }, [typeFilter, createdFilter]);

  return (
    <div>
      {/* Filter Controls */}
      <div className="flex justify-between items-center space-x-4 p-4 bg-white dark:bg-muted/10 border-b">
        {/* Grouping filters */}
        <div className="flex space-x-4 items-end">
        {/* Type Filter */}
        <div>
          <label htmlFor="type-filter" className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Type</label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger id="type-filter" className="w-[150px]">
              <SelectValue placeholder="Filter by type..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="api">API</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* Created Filter */}
        <div>
          <label htmlFor="created-filter" className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Created</label>
           <Select value={createdFilter} onValueChange={setCreatedFilter}>
            <SelectTrigger id="created-filter" className="w-[180px]">
              <SelectValue placeholder="Filter by date..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="7">Last 7 Days</SelectItem>
              <SelectItem value="30">Last 30 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        </div>
        
        {/* New Transcription Button */}
        <Button onClick={() => router.push('/transcribe')}>
          <PlusCircle className="mr-2 h-4 w-4" />
          New Transcription
        </Button>
      </div>

      {/* Table Section */}
      <div className="rounded-md border-t-0 border bg-white dark:bg-muted/20 shadow-sm overflow-hidden">
        {filteredJobs.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job ID</TableHead>
                  <TableHead>Video</TableHead>
                  <TableHead>Quality</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Map over paginatedJobs */}
                {paginatedJobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-mono text-xs">{job.id}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm">
                      {/* Display full videoUrl as a link opening in a new tab */}
                      <a
                        href={job.videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                        title={job.videoUrl} // Show full URL on hover
                      >
                        {job.videoUrl}
                      </a>
                    </TableCell>
                    <TableCell className="capitalize text-sm">
                      {job.quality === 'caption_first' ? 'Caption First' : job.quality}
                    </TableCell>
                    <TableCell className="text-sm">
                      {job.origin === 'INTERNAL' ? 'Normal' : job.origin === 'EXTERNAL' ? 'API' : job.origin}
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant={getStatusBadgeVariant(job.status)}
                        className="capitalize text-xs px-2 py-0.5"
                      >
                        {/* Modify displayed status text */}
                        {job.status === "pending_credit_deduction"
                          ? "Processing"
                          : job.status === "failed_insufficient_credits"
                          ? "Failed"
                          : job.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{formatDistanceToNow(job.createdAt, { addSuffix: true })}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onViewDetails(job.id)}
                      >
                        View Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Pagination Controls - Render only if more than one page */}
            {totalPages > 1 && (
              <div className="flex items-center justify-end space-x-2 p-4 border-t bg-white dark:bg-muted/10">
                <span className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePreviousPage}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="h-12 w-12 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center mb-4">
              <FileText className="h-6 w-6 text-gray-400 dark:text-gray-500" />
            </div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100">No matching jobs found</h3>
            <p className="text-gray-500 dark:text-gray-400 mt-1 mb-4">
              Try adjusting your filters or submit a new transcription.
            </p>
            <Button onClick={() => router.push('/transcribe')}>
              Submit New Transcription
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default JobsList;
