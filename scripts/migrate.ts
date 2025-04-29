import { migrate } from 'drizzle-orm/neon-http/migrator';
import { db } from '../server/db/index.ts'; // Added .ts extension
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env' });

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