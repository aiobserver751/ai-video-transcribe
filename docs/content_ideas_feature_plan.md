
Okay, I've updated the plan based on your feedback. The key changes include:

*   **No External APIs for Job Creation:** Job creation will be handled by server-side functions triggered directly from the UI for logged-in users.
*   **Environment Variables:** Noted that `OPENAI_API_KEY` and `OPENAI_MODEL_NAME` are existing, and incorporated the specific credit costs and `MAX_YOUTUBE_COMMENTS_TO_FETCH` you provided.
*   **YouTube Comment Fetching:** Updated to use `yt-dlp`, referencing existing transcription handling code as a guide. I've also added a note about verifying which engagement metrics (`replyCount`, `creator responses`) are reliably available via `yt-dlp`.

Here is the revised plan in markdown format:

```markdown
# Content Ideas Generation Feature: Implementation Plan (Revised)

## Overall Notes from User Feedback:
*   **Scope:** This feature is for UI access by logged-in users only. No external/public API endpoints for content idea job creation are in scope. Interactions will be via server-side functions.
*   **Environment Variables:**
    *   `OPENAI_API_KEY` and `OPENAI_MODEL_NAME` are already in use and configured in `.env`.
    *   `CONTENT_IDEA_NORMAL_CREDIT_COST=10`
    *   `CONTENT_IDEA_COMMENT_SMALL_CREDIT_COST=10`
    *   `CONTENT_IDEA_COMMENT_MEDIUM_CREDIT_COST=20`
    *   `CONTENT_IDEA_COMMENT_LARGE_CREDIT_COST=30`
    *   `CONTENT_IDEA_COMMENT_XLARGE_CREDIT_COST` (Note: X-Large was mentioned in spec but not in provided env list, assuming it might be 40 or 50 if tiering continues, e.g. 500-1000 is Large, 1000-2000 is X-Large. The cost for X-Large needs to be defined, e.g., `CONTENT_IDEA_COMMENT_XLARGE_CREDIT_COST=40`)
    *   `MAX_YOUTUBE_COMMENTS_TO_FETCH=2000`
*   **Comment Fetching:** Use `yt-dlp` for fetching YouTube comments, leveraging existing patterns for transcription if applicable.

## Phase 1: Backend Foundation & Core Job Logic

1.  **Database Setup:**
    *   Create the `content_idea_jobs` table using the provided SQL schema.
2.  **Environment Configuration:**
    *   Ensure the following environment variables are defined and accessible (values provided by user):
        *   `OPENAI_MODEL_NAME` (existing)
        *   `CONTENT_IDEA_NORMAL_CREDIT_COST=10`
        *   `CONTENT_IDEA_COMMENT_SMALL_CREDIT_COST=10`
        *   `CONTENT_IDEA_COMMENT_MEDIUM_CREDIT_COST=20`
        *   `CONTENT_IDEA_COMMENT_LARGE_CREDIT_COST=30`
        *   `CONTENT_IDEA_COMMENT_XLARGE_CREDIT_COST` (To be defined, e.g., 40 or 50, based on comment count tier 1000-2000)
        *   `MAX_YOUTUBE_COMMENTS_TO_FETCH=2000`
3.  **Queue Setup:**
    *   Establish a new dedicated processing queue (e.g., `content_ideas_queue`) for these jobs.
4.  **Model and Service Layer:**
    *   Define data models/entities for `content_idea_jobs`.
    *   Implement core job management logic:
        *   Job creation (triggered by server-side functions called from UI):
            *   Authentication check (ensure user is logged in).
            *   Validation: Source `transcription_jobs.id` exists and status is 'completed'.
            *   For "Comment Analysis", validate `transcription_jobs.source` is YouTube.
        *   Status updates (`pending`, `processing`, `completed`, `failed`, `failed_insufficient_credits`, `pending_credit_deduction`).
        *   Error handling and `status_message` updates.
5.  **Credit System Integration:**
    *   Update credit transaction logic:
        *   Define new transaction types/enums if needed.
        *   Implement credit deduction:
            *   Fixed cost for "Normal Analysis".
            *   Variable cost for "Comment Analysis" based on comment count tiers (Small, Medium, Large, X-Large).
        *   Handle `failed_insufficient_credits`.
6.  **LLM Integration Service:**
    *   Utilize the existing service (or adapt it) for OpenAI API interaction using `OPENAI_MODEL_NAME`.

## Phase 2: "Normal Analysis" Feature Implementation (End-to-End)

1.  **Server-Side Function for Normal Analysis Job Creation:**
    *   Implement a server-side function callable from the frontend UI.
    *   Input: `transcription_id`.
    *   Logic:
        *   Perform validations.
        *   Deduct credits.
        *   Create `content_idea_jobs` record (`job_type = 'normal'`).
        *   Enqueue the job.
2.  **Worker Logic for Normal Analysis:**
    *   Picks up jobs from `content_ideas_queue` (`job_type = 'normal'`).
    *   Fetch transcription text (and summaries if applicable).
    *   Load `/prompts/content_ideas_normal.md`.
    *   Format prompt and call LLM service.
    *   Update job status, store `result_txt`, `result_json`, `completed_at` or `status_message`.
3.  **Frontend Changes for Normal Analysis:**
    *   **Transcription Job Detail Page:**
        *   Add UI element (form/button) to trigger "Generate Content Ideas" (Normal Analysis). This calls the server-side function.
    *   **"Content Ideas" Section (Sidebar & List Page):**
        *   Sidebar link to "Content Ideas".
        *   Job list page (`/content-ideas`) displaying user's `content_idea_jobs`.
    *   **Content Idea Job Detail Page:**
        *   Page (e.g., `/content-ideas/{job_id}`) displaying job details.
        *   If completed, show `result_txt` and download button.

## Phase 3: "Comment Analysis" Feature Implementation (End-to-End)

1.  **YouTube Comment Processing Service (using `yt-dlp`):**
    *   **Fetching:**
        *   Implement logic to fetch comments for a YouTube video URL using `yt-dlp`. Refer to existing `yt-dlp` usage for transcription handling.
        *   Handle `MAX_YOUTUBE_COMMENTS_TO_FETCH`.
    *   **Initial Filtering:**
        *   Remove spam/toxic (basic filters or investigate `yt-dlp` options).
        *   Filter short comments (< 5 words) and comments without alphabet chars.
    *   **Scoring Algorithm Implementation:**
        *   Process comments fetched via `yt-dlp`.
        *   **Relevance Score:** Semantic similarity (embeddings), keyword presence.
        *   **Quality Score:** Length, language complexity (heuristics/readability), identify questions.
        *   **Engagement Score:** Use `likeCount` from `yt-dlp`. *Note: Investigate `yt-dlp`'s output to determine if `replyCount` per comment and reliable `creator responses` identification are feasible. Adjust scoring if these metrics are unavailable or unreliable.*
        *   **Recency Score:** Use comment timestamp from `yt-dlp` with a decay function.
        *   **Uniqueness Score (Clustering):** Embed comments, apply clustering.
        *   **Combined Score:** Weighted formula as specified. Normalize scores.
    *   **Final Filtering & Selection:**
        *   Sort by `CommentScore`.
        *   Apply clustering for diversity if not fully handled in Uniqueness.
        *   Select top N comments based on credit tier, capacity, quality threshold.
2.  **Server-Side Function for Comment Analysis Job Creation:**
    *   Implement a server-side function callable from the frontend UI.
    *   Input: `transcription_id`.
    *   Logic:
        *   Perform validations.
        *   Fetch comment count (using a helper or `yt-dlp` directly).
        *   Determine credit tier/cost.
        *   Deduct credits.
        *   Create `content_idea_jobs` record (`job_type = 'comments'`).
        *   Enqueue the job.
3.  **Server-Side Function to Get YouTube Comment Count (Optional but Recommended for UI):**
    *   Implement a server-side function to get the comment count for a YouTube video.
    *   Called by the UI on the transcription detail page to display eligibility and cost implications for "Comment Analysis".
4.  **Worker Logic for Comment Analysis:**
    *   Picks up jobs from `content_ideas_queue` (`job_type = 'comments'`).
    *   Fetch transcription text.
    *   Call YouTube Comment Processing Service for top N comments.
    *   Load `/prompts/content_ideas_yt_comments.md`.
    *   Format prompt and call LLM service.
    *   Update job status, store results, or error message.
5.  **Frontend Changes for Comment Analysis:**
    *   **Transcription Job Detail Page:**
        *   If YouTube source, display comment count (from server function call).
        *   Enable "Comment Analysis" option, showing credit implications. This calls the job creation server-side function.

## Phase 4: Final Touches & Testing

1.  **Technical Changes Review:**
    *   Confirm all items from original "Technical Changes Required" are addressed as per revised plan.
2.  **Output Format Adherence:**
    *   Ensure LLM prompts produce plain text (`result_txt`) and specified JSON (`result_json`).
3.  **Comprehensive Testing:**
    *   **Unit Tests:** Credit logic, comment scoring components (mocking `yt-dlp` output), LLM service interaction.
    *   **Integration Tests:**
        *   End-to-end flow for "Normal Analysis" (UI trigger to job completion).
        *   End-to-end flow for "Comment Analysis" (UI trigger, `yt-dlp` interaction, scoring, LLM, job completion).
        *   Credit deduction and insufficient credit scenarios.
    *   **UI/UX Testing:**
        *   Test UI elements, forms, pages, job statuses, results display, download functionality.

```
