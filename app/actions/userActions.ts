'use server';

import { getServerSession } from "next-auth/next";
import { authConfig } from "@/auth.config"; // Updated import from new location
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import type { SelectUser } from "@/types/user";
import bcrypt from "bcrypt"; // Import bcrypt
import { z } from 'zod';
import { creditTransactionTypeEnum } from "@/server/db/schema"; // Import the enum
import { performCreditTransaction } from '@/server/services/creditService'; // Import the service
import { getCreditConfig } from '@/server/services/creditService'; // Import config getter
import { logger } from "@/lib/logger"; // Import logger
// import { userTypeEnum } from "@/server/db/schema"; // Remove unused enum import

/**
 * Fetches the complete profile for the currently logged-in user.
 * Returns null if the user is not logged in or not found (though the latter is unlikely if a session exists).
 */
export async function getUserProfile(): Promise<SelectUser | null> {
    logger.info("[getUserProfile] Attempting to fetch user profile...");
    const session = await getServerSession(authConfig); // Updated to use authConfig

    // Log the retrieved session object
    logger.info(`[getUserProfile] Retrieved session: ${JSON.stringify(session)}`);

    if (!session?.user?.id) {
        logger.warn(`[getUserProfile] No active session or user ID found in session object. Session User: ${JSON.stringify(session?.user)}`);
        return null; // User is not logged in
    }

    const userId = session.user.id;
    logger.info(`[getUserProfile] Found user ID in session: ${userId}`);

    try {
        // Select fields using snake_case properties from the schema object, per linter feedback
        const profileResult = await db.select({
            id: users.id,
            name: users.name,
            email: users.email,
            emailVerified: users.emailVerified,
            image: users.image,
            type: users.type,
            subscriptionTier: users.subscriptionTier,
            credit_balance: users.credit_balance,
            credits_refreshed_at: users.credits_refreshed_at,
            stripeCustomerId: users.stripeCustomerId,
            stripeSubscriptionId: users.stripeSubscriptionId,
            stripePriceId: users.stripePriceId,
            stripeCurrentPeriodEnd: users.stripeCurrentPeriodEnd,
            subscriptionCancelledAtPeriodEnd: users.subscriptionCancelledAtPeriodEnd,
            createdAt: users.createdAt
          })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        if (profileResult.length === 0) {
            logger.warn(`[getUserProfile] User with ID ${userId} found in session but not in DB!`);
            return null; // User exists in session but not in DB (edge case)
        }

        const profile = profileResult[0]; // profile object now has snake_case keys
        logger.info(`[getUserProfile] Successfully fetched profile data for user ${userId}`);
        
        // Map the snake_case DB result to the camelCase SelectUser type
        const userProfile: SelectUser = {
            id: profile.id,
            name: profile.name,
            email: profile.email,
            image: profile.image,
            type: profile.type,
            subscriptionTier: profile.subscriptionTier, 
            credit_balance: profile.credit_balance,
            stripeCustomerId: profile.stripeCustomerId,     
            stripeSubscriptionId: profile.stripeSubscriptionId,
            stripePriceId: profile.stripePriceId,           
            subscriptionCancelledAtPeriodEnd: profile.subscriptionCancelledAtPeriodEnd,
            emailVerified: profile.emailVerified ? new Date(profile.emailVerified) : null,
            credits_refreshed_at: profile.credits_refreshed_at ? new Date(profile.credits_refreshed_at) : null,
            stripeCurrentPeriodEnd: profile.stripeCurrentPeriodEnd ? new Date(profile.stripeCurrentPeriodEnd) : null,
            createdAt: new Date(profile.createdAt),
            passwordHash: null, // Assuming SelectUser doesn't need/want passwordHash
        };
        
        return userProfile as SelectUser;

    } catch (error) {
        logger.error(`[getUserProfile] Error fetching profile for user ${userId}:`, error);
        return null; // Return null on error to prevent crashing caller components
    }
}

// --- Registration --- 

const RegisterSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters long"),
  confirmPassword: z.string()
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"], // Path of error
});

/**
 * Server Action to register a new user with email/password.
 */
export async function registerUser(
  prevState: { message: string | null; success: boolean },
  formData: FormData
): Promise<{ message: string | null; success: boolean }> {
  'use server';

  // Extract data
  const rawData = {
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  };

  // Validate data
  const validationResult = RegisterSchema.safeParse(rawData);
  if (!validationResult.success) {
    const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join("; ");
    logger.error("Registration validation failed:", validationResult.error.flatten());
    return { message: `Validation Error: ${errorMessages}`, success: false };
  }

  const { name, email, password } = validationResult.data;

  try {
    // Check if user already exists - Select all fields
    const existingUser = await db.select() // <-- Select all fields
                                  .from(users)
                                  .where(eq(users.email, email))
                                  .limit(1);

    if (existingUser.length > 0) {
      logger.info(`Registration attempt for existing email: ${email}`);
      return { message: "An account with this email already exists.", success: false };
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10); // Salt rounds = 10

    // Insert new user and return their ID
    const insertedUsers = await db.insert(users).values({
      name,
      email,
      passwordHash: hashedPassword,
      type: 'normal',
      // Other fields like subscription defaults should be handled by DB schema defaults
    }).returning({ id: users.id });

    if (!insertedUsers || insertedUsers.length === 0 || !insertedUsers[0]?.id) {
      logger.error("Failed to insert user or retrieve ID after insertion.");
      return { message: "Database error: Failed to finalize account creation.", success: false };
    }

    const newUserId = insertedUsers[0].id;
    logger.info(`New user registered: ${email} with ID: ${newUserId}`);

    // --- Allocate Initial Credits ---
    try {
      const config = getCreditConfig(); // Get credit config
      const initialCredits = config.FREE_TIER_INITIAL_CREDITS;
      
      if (initialCredits > 0) {
          const creditResult = await performCreditTransaction(
            newUserId,
            initialCredits,
            creditTransactionTypeEnum.enumValues[0], // 'initial_allocation'
            {
              customDescription: "Initial credits upon signup."
            }
          );

          if (!creditResult.success) {
            // Log error but don't necessarily fail the whole registration
            // The user exists, they just didn't get credits initially (can be fixed manually?)
            logger.error(`Failed to allocate initial credits for user ${newUserId}: ${creditResult.error}`);
            // Optionally, inform the user but still consider registration successful
            // return { message: "Account created, but failed to allocate initial credits. Please contact support.", success: true };
          } else {
            logger.info(`Allocated ${initialCredits} initial credits to user ${newUserId}. New balance: ${creditResult.newBalance}`);
          }
      }
    } catch (creditError) {
        // Catch errors from getCreditConfig() or unexpected errors in performCreditTransaction
         logger.error(`Critical error allocating initial credits for user ${newUserId}:`, creditError);
         // Decide if registration should still be considered successful
    }
    // --- End Credit Allocation ---

    return { message: "Account created successfully! Please sign in.", success: true };

  } catch (error) {
    logger.error("Error during user registration:", error);
    // Check for unique constraint violation on email specifically
    if (error instanceof Error && error.message.includes('duplicate key value violates unique constraint') && error.message.includes('users_email_key')) {
        return { message: "An account with this email already exists.", success: false };
    }
    return { message: "Database error: Failed to create account.", success: false };
  }
} 