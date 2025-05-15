import { pgTable, text, timestamp, index, pgEnum, integer, boolean, primaryKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import type { AdapterAccount } from "next-auth/adapters"; // Import AdapterAccount type

// --- Enums ---
// Define an enum for job status
export const jobStatusEnum = pgEnum('job_status', ['pending', 'processing', 'completed', 'failed', 'failed_insufficient_credits', 'pending_credit_deduction']);
// Define an enum for quality level - UPDATED
export const qualityEnum = pgEnum('quality', ['caption_first', 'standard', 'premium']);
// Define an enum for job origin
export const jobOriginEnum = pgEnum('job_origin', ['INTERNAL', 'EXTERNAL']); // Enum for job origin
export const userTypeEnum = pgEnum('user_type', ['normal', 'google']);
export const subscriptionTierEnum = pgEnum('subscription_tier', ['free', 'starter', 'pro']); // Current tiers

// NEW: Enum for credit transaction types
export const creditTransactionTypeEnum = pgEnum('credit_transaction_type', [
  // Credit Additions
  'initial_allocation',
  'free_tier_refresh',
  'paid_tier_renewal',
  'job_failure_refund',
  'manual_adjustment_add',
  // Credit Deductions (Spending)
  'caption_download',
  'standard_transcription',
  'premium_transcription',
  'basic_summary',       
  'extended_summary',    
  'manual_adjustment_deduct',
  'paid_credits_expired_on_cancellation'
]);

// --- Users Table (Updated for Auth.js & Subscriptions & Credits) ---
export const users = pgTable('users', {
  id: text("id").primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique().notNull(),
  emailVerified: timestamp("emailVerified", { mode: "date", withTimezone: true }),
  image: text("image"),
  type: userTypeEnum('type'), 
  passwordHash: text("password_hash"), 
  
  // Subscription Fields
  subscriptionTier: subscriptionTierEnum('subscription_tier').default('free').notNull(), 
  // RENAMED from 'credits' and ADDED 'credits_refreshed_at'
  credit_balance: integer('credit_balance').default(0).notNull(), 
  credits_refreshed_at: timestamp('credits_refreshed_at', { mode: "date", withTimezone: true }), // For free tier refresh tracking

  // Stripe Fields
  stripeCustomerId: text('stripe_customer_id').unique(), 
  stripeSubscriptionId: text('stripe_subscription_id').unique(), 
  stripePriceId: text('stripe_price_id'), 
  stripeCurrentPeriodEnd: timestamp('stripe_current_period_end', { mode: 'date', withTimezone: true }),
  subscriptionCancelledAtPeriodEnd: boolean('subscription_cancelled_at_period_end').default(false).notNull(),

  // Timestamps
  createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
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
    userIdIdx: index('accounts_userId_idx').on(account.userId),
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
    userIdIdx: index('sessions_userId_idx').on(session.userId),
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

// --- ApiKeys Table ---
export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),
  key: text('key').unique().notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: "cascade" }).notNull(), // Added onDelete cascade
  name: text('name').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at', { mode: 'date', withTimezone: true }),
},
(table) => {
  return {
    keyIdx: index('key_idx').on(table.key),
    userIdx: index('api_key_user_id_idx').on(table.userId),
  };
});

// --- TranscriptionJobs Table (Updated for Credits) ---
export const transcriptionJobs = pgTable('transcription_jobs', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: "set null" }), // Set null if user is deleted
  videoUrl: text('video_url').notNull(),
  quality: qualityEnum('quality').notNull(), // Uses updated enum
  status: jobStatusEnum('status').default('pending').notNull(), // Uses updated enum
  origin: jobOriginEnum('origin').notNull(),
  statusMessage: text('status_message'),
  
  // URLs for the stored transcription files
  transcriptionFileUrl: text('transcription_file_url'), // URL to the primary raw file (e.g., original SRT/VTT from YouTube, TXT from Whisper)
  srtFileUrl: text('srt_file_url'),                     // URL to the SRT file
  vttFileUrl: text('vtt_file_url'),                     // URL to the VTT file

  transcriptionText: text('transcription_text'),
  srt_file_text: text('srt_file_text'), // New field for SRT content
  vtt_file_text: text('vtt_file_text'), // New field for VTT content

  // NEW: Summary Fields
  basicSummary: text('basic_summary'),
  extendedSummary: text('extended_summary'),

  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  // NEW Fields for credit system
  video_length_minutes_actual: integer('video_length_minutes_actual'),
  credits_charged: integer('credits_charged'),
},
(table) => {
  return {
    userIdx: index('job_user_id_idx').on(table.userId),
    statusIdx: index('job_status_idx').on(table.status),
    originIdx: index('job_origin_idx').on(table.origin),
  };
});

// --- NEW: CreditTransactions Table ---
export const creditTransactions = pgTable('credit_transactions', {
  id: text('id').primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: "cascade" }), // Cascade delete if user is deleted
  jobId: text('job_id').references(() => transcriptionJobs.id, { onDelete: "set null" }), // Set null if job is deleted
  amount: integer('amount').notNull(), // Always positive
  type: creditTransactionTypeEnum('type').notNull(),
  description: text('description'),
  video_length_minutes_charged: integer('video_length_minutes_charged'),
  user_credits_before: integer('user_credits_before').notNull(),
  user_credits_after: integer('user_credits_after').notNull(),
  created_at: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
},
(table) => {
  return {
    userIdx: index('credit_transactions_user_id_idx').on(table.userId),
    jobIdx: index('credit_transactions_job_id_idx').on(table.jobId),
    typeIdx: index('credit_transactions_type_idx').on(table.type),
  };
});

// --- RELATIONS ---

// Define relations for Users (Updated for Credits)
export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  jobs: many(transcriptionJobs),
  apiKeys: many(apiKeys),
  creditTransactions: many(creditTransactions), // NEW relation
}));

// Define relations for ApiKeys
export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

// Define relations for TranscriptionJobs
export const transcriptionJobsRelations = relations(transcriptionJobs, ({ one, many }) => ({
    user: one(users, {
        fields: [transcriptionJobs.userId],
        references: [users.id],
    }),
    creditTransactions: many(creditTransactions), // NEW relation: a job can have multiple credit transactions (e.g. charge + refund)
})); 

// NEW: Define relations for CreditTransactions
export const creditTransactionsRelations = relations(creditTransactions, ({ one }) => ({
  user: one(users, {
    fields: [creditTransactions.userId],
    references: [users.id],
  }),
  job: one(transcriptionJobs, {
    fields: [creditTransactions.jobId],
    references: [transcriptionJobs.id],
  }),
})); 