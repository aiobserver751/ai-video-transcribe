'use client';

import React, { useState } from 'react';
import { useUserProfile } from "@/context/UserProfileContext"; // Using context for simplicity here
import { createCheckoutSession, createBillingPortalSession } from "@/app/actions/billingActions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle, Crown, Zap } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { format } from 'date-fns';
import { displayToast } from "@/lib/toastUtils";

// Moved helper function here
function capitalizeFirstLetter(string: string | null | undefined) {
  if (!string) return 'N/A';
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// Define Plan details (replace Price IDs)
const plans = [
    {
        name: "Free Plan",
        priceId: null,
        priceMonthly: 0,
        features: [
            "50 credits to start + 10 credits every 3 days",
            "Up to ~1.5 hours of Standard transcription",
            "Up to 50 YouTube caption downloads (1 credit each)",
            "Plain text, VTT & SRT export formats",
            "Never expires - use at your own pace",
            "Basic video metadata",
            "72-hour support response time"
        ],
        tier: 'free',
    },
    {
        name: "Starter Plan",
        priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_STARTER || null,
        priceMonthly: 9.99,
        features: [
            "300 credits refreshed monthly",
            "Up to ~10 hours of Standard transcription",
            "OR up to ~5 hours of Premium transcription",
            "OR up to 300 YouTube caption downloads",
            "Basic & Extended summaries",
            "Content intelligence Hub",
            "Plain text, VTT & SRT export formats",
            "API access",
            "48-hour support response time"
        ],
        tier: 'starter',
    },
    {
        name: "Pro Plan",
        priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_PRO || null,
        priceMonthly: 19.99,
        features: [
            "750 credits refreshed monthly",
            "Up to ~25 hours of Standard transcription",
            "OR up to ~12.5 hours of Premium transcription",
            "OR up to 750 YouTube caption downloads",
            "Basic & Extended summaries",
            "Content intelligence Hub",      
            "Plain text & SRT export formats",
            "API access",
            "24-hour support response time"
        ],
        tier: 'pro',
    },
];

export default function BillingPage() {
    const { profile, isLoading: isLoadingProfile } = useUserProfile();
    const [isLoadingAction, setIsLoadingAction] = useState<string | null>(null); // Track loading state per button

    // Re-add handleUpgrade function
    const handleUpgrade = async (priceId: string | null, planTier: string) => {
        if (!priceId) return;
        setIsLoadingAction(planTier); // Set loading state for this specific plan button
        // NOTE: We might need to simplify createCheckoutSession if it still has update logic
        const { url, error } = await createCheckoutSession(priceId); 
        if (error) {
            // Server provides the error string for description
            displayToast("billingPage.checkoutError", "error", { error });
        } else if (url) {
            window.location.href = url; // Redirect to Stripe
            return; // Keep loading active
        } else {
             displayToast("billingPage.checkoutUrlError", "error");
        }
         setIsLoadingAction(null); // Reset loading state only on error or no URL
    };

    // Redirect user to Stripe Billing Portal
    const handleManageBilling = async (actionType: 'manage' | 'downgrade' /* | 'upgrade' - Removing upgrade */) => {
        // Ensure actionType is only manage or downgrade if needed, or simplify if only 'manage' is used now
        setIsLoadingAction(actionType); 
        const { url, error } = await createBillingPortalSession();
        if (error) {
            displayToast("billingPage.billingPortalError", "error", { error });
            setIsLoadingAction(null); // Reset loading state on error
        } else if (url) {
            window.open(url, '_blank'); // Open in new tab
            setIsLoadingAction(null); // Reset loading state after opening
            // No return here, as the original page remains active
        } else {
            displayToast("billingPage.billingPortalUrlError", "error");
            setIsLoadingAction(null); // Reset loading state on error
        }
        // setIsLoadingAction(null); // This line is now handled within the if/else blocks
    };

    // Display loading or current plan info
    const currentTier = profile?.subscriptionTier ?? 'free';

    // Handle profile loading state
    if (isLoadingProfile) {
        return <div className="p-6"><Loader2 className="animate-spin" /> Loading billing information...</div>;
    }

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">Billing & Plans</h1>
            
            {/* Alert for pending cancellation */}            
            {profile?.subscriptionCancelledAtPeriodEnd && profile.stripeCurrentPeriodEnd && (
                <Alert variant="destructive">
                    <AlertTitle>Subscription Cancellation Pending</AlertTitle>
                    <AlertDescription>
                        Your <span className="font-semibold">{capitalizeFirstLetter(profile.subscriptionTier)}</span> plan is scheduled to cancel on <span className="font-semibold">{format(new Date(profile.stripeCurrentPeriodEnd), 'PPP')}</span>. 
                        You will retain access until this date. You can reactivate your subscription via the manage billing button.
                    </AlertDescription>
                </Alert>
            )}

            <Card className="mb-6">
                <CardHeader>
                    <CardTitle>Current Plan</CardTitle>
                    <CardDescription>
                        You are currently on the <span className="font-semibold">{capitalizeFirstLetter(currentTier)}</span> plan.
                    </CardDescription>
                    {/* Add renewal date display for paid tiers */}
                    {(currentTier === 'starter' || currentTier === 'pro') && profile?.stripeCurrentPeriodEnd && !profile.subscriptionCancelledAtPeriodEnd && (
                        <CardDescription className="pt-1">
                            Your plan renews on <span className="font-semibold">{format(new Date(profile.stripeCurrentPeriodEnd), 'PPP')}</span>.
                        </CardDescription>
                    )}
                </CardHeader>
                {/* Show Manage button only if on a paid plan */}
                {currentTier !== 'free' && (
                    <CardFooter>
                         <Button
                             onClick={() => handleManageBilling('manage')}
                             disabled={isLoadingAction === 'manage'}
                         >
                             {isLoadingAction === 'manage' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                             Manage Billing & Subscription
                         </Button>
                    </CardFooter>
                 )}
            </Card>

            <h2 className="text-2xl font-semibold tracking-tight pt-4">Available Plans</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {plans.map((plan) => {
                    const isCurrentPlan = plan.tier === currentTier;
                    const isLoadingThisButton = isLoadingAction === plan.tier;

                    return (
                        <Card key={plan.name} className={`flex flex-col ${isCurrentPlan ? 'border-primary ring-2 ring-primary' : ''}`}>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    {plan.tier === 'starter' && <Zap className="h-5 w-5 text-yellow-500"/>}
                                    {plan.tier === 'pro' && <Crown className="h-5 w-5 text-purple-500"/>}
                                    {plan.name}
                                </CardTitle>
                                <CardDescription>
                                    {plan.priceMonthly > 0 ? `$${plan.priceMonthly} / month` : "Free forever"}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="flex-1">
                                <ul className="space-y-2 text-sm text-muted-foreground">
                                    {plan.features.map((feature, i) => (
                                        <li key={i} className="flex items-center gap-2">
                                            <CheckCircle className="h-4 w-4 text-green-500" />
                                            {feature}
                                        </li>
                                    ))}
                                </ul>
                            </CardContent>
                            {/* Add Footer with Upgrade button ONLY for non-free plans IF user is currently free */}
                            {currentTier === 'free' && plan.tier !== 'free' && (
                                <CardFooter>
                                    <Button
                                        className="w-full"
                                        onClick={() => handleUpgrade(plan.priceId, plan.tier)}
                                        disabled={!!isLoadingAction} // Disable if any action is loading
                                    >
                                        {isLoadingThisButton && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Upgrade
                                    </Button>
                                </CardFooter>
                            )}
                        </Card>
                    );
                })}
            </div>
        </div>
    );
} 