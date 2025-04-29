import { pgTable, serial, text, timestamp, index, pgEnum, integer, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// --- Enums ---
// Define an enum for job status
export const jobStatusEnum = pgEnum('job_status', ['pending', 'processing', 'completed', 'failed']);
// Define an enum for quality level
export const qualityEnum = pgEnum('quality', ['standard', 'premium']);
export const apiKeyTypeEnum = pgEnum('api_key_type', ['system', 'user']); // Enum for API key type

// --- Users Table ---
export const users = pgTable('users', {
  id: serial('id').primaryKey(), // Auto-incrementing primary key
  email: text('email').unique().notNull(), // Unique email address
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(), // Timestamp of creation
});

// Define relations for Users (one user can have many jobs AND many apiKeys)
export const usersRelations = relations(users, ({ many }) => ({
  jobs: many(transcriptionJobs),
  apiKeys: many(apiKeys), // Added relation to apiKeys
}));

// --- ApiKeys Table ---
export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  key: text('key').unique().notNull(), // The API key string itself
  userId: integer('user_id').references(() => users.id).notNull(), // Must belong to a user
  type: apiKeyTypeEnum('type').notNull(), // 'system' or 'user'
  name: text('name'), // Optional name for user-generated keys
  isActive: boolean('is_active').default(true).notNull(), // To enable/disable keys
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at', { mode: 'date', withTimezone: true }), // Optional: track usage
},
(table) => {
  // Add indexes
  return {
    keyIdx: index('key_idx').on(table.key), // Index for fast key lookup
    userIdx: index('api_key_user_id_idx').on(table.userId), // Index for listing user keys
  };
});

// Define relations for ApiKeys (one key belongs to one user)
export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

// --- TranscriptionJobs Table ---
export const transcriptionJobs = pgTable('transcription_jobs', {
  // Use text for jobId as it's generated as a string (e.g., "transcription-TIMESTAMP-RANDOM")
  id: text('id').primaryKey(), 
  userId: integer('user_id').references(() => users.id), // Foreign key to users table (optional)
  videoUrl: text('video_url').notNull(), // URL of the video to transcribe
  quality: qualityEnum('quality').notNull(), // Requested quality
  status: jobStatusEnum('status').default('pending').notNull(), // Current status of the job
  // Store the path/URL to the transcription file
  transcriptionFileUrl: text('transcription_file_url'), 
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(), // Automatically update on change
},
(table) => {
  // Add indexes for potentially queried columns
  return {
    userIdx: index('job_user_id_idx').on(table.userId), // Renamed index for clarity
    statusIdx: index('job_status_idx').on(table.status), // Renamed index for clarity
  };
});

// Define relations for TranscriptionJobs (one job belongs to one user)
export const transcriptionJobsRelations = relations(transcriptionJobs, ({ one }) => ({
  user: one(users, {
    fields: [transcriptionJobs.userId],
    references: [users.id],
  }),
})); 