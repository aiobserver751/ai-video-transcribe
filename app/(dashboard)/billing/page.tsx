'use client';

import React, { useState } from 'react';
import { useUserProfile } from "@/context/UserProfileContext"; // Using context for simplicity here
import { createCheckoutSession, createBillingPortalSession } from "@/app/actions/billingActions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, CheckCircle, Crown, Zap } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { format } from 'date-fns';

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
        features: ["Standard quality transcriptions", "5-10 Credits daily"],
        tier: 'free',
    },
    {
        name: "Starter Plan",
        priceId: 'price_1RLQvnGfOoM93d2Zr7tHC6XT', // <-- REPLACE THIS
        priceMonthly: 9.99, // Example price
        features: ["1000 Credits monthly", "Standard + Premium quality"],
        tier: 'starter',
    },
    {
        name: "Pro Plan",
        priceId: 'price_1RLQwZGfOoM93d2ZfVCxr1ic', // <-- REPLACE THIS
        priceMonthly: 19.99, // Example price
        features: ["5000 Credits monthly", "Standard + Premium quality", "AI Summaries"],
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
            toast.error("Checkout Error", { description: error });
        } else if (url) {
            window.location.href = url; // Redirect to Stripe
            return; // Keep loading active
        } else {
             toast.error("Checkout Error", { description: "Could not retrieve checkout URL." });
        }
         setIsLoadingAction(null); // Reset loading state only on error or no URL
    };

    // Redirect user to Stripe Billing Portal
    const handleManageBilling = async (actionType: 'manage' | 'downgrade' /* | 'upgrade' - Removing upgrade */) => {
        // Ensure actionType is only manage or downgrade if needed, or simplify if only 'manage' is used now
        setIsLoadingAction(actionType); 
        const { url, error } = await createBillingPortalSession();
        if (error) {
            toast.error("Billing Portal Error", { description: error });
        } else if (url) {
            window.location.href = url; // Redirect to Stripe
             // Keep loading active as we navigate away
             return; // Prevent resetting loading state immediately
        } else {
            toast.error("Billing Portal Error", { description: "Could not retrieve portal URL." });
        }
        setIsLoadingAction(null); // Reset loading state only on error or no URL
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

            <Card>
                <CardHeader>
                    <CardTitle>Current Plan</CardTitle>
                    <CardDescription>
                        You are currently on the <span className="font-semibold">{capitalizeFirstLetter(currentTier)}</span> plan.
                    </CardDescription>
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