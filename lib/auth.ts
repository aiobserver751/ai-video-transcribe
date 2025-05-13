import { getServerSession } from "next-auth/next";
// Adjust the import path according to your file structure
import { authConfig } from "@/auth.config"; // Updated import path
import { db } from "@/server/db"; // Import database instance
import { apiKeys } from "@/server/db/schema"; // Import apiKeys schema
import { eq, and } from "drizzle-orm"; // Import drizzle operators
import { logger } from "@/lib/logger";
import { Session } from "next-auth";

/**
 * Retrieves the server-side authentication session with proper error handling.
 * @returns The session object if authenticated, null otherwise.
 */
export const getAuthSession = async (): Promise<Session | null> => {
  try {
    const session = await getServerSession(authConfig);
    logger.debug('[getAuthSession] Session retrieved:', session);
    return session;
  } catch (error) {
    logger.error('[getAuthSession] Error retrieving session:', error);
    return null;
  }
};

/**
 * Validates an API key against the database.
 * @param key The API key string to validate.
 * @returns The userId associated with the key if valid and active, otherwise null.
 */
export const validateApiKey = async (key: string): Promise<string | null> => {
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
      // Update last used timestamp in the background
      updateApiKeyLastUsed(key).catch(err => 
        logger.error('Error updating API key last used timestamp:', err)
      );
      
      return result[0].userId;
    }

    return null; // Key not found or not active
  } catch (error) {
    logger.error("Error validating API key:", error);
    return null; // Return null on error
  }
};

/**
 * Updates the lastUsedAt timestamp for an API key.
 * This function is meant to be called in the background without awaiting.
 */
async function updateApiKeyLastUsed(key: string): Promise<void> {
  try {
    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.key, key));
  } catch (error) {
    // Just log the error, don't rethrow as this is a background operation
    logger.error("Error updating API key lastUsedAt:", error);
  }
} 