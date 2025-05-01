'use server';

import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route"; // Import authOptions
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import type { SelectUser } from "@/types/user";
import bcrypt from "bcrypt"; // Import bcrypt
import { z } from 'zod';
// import { userTypeEnum } from "@/server/db/schema"; // Remove unused enum import

/**
 * Fetches the complete profile for the currently logged-in user.
 * Returns null if the user is not logged in or not found (though the latter is unlikely if a session exists).
 */
export async function getUserProfile(): Promise<SelectUser | null> {
    // Use getServerSession with authOptions
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
        console.log("No active session or user ID found.");
        return null; // User is not logged in
    }

    try {
        // Select ALL user fields to match SelectUser type
        const profile = await db.select()
            .from(users)
            .where(eq(users.id, session.user.id))
            .limit(1);

        if (profile.length === 0) {
            console.warn(`User with ID ${session.user.id} found in session but not in DB.`);
            return null; // User exists in session but not in DB (edge case)
        }

        console.log(`Fetched profile for user ${session.user.id}`);
        return profile[0];
    } catch (error) {
        console.error("Error fetching user profile:", error);
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
    console.error("Registration validation failed:", validationResult.error.flatten());
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
      console.log(`Registration attempt for existing email: ${email}`);
      return { message: "An account with this email already exists.", success: false };
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10); // Salt rounds = 10

    // Insert new user
    await db.insert(users).values({
      name,
      email,
      passwordHash: hashedPassword,
      type: 'normal', // Use string literal
    });

    console.log(`New user registered: ${email}`);
    // Note: We don't automatically sign in the user here.
    // They will be redirected to sign in after successful registration.
    return { message: "Account created successfully! Please sign in.", success: true };

  } catch (error) {
    console.error("Error during user registration:", error);
    return { message: "Database error: Failed to create account.", success: false };
  }
} 