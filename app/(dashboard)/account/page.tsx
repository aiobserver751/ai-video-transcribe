'use client';

import React from 'react';
import { useUserProfile } from "@/context/UserProfileContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
// import { redirect } from 'next/navigation'; // Remove unused import
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
// import { getUserProfile } from "@/app/actions/userActions";

// Helper function to capitalize first letter
function capitalizeFirstLetter(string: string | null | undefined) {
  if (!string) return 'N/A';
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// Convert to standard functional component, remove async
export default function AccountPage() {
  // Fetch profile using the hook
  const { profile, isLoading, error } = useUserProfile();

  // Handle Loading State
  if (isLoading) {
    return <div className="p-6 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /> Loading account...</div>;
  }

  // Handle Error State
  if (error) {
     return (
        <div className="p-6">
            <Alert variant="destructive">
                <AlertTitle>Error Loading Profile</AlertTitle>
                <AlertDescription>{error.message}</AlertDescription>
            </Alert>
        </div>
        );
  }

  // Handle No Profile State (User might not be logged in properly, context handles this)
  if (!profile) {
    return (
        <div className="p-6">
          <Alert variant="default">
              <AlertTitle>No Profile Found</AlertTitle>
              <AlertDescription>Could not load user profile. Please try logging in again.</AlertDescription>
          </Alert>
        </div>
      );
  }

  // Calculate initials for fallback
  const initials = profile.name
    ? profile.name.split(' ').map((n: string) => n[0]).join('').toUpperCase()
    : profile.email?.[0].toUpperCase() ?? 'U';

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Account Information</h1>

      {/* Alert for pending cancellation */}            
      {profile.subscriptionCancelledAtPeriodEnd && profile.stripeCurrentPeriodEnd && (
          <Alert variant="destructive">
              <AlertTitle>Subscription Cancellation Pending</AlertTitle>
              <AlertDescription>
                  Your <span className="font-semibold">{capitalizeFirstLetter(profile.subscriptionTier)}</span> plan is scheduled to cancel on <span className="font-semibold">{format(new Date(profile.stripeCurrentPeriodEnd), 'PPP')}</span>. 
                  You will retain access until this date.
              </AlertDescription>
          </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-4">
              <Avatar className="h-16 w-16 text-lg">
                  {profile.image && <AvatarImage src={profile.image} alt={profile.name ?? 'User Avatar'} />}
                  <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div>
                  <CardTitle>{profile.name ?? 'User'}</CardTitle>
                  <CardDescription>{profile.email}</CardDescription>
              </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
            <div className="grid grid-cols-3 items-center gap-x-4 gap-y-2">
                <Label className="text-right font-semibold text-muted-foreground">Account Type</Label>
                <span className="col-span-2 text-sm">{capitalizeFirstLetter(profile.type)}</span>
                
                <Label className="text-right font-semibold text-muted-foreground">Name</Label>
                <span className="col-span-2 text-sm">{profile.name ?? <span className="italic text-muted-foreground">Not set</span>}</span>

                <Label className="text-right font-semibold text-muted-foreground">Email</Label>
                <span className="col-span-2 text-sm">{profile.email}</span>
                
                <Label className="text-right font-semibold text-muted-foreground">Subscription Plan</Label>
                <span className="col-span-2 text-sm font-medium">{capitalizeFirstLetter(profile.subscriptionTier)}</span>

                <Label className="text-right font-semibold text-muted-foreground">Credits Remaining</Label>
                <span className="col-span-2 text-sm">{profile.credit_balance ?? 0}</span>
                
                {/* Conditionally show password placeholder */} 
                {profile.type === 'normal' && (
                   <>
                    <Label className="text-right font-semibold text-muted-foreground">Password</Label>
                    <span className="col-span-2 text-sm font-mono">**********</span> {/* Placeholder */}
                   </>
                )}
            </div>
        </CardContent>
      </Card>
      {/* Add Edit button/link later if needed */}
    </div>
  );
} 