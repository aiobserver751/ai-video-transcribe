import { migrate } from 'drizzle-orm/neon-http/migrator';
import { db } from '../server/db/index.ts'; // Added .ts extension
// import * as dotenv from 'dotenv'; // dotenv loading is handled by server/db/index.ts

// Environment variables should be loaded by the imported 'db' module from server/db/index.ts
// if NODE_ENV is not 'production'.
// dotenv.config({ path: '.env' }); // Removed this line

async function runMigrations() {
  console.log('Starting database migrations...');
  try {
    // Point to the directory containing your migration files
    await migrate(db, { migrationsFolder: './drizzle/migrations' });
    console.log('Migrations completed successfully!');
    // Exit process after successful migration
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    // Exit with error code on failure
    process.exit(1);
  }
}

runMigrations(); 