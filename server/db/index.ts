import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless'; // Import neon function
import * as schema from './schema.ts';
import * as dotenv from 'dotenv';
import { logger } from '@/lib/logger'; // Added logger import

dotenv.config({ path: '.env' });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is not set for Neon');
}

// Create a Neon query function using the connection string
const sql = neon(databaseUrl);

// Create the Drizzle instance using the Neon query function and schema
export const db = drizzle(sql, { schema, logger: true });

// Optional: Test connection (use the Drizzle instance)
async function testConnection() {
  try {
    // Use Drizzle's built-in query function for testing
    await db.execute('SELECT NOW()');
    logger.info('[Database] Neon Database connected successfully via Drizzle');
  } catch (error) {
    logger.error('[Database] Neon Database connection failed:', error);
    process.exit(1);
  }
}

testConnection(); 