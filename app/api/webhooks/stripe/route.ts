import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { eq, SQL } from 'drizzle-orm';

// Initialize Stripe SDK (ensure SECRET_KEY is set)
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY environment variable is not set.');
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-04-30.basil', 
  typescript: true,
});

// Define mapping from Stripe Price ID to your internal tier names
// IMPORTANT: Replace these with your ACTUAL Price IDs from Stripe!
// Use consistent, simple tier names matching the enum and allowance map
const priceIdToTierMap: Record<string, 'starter' | 'pro'> = {
    ['price_1RLQvnGfOoM93d2Zr7tHC6XT']: 'starter',
    ['price_1RLQwZGfOoM93d2ZfVCxr1ic']: 'pro',
    // Add other price IDs if necessary (e.g., annual plans)
};

// --- Define Credit Allowances (Read from Environment Variables) ---

// Helper function to read and validate numeric env var
function getNumericEnvVar(varName: string): number {
    const value = process.env[varName];
    if (value === undefined || value === null || value.trim() === '') {
        throw new Error(`Required environment variable ${varName} is not set.`);
    }
    const numericValue = parseInt(value, 10);
    if (isNaN(numericValue)) {
        throw new Error(`Environment variable ${varName} is not a valid number: ${value}`);
    }
    return numericValue;
}

// Read allowances from .env and construct the map
let tierCreditAllowance: Record<'free' | 'starter' | 'pro', number>;
try {
    tierCreditAllowance = {
        free: getNumericEnvVar('CREDITS_FREE'),
        starter: getNumericEnvVar('CREDITS_STARTER'),
        pro: getNumericEnvVar('CREDITS_PRO'),
    };
    console.log('Loaded Credit Allowances:', tierCreditAllowance);
} catch (error) {
    console.error("Failed to load credit allowances from environment variables:", error);
    // Optional: Fallback to defaults if error handling is preferred over throwing
    // tierCreditAllowance = { free: 0, starter: 1000, pro: 5000 }; 
    // console.warn('Using default credit allowances due to error.');
    // For safety, re-throw the error during startup/initialization
    throw error;
}

export async function POST(req: Request) {
  const body = await req.text();
  const signature = headers().get('stripe-signature') as string;

  // Get webhook secret from environment variables
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!endpointSecret) {
    console.error('STRIPE_WEBHOOK_SECRET environment variable is not set.');
    return new NextResponse('Webhook secret not configured', { status: 500 });
  }

  let event: Stripe.Event;

  // Verify webhook signature
  try {
    event = stripe.webhooks.constructEvent(body, signature, endpointSecret);
    console.log(`Webhook received: ${event.type}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Webhook signature verification failed: ${message}`);
    return new NextResponse(`Webhook Error: ${message}`, { status: 400 });
  }

  // Handle the specific event types
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log('Handling checkout.session.completed', session.id);

      // Check for required metadata and subscription/invoice data
      if (!session?.metadata?.userId || !session.subscription || !session.invoice || !session.customer) {
        console.error('Missing required data (userId, subscription, invoice, customer) in checkout session', {
            userId: !!session?.metadata?.userId,
            subscription: !!session.subscription,
            invoice: !!session.invoice,
            customer: !!session.customer,
        });
        return new NextResponse('Webhook Error: Missing metadata or linking IDs', { status: 400 });
      }

      const userId = session.metadata.userId;
      const stripeSubscriptionId = session.subscription as string;
      const stripeCustomerId = session.customer as string;
      const invoiceId = session.invoice as string; // Keep for fallback

      // Declare variables outside the try block
      let subscription: Stripe.Subscription | null = null;
      let stripePriceId: string | null = null;
      let currentPeriodEnd: Date | null = null;
      let newTier: 'starter' | 'pro' | null = null;
      let initialCredits: number | null = null;

      try {
        // Attempt 1: Retrieve the Subscription object first
        subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);

        // --- Get Price ID from Subscription Item ---
        stripePriceId = subscription.items?.data[0]?.price?.id ?? null;
        if (!stripePriceId) {
          throw new Error(`Subscription ${stripeSubscriptionId} is missing Price ID in items.`);
        }

        // --- Determine Tier & Credits (needs Price ID) ---
        newTier = priceIdToTierMap[stripePriceId];
        if (!newTier) {
            throw new Error(`Unrecognized Price ID ${stripePriceId} found on subscription ${stripeSubscriptionId}`);
        }
        initialCredits = tierCreditAllowance[newTier];
        if (typeof initialCredits !== 'number') {
             throw new Error(`Invalid credit allowance configuration for tier ${newTier}`);
        }

        // --- Attempt to get Timestamp --- 
        let periodEndTs: number | undefined | null = null;
        let source = "";

        // 1. Try Subscription Item (Primary)
        periodEndTs = subscription.items?.data[0]?.current_period_end;
        if (typeof periodEndTs === 'number') {
            source = "Subscription Item";
            currentPeriodEnd = new Date(periodEndTs * 1000);
        } else {
            // 2. Try Top-Level Subscription (Fallback 1)
            console.warn(`Timestamp missing on sub item ${stripeSubscriptionId}. Trying top-level...`);
            // @ts-expect-error - Type definitions might be inaccurate
            periodEndTs = subscription.current_period_end;
            if (typeof periodEndTs === 'number') {
                 source = "Subscription Top-Level";
                 currentPeriodEnd = new Date(periodEndTs * 1000);
            } else {
                 // 3. Try Invoice (Fallback 2)
                 console.warn(`Timestamp missing on top-level sub ${stripeSubscriptionId}. Trying invoice ${invoiceId}...`);
                 const invoice = await stripe.invoices.retrieve(invoiceId);
                 periodEndTs = invoice.period_end;
                 if (typeof periodEndTs === 'number') {
                     source = "Invoice Fallback";
                     currentPeriodEnd = new Date(periodEndTs * 1000);
                 } else {
                     // Error: All sources failed
                     throw new Error(`Failed to get period end timestamp from Sub Item, Sub Top-Level, and Invoice ${invoiceId} for sub ${stripeSubscriptionId}.`);
                 }
            }
        }
        
        console.log(`Using current_period_end from ${source}: ${currentPeriodEnd}`);

        // --- Update DB ---
        console.log(`Updating user ${userId} via subscription ${stripeSubscriptionId} to tier ${newTier} with ${initialCredits} credits.`);
        await db.update(users)
          .set({
            subscriptionTier: newTier,
            stripeSubscriptionId: stripeSubscriptionId, // Use ID from session/subscription
            stripeCustomerId: stripeCustomerId, // Use ID from session
            stripePriceId: stripePriceId, // Use ID from subscription item
            stripeCurrentPeriodEnd: currentPeriodEnd, // Use timestamp obtained from sub or invoice
            credits: initialCredits,
          })
          .where(eq(users.id, userId));

        console.log(`User ${userId} updated successfully via checkout session.`);

      } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Unknown DB error";
          // Declare and assign currentPeriodEndTs for logging only if currentPeriodEnd exists
          const currentPeriodEndTs = currentPeriodEnd ? Math.floor(currentPeriodEnd.getTime() / 1000) : null;
          console.error(`Error handling checkout.session.completed for user ${userId}:`, message, { userId, newTier, initialCredits, stripeSubscriptionId, stripeCustomerId, stripePriceId, currentPeriodEndTs, currentPeriodEnd, invoiceId });
          return new NextResponse(`Webhook DB Error: ${message}`, { status: 500 });
      }
      break;
    }

    case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        console.log('Handling invoice.payment_succeeded', invoice.id);

        if (invoice.billing_reason === 'subscription_cycle') {
            // @ts-expect-error - Type definitions might incorrectly state invoice.subscription always exists
            const stripeSubscriptionId = invoice.subscription as string | null;
            const stripeCustomerId = invoice.customer as string | null;

            let userSubscriptionId: string | null = null;
            let updateWhereClause: SQL | undefined = undefined;
            let userIdForUpdate: string | null = null;

            try {
                // Path 1: Subscription ID is directly available on the invoice
                if (typeof stripeSubscriptionId === 'string') {
                    console.log(`Found subscription ID ${stripeSubscriptionId} directly on invoice ${invoice.id}.`);
                    userSubscriptionId = stripeSubscriptionId;
                    updateWhereClause = eq(users.stripeSubscriptionId, userSubscriptionId);
                }
                // Path 2: Fallback using Customer ID to find the user and their subscription ID
                else if (typeof stripeCustomerId === 'string') {
                    console.warn(`Subscription ID missing on invoice ${invoice.id}. Falling back to customer ID ${stripeCustomerId}.`);
                    const userResult = await db.select({
                        id: users.id,
                        stripeSubscriptionId: users.stripeSubscriptionId
                    }).from(users)
                      .where(eq(users.stripeCustomerId, stripeCustomerId))
                      .limit(1);
                    
                    const user = userResult[0];
                    if (user && user.stripeSubscriptionId) {
                         console.log(`Found user ${user.id} and their subscription ID ${user.stripeSubscriptionId} via customer ID.`);
                         userSubscriptionId = user.stripeSubscriptionId;
                         userIdForUpdate = user.id;
                         updateWhereClause = eq(users.id, userIdForUpdate);
                    } else {
                        // User not found or doesn't have a subscription ID in DB. Cannot proceed.
                        console.error(`Failed fallback: User not found or missing subscription ID for customer ${stripeCustomerId}.`);
                        // Return 200 to prevent Stripe retries for this specific issue.
                        return NextResponse.json({ error: "User/Subscription linkage not found via customer ID" }, { status: 200 });
                    }
                } else {
                    // Critical: Neither subscription nor customer ID found on the invoice.
                    throw new Error(`Invoice ${invoice.id} missing both subscription and customer IDs.`);
                }

                // If we successfully found a subscription ID (either directly or via fallback)
                if (!userSubscriptionId || !updateWhereClause) { 
                     throw new Error("Logic error: Could not determine subscription ID or update clause.");
                }

                // --- Fetch Subscription & Update User (Common logic) ---
                const subscription = await stripe.subscriptions.retrieve(userSubscriptionId);
                const stripePriceId = subscription.items?.data[0]?.price?.id;
                const currentPeriodEndTs = subscription.items?.data[0]?.current_period_end;

                if (!stripePriceId || typeof currentPeriodEndTs !== 'number') {
                    throw new Error(`Subscription ${userSubscriptionId} price ID or current_period_end missing/invalid during renewal.`);
                }

                const currentPeriodEnd = new Date(currentPeriodEndTs * 1000);
                const newTier = priceIdToTierMap[stripePriceId];
                if (!newTier) {
                    throw new Error(`Unrecognized Price ID ${stripePriceId} during renewal for subscription ${userSubscriptionId}.`);
                }
                const refillCredits = tierCreditAllowance[newTier];
                if (typeof refillCredits !== 'number') {
                    throw new Error(`Invalid credit allowance configuration for tier ${newTier} during renewal.`);
                }

                console.log(`PRE-DB UPDATE (invoice.payment_succeeded): UserID=${userIdForUpdate ?? 'N/A'}, SubID=${userSubscriptionId}, Setting stripeCurrentPeriodEnd=${currentPeriodEnd?.toISOString()}, Setting credits=${refillCredits}`);
                await db.update(users)
                   .set({
                       stripeCurrentPeriodEnd: currentPeriodEnd,
                       credits: refillCredits,
                       subscriptionCancelledAtPeriodEnd: false,
                   })
                   .where(updateWhereClause);

                console.log(`Subscription ${userSubscriptionId} renewed successfully. Credits refilled.`);

            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : "Unknown DB error";
                // Log context, including which ID was attempted
                console.error(`Error handling invoice.payment_succeeded renewal for invoice ${invoice.id}:`, message, { triedSubscriptionId: stripeSubscriptionId, triedCustomerId: stripeCustomerId, determinedUserSubscriptionId: userSubscriptionId });
                 return new NextResponse(`Webhook DB Error: ${message}`, { status: 500 });
            }
        } else {
            // Log why we are skipping this event (not a subscription cycle renewal)
            console.log(`Ignoring invoice.payment_succeeded for invoice ${invoice.id}. Reason: billing_reason is ${invoice.billing_reason ?? 'not subscription_cycle'}.`);
        }
        break;
    }

    case 'customer.subscription.deleted':
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const subscriptionId = subscription.id;
      console.log(`Handling ${event.type} for subscription ${subscriptionId}`);

      try {
          // Fetch the user associated with this subscription ID
          const userResult = await db.select({
              id: users.id,
              stripePriceId: users.stripePriceId, // Get current price ID from DB
              // Add other fields if needed for logging or checks
          }).from(users)
            .where(eq(users.stripeSubscriptionId, subscriptionId))
            .limit(1);
          
          const user = userResult[0];
          if (!user) {
              // If we don't find a user, maybe the subscription belongs to someone else or was deleted?
              // Log an error but return 200 to Stripe to prevent retries for this specific issue.
              console.error(`Webhook Error: User not found for subscription ID: ${subscriptionId}`);
              return NextResponse.json({ error: "User not found for subscription" }, { status: 200 });
          }

          const userId = user.id;
          const currentDbPriceId = user.stripePriceId;
          const eventPriceId = subscription.items?.data[0]?.price?.id ?? null;

          // Attempt to get period end from the FIRST item in the event data (Primary location)
          const eventItemPeriodEndTs = subscription.items?.data[0]?.current_period_end;
          let eventPeriodEnd = typeof eventItemPeriodEndTs === 'number' ? new Date(eventItemPeriodEndTs * 1000) : null;

          const isCancelledAtPeriodEnd = subscription.cancel_at_period_end;
          const isActiveStatus = ['active', 'trialing'].includes(subscription.status);
          const isEndedStatus = ['canceled', 'incomplete_expired'].includes(subscription.status) || event.type === 'customer.subscription.deleted';

          // Scenario 1: Definitive End (Cancellation / Deletion)
          if (isEndedStatus) {
              console.log(`Subscription ${subscriptionId} ended (Status: ${subscription.status}, Event: ${event.type}). Downgrading user ${userId}.`);
              await db.update(users)
                  .set({
                      subscriptionTier: 'free',
                      stripeSubscriptionId: null,
                      stripePriceId: null,
                      stripeCurrentPeriodEnd: null,
                      credits: tierCreditAllowance.free,
                      subscriptionCancelledAtPeriodEnd: false, // Reset this flag on downgrade
                  })
                  .where(eq(users.id, userId)); // Use user ID for update
              console.log(`User ${userId} downgraded successfully for ended subscription ${subscriptionId}.`);
          
          // Scenario 2: Plan Change (via Portal/API) - Price ID differs, still active
          } else if (isActiveStatus && eventPriceId && eventPriceId !== currentDbPriceId) {
              const newTier = priceIdToTierMap[eventPriceId];
              if (!newTier) {
                  throw new Error(`Unrecognized Price ID ${eventPriceId} during subscription update for user ${userId}.`);
              }
              const newCredits = tierCreditAllowance[newTier];
              if (typeof newCredits !== 'number') {
                   throw new Error(`Invalid credit allowance for new tier ${newTier} during update.`);
              }

              // If period end is missing in event item, refetch the subscription
              if (!eventPeriodEnd) {
                  console.warn(`Subscription item ${subscriptionId} event data missing current_period_end. Refetching...`);
                  const freshSubscription = await stripe.subscriptions.retrieve(subscriptionId);
                  console.log("Refetched Subscription Object:", JSON.stringify(freshSubscription, null, 2)); 
                   // Attempt to get period end from the FIRST item in the refetched data
                   const freshItemPeriodEndTs = freshSubscription.items?.data[0]?.current_period_end;
                   eventPeriodEnd = typeof freshItemPeriodEndTs === 'number' ? new Date(freshItemPeriodEndTs * 1000) : null;
              }

              // If still missing after refetch, throw error
              if (!eventPeriodEnd) {
                  throw new Error(`Missing current_period_end timestamp during subscription update (even after refetch) for user ${userId}.`);
              }
              
              console.log(`PRE-DB UPDATE (customer.subscription.updated - Plan Change): UserID=${userId}, SubID=${subscriptionId}, Setting stripeCurrentPeriodEnd=${eventPeriodEnd?.toISOString()}, Setting credits=${newCredits}`);
              await db.update(users)
                  .set({
                      subscriptionTier: newTier,
                      stripePriceId: eventPriceId,
                      credits: newCredits,
                      stripeCurrentPeriodEnd: eventPeriodEnd,
                      subscriptionCancelledAtPeriodEnd: false,
                  })
                  .where(eq(users.id, userId));
              console.log(`User ${userId} plan updated successfully for subscription ${subscriptionId}.`);

          // Scenario 3: Marked for Cancellation (but still active)
          } else if (isActiveStatus && isCancelledAtPeriodEnd) {
               // Get period end for logging/display - Try event item first, then refetch if needed
               let periodEndForLogTs = subscription.items?.data[0]?.current_period_end;
               let periodEndForLog = typeof periodEndForLogTs === 'number' ? new Date(periodEndForLogTs * 1000) : null;
               if (!periodEndForLog) {
                   try {
                       const freshSub = await stripe.subscriptions.retrieve(subscriptionId);
                       periodEndForLogTs = freshSub.items?.data[0]?.current_period_end;
                       periodEndForLog = typeof periodEndForLogTs === 'number' ? new Date(periodEndForLogTs * 1000) : null;
                   } catch (fetchErr) {
                        console.error(`Failed to refetch subscription ${subscriptionId} for cancellation logging`, fetchErr);
                   }
               }
               console.log(`Subscription ${subscriptionId} for user ${userId} updated. Marked to cancel at period end: ${periodEndForLog}`);
               await db.update(users)
                   .set({ subscriptionCancelledAtPeriodEnd: true })
                   .where(eq(users.id, userId));
               console.log(`User ${userId} marked for cancellation at period end.`);
          
          // Scenario 4: Reactivated (cancel_at_period_end removed)
          } else if (isActiveStatus && !isCancelledAtPeriodEnd) {
              console.log(`Subscription ${subscriptionId} for user ${userId} updated. Reactivated or no cancellation pending.`);
              // Ensure the flag is false if the subscription is active and not marked for cancellation
              await db.update(users)
                  .set({ subscriptionCancelledAtPeriodEnd: false })
                  .where(eq(users.id, userId));
              console.log(`User ${userId} cancellation flag reset.`);
          }

          // Add more specific logging for unhandled active updates if needed
          else if (isActiveStatus) {
               console.log(`Subscription ${subscriptionId} updated for user ${userId}. Status: ${subscription.status}. No relevant change detected (Price ID same, not marked for cancellation).`);
          }
          // Log other statuses if necessary
          else {
                console.log(`Subscription ${subscriptionId} updated for user ${userId}. Status: ${subscription.status}. No specific action taken.`);
          }

      } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown DB error";
            // Add subscription ID to context if available
            console.error(`Error handling ${event.type} for subscription ${subscriptionId}:`, message);
            // Restore the correct return statement
            return new NextResponse(`Webhook DB Error: ${message}`, { status: 500 });
      }
      break;
    }

    default:
      console.log(`Unhandled webhook event type: ${event.type}`);
  }

  // Return a 200 response to acknowledge receipt of the event
  return NextResponse.json({ received: true });
}