import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ path: '.env' });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

export default defineConfig({
  schema: './server/db/schema.ts', // UPDATED Path to your schema file
  out: './drizzle/migrations', // Directory for migration files
  dialect: 'postgresql', // Specify the dialect
  dbCredentials: {
    // Drizzle Kit needs the connection URL for introspection and migrations
    url: process.env.DATABASE_URL,
  },
  verbose: true, // Enable verbose logging
  strict: true, // Enable strict mode
}); 