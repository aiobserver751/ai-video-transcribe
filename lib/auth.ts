import { getServerSession } from "next-auth/next";
// Adjust the import path according to your file structure
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { db } from "@/server/db"; // Import database instance
import { apiKeys } from "@/server/db/schema"; // Import apiKeys schema
import { eq, and } from "drizzle-orm"; // Import drizzle operators

/**
 * Retrieves the server-side authentication session.
 * Wrapper around getServerSession to avoid importing options everywhere.
 */
export const getAuthSession = async () => {
  return await getServerSession(authOptions);
};

/**
 * Validates an API key against the database.
 * @param key The API key string to validate.
 * @returns The userId associated with the key if valid and active, otherwise null.
 */
export const validateApiKey = async (key: string): Promise<number | null> => {
  if (!key) {
    return null;
  }

  try {
    const result = await db
      .select({
        userId: apiKeys.userId,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.key, key), eq(apiKeys.isActive, true))) // Check key AND isActive status
      .limit(1);

    if (result.length > 0) {
      // Optional: Update lastUsedAt timestamp (consider performance implications)
      // await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.key, key));
      return result[0].userId;
    }

    return null; // Key not found or not active
  } catch (error) {
    console.error("Error validating API key:", error);
    return null; // Return null on error
  }
}; 