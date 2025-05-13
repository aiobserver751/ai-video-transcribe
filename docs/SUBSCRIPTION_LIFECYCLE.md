# Subscription Lifecycle Explained

This document outlines the different scenarios for user subscription changes (upgrades, downgrades, renewals, cancellations) and explains what happens within Stripe and the application database, including credit adjustments and the business rules applied.

**Key Database Fields:**

*   `subscriptionTier`: The user's *current* active subscription tier ('free', 'starter', 'pro').
*   `credit_balance`: The user's current credit balance.
*   `stripeSubscriptionId`: The ID of the active Stripe subscription.
*   `stripePriceId`: The ID of the Stripe Price associated with the current subscription.
*   `stripeCurrentPeriodEnd`: The date the current billing period ends.
*   `subscriptionCancelledAtPeriodEnd`: Boolean flag indicating if the subscription is set to cancel (not renew) at the period end.

**Credit System Basics:**

*   Credits are consumed by performing transcriptions.
*   Each paid tier ('starter', 'pro') has a defined credit allowance (e.g., `CREDITS_STARTER`, `CREDITS_PRO`) set in environment variables.
*   The 'free' tier has an initial allocation and potentially monthly refreshes (logic TBD/confirmed).
*   Renewals **reset** the credit balance to the tier's allowance.
*   Upgrades/Downgrades **reset** the credit balance to the *new* tier's allowance immediately.
*   Cancellations result in paid credits expiring at the period end, followed by granting initial free credits (if applicable).

**Core Webhook Events Handled:**

*   `checkout.session.completed`: Handles initial subscriptions and immediate upgrades done via Stripe Checkout.
*   `invoice.payment_succeeded`: Handles recurring subscription renewals.
*   `customer.subscription.updated`: Handles plan changes (upgrades/downgrades initiated via portal/API), cancellations scheduled/unscheduled, and reactivations.
*   `customer.subscription.deleted`: Handles the definitive end of a subscription.

---

## Subscription Scenarios

### 1. New Subscription (Free -> Starter/Pro)
*   **Trigger:** User completes Stripe Checkout for a paid plan.
*   **Stripe Action:** Creates a new `Subscription`, charges the user (if applicable), creates a `Customer`, sends `checkout.session.completed` webhook.
*   **Application Action (`checkout.session.completed` webhook):**
    *   Finds user via `userId` in metadata.
    *   Retrieves `Subscription` details (price ID, period end).
    *   Updates `users` table:
        *   `subscriptionTier` set to 'starter' or 'pro'.
        *   `stripeCustomerId`, `stripeSubscriptionId`, `stripePriceId`, `stripeCurrentPeriodEnd` populated.
    *   Credits are set to the allowance of the *new* tier (`CREDITS_STARTER` or `CREDITS_PRO`) via `performCreditTransaction` (using `paid_tier_renewal` type which resets the balance).
*   **Business Rule/User Experience:** User immediately gains access to the paid tier features and credits.

### 2. Upgrade (Starter -> Pro)
*   **Trigger:** User selects 'Pro' plan in Stripe Billing Portal.
*   **Stripe Action:** Updates the existing `Subscription`'s price ID, usually prorates and charges immediately, sends `customer.subscription.updated` webhook.
*   **Application Action (`customer.subscription.updated` webhook):**
    *   Finds user via `stripeSubscriptionId`.
    *   Detects `stripePriceId` has changed to the 'Pro' price ID.
    *   Updates `users` table:
        *   `subscriptionTier` set to 'pro'.
        *   `stripePriceId` updated.
        *   `stripeCurrentPeriodEnd` potentially updated.
    *   Credits are **reset** to the 'Pro' allowance (`CREDITS_PRO`) immediately via `performCreditTransaction` (using `paid_tier_renewal` type).
*   **Business Rule/User Experience:** User is charged immediately (prorated), gets access to 'Pro' features and the full 'Pro' credit allowance right away.

### 3. Downgrade (Pro -> Starter)
*   **Trigger:** User selects 'Starter' plan in Stripe Billing Portal.
*   **Stripe Action:** Updates the existing `Subscription`'s price ID. **Stripe handles proration automatically (crediting the user's account balance for future use, typically not refunding cash).** Sends `customer.subscription.updated` webhook.
*   **Application Action (`customer.subscription.updated` webhook):**
    *   Finds user via `stripeSubscriptionId`.
    *   Detects `stripePriceId` has changed to the 'Starter' price ID.
    *   Updates `users` table:
        *   `subscriptionTier` is set to `'starter'` **immediately**.
        *   `stripePriceId` updated.
        *   `stripeCurrentPeriodEnd` potentially updated.
    *   Credits are **reset** to the 'Starter' allowance (`CREDITS_STARTER`) **immediately** via `performCreditTransaction` (using `paid_tier_renewal` type).
*   **Business Rule/User Experience:** User's plan changes to 'Starter' immediately in the app, and their credit balance is reset to the 'Starter' allowance right away. Stripe handles any billing adjustments/proration credits on their end for future invoices.

### 4. Cancellation (Setting Subscription to Not Renew)
*   **Trigger:** User clicks "Cancel Subscription" in Stripe Billing Portal.
*   **Stripe Action:** Sets `cancel_at_period_end` to `true` on the `Subscription`, sends `customer.subscription.updated` webhook.
*   **Application Action (`customer.subscription.updated` webhook):**
    *   Finds user via `stripeSubscriptionId`.
    *   Detects `cancel_at_period_end` is `true`.
    *   Updates `users` table:
        *   Sets `subscriptionCancelledAtPeriodEnd` to `true`.
        *   Other subscription fields (`subscriptionTier`, `stripePriceId`, `stripeCurrentPeriodEnd`) remain unchanged for now.
    *   No immediate change to credits.
*   **Business Rule/User Experience:** User is notified in the UI that their subscription will cancel at the end of the current period. They retain full access and current credits until that date.

### 5. Subscription End (After Cancellation)
*   **Trigger:** Billing period ends for a subscription marked with `cancel_at_period_end = true`.
*   **Stripe Action:** Subscription status changes to `canceled` (or similar), sends `customer.subscription.deleted` or `customer.subscription.updated` (with `status: canceled`) webhook.
*   **Application Action (`customer.subscription.deleted` or `customer.subscription.updated` webhook):**
    *   Finds user via `stripeSubscriptionId`.
    *   Detects the ended status.
    *   Clears any remaining paid credits via `performCreditTransaction` (using `paid_credits_expired_on_cancellation`).
    *   Grants initial free credits (if applicable) via `performCreditTransaction` (using `initial_allocation`).
    *   Updates `users` table:
        *   `subscriptionTier` set to 'free'.
        *   `stripeSubscriptionId`, `stripePriceId`, `stripeCurrentPeriodEnd` set to `null`.
        *   `subscriptionCancelledAtPeriodEnd` set to `false`.
*   **Business Rule/User Experience:** User loses access to paid features, their paid credit balance is cleared, and they are moved to the 'free' tier, potentially receiving initial free credits.

### 6. Subscription Renewal (Starter/Pro)
*   **Trigger:** Automatic renewal at the end of a billing period for an active subscription.
*   **Stripe Action:** Charges the user, creates a new `Invoice`, sends `invoice.payment_succeeded` webhook.
*   **Application Action (`invoice.payment_succeeded` webhook):**
    *   Finds user via `stripeSubscriptionId` (or fallback via `customerId`).
    *   Retrieves the `Subscription` to confirm the tier and get the *new* `current_period_end`.
    *   Updates `users` table:
        *   `stripeCurrentPeriodEnd` updated to the new date.
        *   `subscriptionCancelledAtPeriodEnd` set to `false` (ensuring it's reset if it was somehow true).
        *   `subscriptionTier` remains unchanged.
    *   Credits are **reset** to the full allowance for the *current* tier (`CREDITS_STARTER` or `CREDITS_PRO`) via `performCreditTransaction` (using `paid_tier_renewal`).
*   **Business Rule/User Experience:** Subscription renews seamlessly. User is charged, the next billing date is updated, and their credit balance is reset according to their current plan level.

### 7. Reactivation (Undoing Cancellation)
*   **Trigger:** User clicks "Reactivate" or changes their mind in the Stripe Billing Portal *before* the period end.
*   **Stripe Action:** Sets `cancel_at_period_end` back to `false` on the `Subscription`, sends `customer.subscription.updated` webhook.
*   **Application Action (`customer.subscription.updated` webhook):**
    *   Finds user via `stripeSubscriptionId`.
    *   Detects `cancel_at_period_end` is now `false` (and presumably `subscriptionCancelledAtPeriodEnd` was `true` in the DB).
    *   Updates `users` table:
        *   Sets `subscriptionCancelledAtPeriodEnd` back to `false`.
    *   No change to tier or credits.
*   **Business Rule/User Experience:** The pending cancellation is revoked. The subscription will now renew normally at the period end. The UI should no longer show the cancellation warning.

---
This covers the primary lifecycle events managed by the current implementation. 