import { users } from '@/server/db/schema';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

// Type for selecting users (what you get back from the DB)
// This now implicitly only contains id, name, email, emailVerified, image
export type SelectUser = InferSelectModel<typeof users>;

// Type for inserting users (structure for creating new users, useful for signup)
// This now implicitly only contains id, name, email, emailVerified, image
export type InsertUser = InferInsertModel<typeof users>;

// Removed UpdateUserProfileData type 