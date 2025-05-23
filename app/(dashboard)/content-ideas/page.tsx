'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { getContentIdeaJobsAction, type ContentIdeaJobForList } from '@/app/actions/contentIdeaActions';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Eye, Loader2, AlertCircle, Lightbulb, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Helper function to get badge variant based on job status
const getStatusBadgeVariant = (status: ContentIdeaJobForList['status']) => {
  switch (status) {
    case 'completed': return 'success';
    case 'failed':
    case 'failed_insufficient_credits': 
      return 'destructive';
    case 'processing': return 'secondary';
    case 'pending':
    case 'pending_credit_deduction':
    default: return 'outline';
  }
};

export default function ContentIdeasListPage() {
  const {
    data: queryResult,
    isLoading,
    error,
    refetch,
    isRefetching, // Added for better loading indication on refetch
  } = useQuery<
    { success: boolean; jobs?: ContentIdeaJobForList[]; error?: string },
    Error
  >({
    queryKey: ['contentIdeaJobs'],
    queryFn: async () => {
      const result = await getContentIdeaJobsAction();
      if (!result.success && result.error) {
        throw new Error(result.error);
      }
      return result;
    },
    refetchInterval: (query) => {
        // Check if any job is still processing or pending
        const jobs = query.state.data?.jobs;
        const hasActiveJobs = jobs?.some(job => job.status === 'processing' || job.status === 'pending' || job.status === 'pending_credit_deduction');
        return hasActiveJobs ? 5000 : false; // Poll every 5s if active jobs, else stop
    }
  });

  const jobs = queryResult?.jobs || [];

  return (
    <div className="container mx-auto py-8 px-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center">
              <Lightbulb className="mr-2 h-6 w-6" /> Content Idea Jobs
            </CardTitle>
            <CardDescription>
              View and manage your generated content ideas.
            </CardDescription>
          </div>
          <Button onClick={() => refetch()} disabled={isRefetching || isLoading} size="sm" variant="outline">
            {isRefetching || isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading && !isRefetching && (
            <div className="flex justify-center items-center py-10">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
          )}
          {error && (
            <div className="text-center py-10">
              <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
              <p className="mt-4 text-destructive">
                Error fetching content idea jobs: {error.message}
              </p>
              {queryResult?.error && <p className="text-sm text-muted-foreground">Server: {queryResult.error}</p>}
              <Button onClick={() => refetch()} className="mt-4" variant="outline">Try Again</Button>
            </div>
          )}
          {!isLoading && !error && jobs.length === 0 && (
            <div className="text-center py-10">
              <Lightbulb className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-muted-foreground">No content idea jobs found yet.</p>
              <p className="text-sm text-muted-foreground">
                Generate ideas from your completed transcriptions to see them here.
              </p>
              <Button asChild className="mt-4">
                <Link href="/jobs">View Transcriptions</Link>
              </Button>
            </div>
          )}
          {!isLoading && !error && jobs.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job ID</TableHead>
                  <TableHead>Parent Video</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-medium truncate max-w-xs">
                      <Link href={`/content-ideas/${job.id}`} className="hover:underline">
                        {job.id}
                      </Link>
                    </TableCell>
                    <TableCell className="truncate max-w-xs">
                      {job.parentVideoUrl ? (
                        <a href={job.parentVideoUrl} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center">
                          {job.parentVideoUrl.length > 40 ? `${job.parentVideoUrl.substring(0, 37)}...` : job.parentVideoUrl}
                          <ExternalLink className="ml-1 h-3 w-3" />
                        </a>
                      ) : (
                        'N/A'
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {job.jobType.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(job.status)} className="capitalize">
                        {job.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>{format(new Date(job.createdAt), "PPpp")}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/content-ideas/${job.id}`}>
                          <Eye className="mr-1 h-4 w-4" /> View
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 