import { DefaultSession } from "next-auth";
import { JWT } from "next-auth/jwt";

// Define the user type from your schema
type UserType = "normal" | "google";
type SubscriptionTier = "free" | "starter" | "pro";

declare module "next-auth" {
  /**
   * Extend the built-in session types
   */
  interface Session {
    user: {
      id: string;
      // Add custom fields for your application
      type?: UserType;
      subscriptionTier?: SubscriptionTier;
      credit_balance?: number;
    } & DefaultSession["user"];
  }

  /**
   * Extend the built-in user types
   */
  interface User {
    type?: UserType;
    subscriptionTier?: SubscriptionTier;
    credit_balance?: number;
    credits_refreshed_at?: Date | null;
    passwordHash?: string | null;
    // Add other custom fields
  }
}

declare module "next-auth/jwt" {
  /**
   * Extend the built-in JWT types
   */
  interface JWT {
    id?: string;
    type?: UserType;
    subscriptionTier?: SubscriptionTier;
    credit_balance?: number;
  }
} 