'use server';

import { db } from '@/server/db';
import { apiKeys } from '@/server/db/schema';
import { getAuthSession } from '@/lib/auth'; // Corrected import
import crypto from 'crypto';
import { eq, desc, and } from 'drizzle-orm';

// Removed Ratelimit and Redis imports for now

interface GenerateApiKeyResult {
  success: boolean;
  apiKey?: {
    id: string;
    key: string; // The full API key, to be shown only once
    name: string; // Name is now required
    createdAt: Date;
  };
  error?: string;
  // limitReached?: boolean; // Removed as rate limiting is temporarily removed
}

export async function generateApiKey(name: string): Promise<GenerateApiKeyResult> {
  const session = await getAuthSession(); // Use getAuthSession
  if (!session?.user?.id) {
    return { success: false, error: 'User not authenticated.' };
  }
  const userId = session.user.id;

  if (!name || name.trim() === '') {
    return { success: false, error: 'API key name is required.' };
  }

  // Rate limit section removed for now

  try {
    // Generate a unique API key
    // Prefix 'sk_' stands for 'secret key'.
    const generatedKey = `sk_${crypto.randomBytes(24).toString('hex')}`;

    const newApiKeyRecords = await db
      .insert(apiKeys)
      .values({
        userId: userId,
        key: generatedKey,
        name: name.trim(), // Use the provided name, ensure it's trimmed
      })
      .returning({
        id: apiKeys.id,
        key: apiKeys.key,
        name: apiKeys.name,
        createdAt: apiKeys.createdAt,
      });

    if (!newApiKeyRecords || newApiKeyRecords.length === 0) {
      return { success: false, error: 'Failed to create API key in database.' };
    }

    // Ensure the returned object matches the apiKey structure in GenerateApiKeyResult
    const newApiKey = newApiKeyRecords[0];
    if (!newApiKey || !newApiKey.id || !newApiKey.key || newApiKey.createdAt === undefined) {
        // This case should ideally not happen if .returning works as expected and schema is correct
        console.error("API Key record is missing expected fields:", newApiKey);
        return { success: false, error: 'Failed to retrieve complete API key data after creation.' };
    }

    return {
      success: true,
      apiKey: {
        id: newApiKey.id,
        key: newApiKey.key,
        name: newApiKey.name, // name can be null, which is fine
        createdAt: newApiKey.createdAt, 
      },
    };
  } catch (error) {
    console.error('Error generating API key:', error);
    // Type guard for Drizzle/Postgres errors if a specific constraint name is known
    // For a general unique constraint on 'key' (api_keys_key_key based on typical naming)
    if (error instanceof Error && error.message.includes('duplicate key value violates unique constraint') && error.message.includes('api_keys_key_key')) {
        return { success: false, error: 'Failed to generate a unique key due to a conflict. Please try again.' };
    }
    return { success: false, error: 'An unexpected error occurred while generating the key.' };
  }
}

// We will add listApiKeys and revokeApiKey functions here later. 

// --- listApiKeys ---
interface ApiKeyMetadata {
  id: string;
  name: string; // Name is now always a string
  createdAt: Date;
  lastUsedAt: Date | null;
  isActive: boolean;
  // We might add a few characters of the key for display, e.g., keyPrefix
  keyPrefix: string; // e.g., "sk_abc..."
  keySuffix: string; // e.g., "...xyz"
}

interface ListApiKeysResult {
  success: boolean;
  keys?: ApiKeyMetadata[];
  error?: string;
}

export async function listApiKeys(): Promise<ListApiKeysResult> {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return { success: false, error: 'User not authenticated.' };
  }
  const userId = session.user.id;

  try {
    const userApiKeys = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        isActive: apiKeys.isActive,
        key: apiKeys.key, // Select the full key temporarily to derive prefix/suffix
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(desc(apiKeys.createdAt));

    const keysMetadata = userApiKeys.map(k => ({
      id: k.id,
      name: k.name!, // Assert name is non-null, as per new schema constraint
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      isActive: k.isActive,
      // Create a display version of the key, e.g., "sk_abc...xyz"
      // Show first 6 after "sk_" and last 4.
      keyPrefix: k.key.substring(0, k.key.startsWith('sk_') ? 3 + 6 : 6), // "sk_" + 6 chars or just first 6
      keySuffix: k.key.substring(k.key.length - 4),
    }));

    return { success: true, keys: keysMetadata };
  } catch (error) {
    console.error('Error listing API keys:', error);
    return { success: false, error: 'An unexpected error occurred while listing API keys.' };
  }
}

// We will add revokeApiKey function here later. 

// --- revokeApiKey ---
interface RevokeApiKeyResult {
  success: boolean;
  error?: string;
}

export async function revokeApiKey(apiKeyId: string): Promise<RevokeApiKeyResult> {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return { success: false, error: 'User not authenticated.' };
  }
  const userId = session.user.id;

  if (!apiKeyId) {
    return { success: false, error: 'API Key ID is required.' };
  }

  try {
    // First, verify the key belongs to the user and get its ID for deletion
    const keyToDelete = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.userId, userId)))
      .limit(1);

    if (!keyToDelete || keyToDelete.length === 0) {
      // Key not found or does not belong to the user
      return { success: false, error: 'API Key not found or you do not have permission to revoke it.' };
    }

    // Proceed with deletion
    await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.userId, userId))); // Double-check ownership on delete
    
    // Check if a row was actually deleted. Drizzle's delete returns a result object 
    // that might vary by driver, but typically indicates rows affected if available.
    // For now, we assume success if no error is thrown and key was verified.
    // Depending on the Drizzle driver, you might inspect deleteResult for rowsAffected.

    return { success: true };
  } catch (error) {
    console.error('Error revoking API key:', error);
    return { success: false, error: 'An unexpected error occurred while revoking the API key.' };
  }
} 