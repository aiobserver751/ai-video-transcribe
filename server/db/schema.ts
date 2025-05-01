import { pgTable, serial, text, timestamp, index, pgEnum, integer, boolean, primaryKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import type { AdapterAccount } from "next-auth/adapters"; // Import AdapterAccount type

// --- Enums ---
// Define an enum for job status
export const jobStatusEnum = pgEnum('job_status', ['pending', 'processing', 'completed', 'failed']);
// Define an enum for quality level
export const qualityEnum = pgEnum('quality', ['standard', 'premium']);
// Define an enum for job origin
export const jobOriginEnum = pgEnum('job_origin', ['INTERNAL', 'EXTERNAL']); // Enum for job origin
export const userTypeEnum = pgEnum('user_type', ['normal', 'google']); // <-- Add user type enum

// --- Users Table (Updated for Auth.js) ---
export const users = pgTable('users', {
  // id: serial('id').primaryKey(), // Adapter expects text based on AdapterUser type
  id: text("id").primaryKey().notNull().$defaultFn(() => crypto.randomUUID()), // Use text UUID for compatibility
  name: text("name"),
  email: text("email").unique().notNull(),
  emailVerified: timestamp("emailVerified", { mode: "date", withTimezone: true }),
  image: text("image"),
  type: userTypeEnum('type'), // <-- Add user type field (nullable for now)
  passwordHash: text("password_hash"), // <-- Corrected: text is nullable by default
  // description: text("description"), // Removed
  // location: text("location"),     // Removed
  // link: text("link"),           // Removed
  // createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(), // Use existing or let adapter handle? Let's remove for now.
});

// --- Accounts Table (For Auth.js Providers) ---
export const accounts = pgTable(
  "accounts",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccount["type"]>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    compoundKey: primaryKey({ columns: [account.provider, account.providerAccountId] }),
    userIdIdx: index('accounts_userId_idx').on(account.userId), // Index on userId
  })
);

// --- Sessions Table (For Auth.js Database Sessions) ---
export const sessions = pgTable("sessions", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
},
(session) => ({
    userIdIdx: index('sessions_userId_idx').on(session.userId), // Index on userId
}));

// --- Verification Tokens Table (For Auth.js Email Verification etc.) ---
export const verificationTokens = pgTable(
  "verificationTokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
);


// Define relations for Users (Updated for Auth.js)
export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts), // Relation to accounts table
  sessions: many(sessions), // Relation to sessions table
  jobs: many(transcriptionJobs),
  apiKeys: many(apiKeys),
}));

// --- ApiKeys Table ---
export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  key: text('key').unique().notNull(), // The API key string itself
  userId: text('user_id').references(() => users.id).notNull(), // Foreign key changed to text to match users.id
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
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id), // Foreign key changed to text to match users.id
  videoUrl: text('video_url').notNull(),
  quality: qualityEnum('quality').notNull(),
  status: jobStatusEnum('status').default('pending').notNull(),
  origin: jobOriginEnum('origin').notNull(),
  statusMessage: text('status_message'),
  transcriptionFileUrl: text('transcription_file_url'),
  transcriptionText: text('transcription_text'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
},
(table) => {
  return {
    userIdx: index('job_user_id_idx').on(table.userId),
    statusIdx: index('job_status_idx').on(table.status),
    originIdx: index('job_origin_idx').on(table.origin),
  };
});

// Define relations for TranscriptionJobs (one job belongs to one user)
// Relation updated implicitly via usersRelations
export const transcriptionJobsRelations = relations(transcriptionJobs, ({ one }) => ({
    user: one(users, {
        fields: [transcriptionJobs.userId],
        references: [users.id],
    }),
})); 