import { pgTable, serial, text, timestamp, index, pgEnum, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
// --- Enums ---
// Define an enum for job status
export const jobStatusEnum = pgEnum('job_status', ['pending', 'processing', 'completed', 'failed']);
// Define an enum for quality level
export const qualityEnum = pgEnum('quality', ['standard', 'premium']);
// --- Users Table ---
export const users = pgTable('users', {
    id: serial('id').primaryKey(), // Auto-incrementing primary key
    email: text('email').unique().notNull(), // Unique email address
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(), // Timestamp of creation
});
// Define relations for Users (one user can have many jobs)
export const usersRelations = relations(users, ({ many }) => ({
    jobs: many(transcriptionJobs),
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
}, (table) => {
    // Add indexes for potentially queried columns
    return {
        userIdx: index('user_id_idx').on(table.userId),
        statusIdx: index('status_idx').on(table.status),
    };
});
// Define relations for TranscriptionJobs (one job belongs to one user)
export const transcriptionJobsRelations = relations(transcriptionJobs, ({ one }) => ({
    user: one(users, {
        fields: [transcriptionJobs.userId],
        references: [users.id],
    }),
}));
//# sourceMappingURL=schema.js.map