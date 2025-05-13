'use server';

import { getServerSession } from "next-auth/next";
import Stripe from "stripe";
import { authConfig } from "@/auth.config";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";

// Initialize Stripe
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY environment variable is not set.');
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-04-30.basil', // Use the exact version expected by types
  typescript: true,
});

// Ensure App URL is set for redirects
if (!process.env.NEXT_PUBLIC_APP_URL) {
  throw new Error('NEXT_PUBLIC_APP_URL environment variable is not set.');
}
const appUrl = process.env.NEXT_PUBLIC_APP_URL;

/**
 * Creates a Stripe Checkout Session for subscribing to a specific price ID.
 * @param priceId The ID of the Stripe Price object.
 * @returns Object containing the session URL or an error message.
 */
export async function createCheckoutSession(priceId: string): Promise<{ url: string | null; error: string | null }> {
  const session = await getServerSession(authConfig);
  if (!session?.user?.id) {
    return { url: null, error: "User not authenticated." };
  }
  const userId = session.user.id;

  try {
    // Fetch user data including Stripe Customer ID AND current Subscription ID
    const userResult = await db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      stripeCustomerId: users.stripeCustomerId,
      stripeSubscriptionId: users.stripeSubscriptionId, // <-- Fetch existing subscription ID
    })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const user = userResult[0];
    if (!user) {
      return { url: null, error: "User not found." };
    }

    let customerId = user.stripeCustomerId;
    const currentSubscriptionId = user.stripeSubscriptionId;

    // Create a Stripe Customer if one doesn't exist
    if (!customerId) {
      console.log(`Creating Stripe Customer for user ${userId}`);
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name ?? undefined, // Optional: Pass user's name
        metadata: {
          userId: userId,
        },
      });
      customerId = customer.id;
      await db.update(users)
              .set({ stripeCustomerId: customerId })
              .where(eq(users.id, userId));
      console.log(`Stripe Customer ${customerId} created and linked to user ${userId}`);
    }

    // Initialize base parameters for the checkout session
    let checkoutSessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      mode: 'subscription',
      success_url: `${appUrl}/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/billing`,
      metadata: {
        userId: userId,
      },
    };

    // If user has an existing subscription, set it up for update
    if (currentSubscriptionId) {
        console.log(`User ${userId} has existing subscription ${currentSubscriptionId}. Setting up for update.`);
        const subscription = await stripe.subscriptions.retrieve(currentSubscriptionId);
        const currentItemId = subscription.items.data[0]?.id;

        if (!currentItemId) {
             console.error(`Subscription ${currentSubscriptionId} found but has no items. Cannot update.`);
             return { url: null, error: "Could not find item to update on existing subscription." };
        }

        // Use the correct parameters for subscription updates
        checkoutSessionParams = {
             ...checkoutSessionParams,
             line_items: [
                 {
                     price: priceId,
                     quantity: 1,
                 }
             ],
             subscription_data: {
                 proration_behavior: 'create_prorations',
                 metadata: {
                     previous_subscription_id: currentSubscriptionId
                 }
             }
        };

    } else {
         // If no subscription, set up line_items for a new subscription
         console.log(`User ${userId} has no existing subscription. Creating a new one.`);
         checkoutSessionParams = {
             ...checkoutSessionParams,
             line_items: [
                 {
                   price: priceId,
                   quantity: 1,
                 },
             ],
             subscription_data: {
                 metadata: {
                     user_id: userId
                 }
             }
         };
    }

    // Create the Stripe Checkout Session using the constructed params
    console.log(`Creating Checkout session for user ${userId}. Mode: ${currentSubscriptionId ? 'update' : 'new'}`);
    const checkoutSession = await stripe.checkout.sessions.create(checkoutSessionParams);

    if (!checkoutSession.url) {
       return { url: null, error: "Could not create Stripe Checkout session." };
    }

    console.log(`Checkout session created: ${checkoutSession.id}`);
    return { url: checkoutSession.url, error: null };

  } catch (error: unknown) {
    console.error("Error creating Stripe Checkout session:", error);
    const message = error instanceof Error ? error.message : "An unknown error occurred.";
    return { url: null, error: `Stripe Error: ${message}` };
  }
}

/**
 * Creates a Stripe Billing Portal Session for the user to manage their subscription.
 * @returns Object containing the portal session URL or an error message.
 */
export async function createBillingPortalSession(): Promise<{ url: string | null; error: string | null }> {
  const session = await getServerSession(authConfig);
  if (!session?.user?.id) {
    return { url: null, error: "User not authenticated." };
  }

  try {
    // Fetch the user's Stripe Customer ID
    const userResult = await db.select({ stripeCustomerId: users.stripeCustomerId })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    
    const user = userResult[0];
    if (!user?.stripeCustomerId) {
      return { url: null, error: "Stripe customer ID not found for this user." };
    }

    // Create the Billing Portal Session
    console.log(`Creating Billing Portal session for customer ${user.stripeCustomerId}`);
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${appUrl}/billing`, // Where to redirect after portal usage
    });

    console.log(`Billing Portal session created: ${portalSession.id}`);
    return { url: portalSession.url, error: null };

  } catch (error: unknown) {
    console.error("Error creating Stripe Billing Portal session:", error);
    const message = error instanceof Error ? error.message : "An unknown error occurred.";
    return { url: null, error: `Stripe Error: ${message}` };
  }
} 