# Data Fetching Strategy for Dynamic Content

This document outlines the decision-making process and recommended strategies for fetching and displaying dynamic data within the application, particularly for content that updates due to background processes (e.g., transcription job statuses).

## Core Challenge

Displaying real-time or near real-time updates for data modified by background workers (like the BullMQ transcription queue) in a Next.js application using the App Router presents challenges related to caching and data synchronization between the server and client.

## Approaches Considered

### 1. Server Components with Server Actions & Revalidation

-   **Description:** Pages are primarily Server Components. Data is fetched directly on the server using Server Actions (e.g., `getJobDetails`). Updates rely on server-side cache invalidation (`revalidatePath`, `revalidateTag`) and dynamic rendering flags (`export const dynamic = 'force-dynamic';`, `unstable_noStore()`).
-   **Pros:**
    -   Reduced client-side JavaScript.
    -   Direct database access from server logic.
    -   Good for SEO and initial page load.
-   **Cons:**
    -   Complex cache management for background updates.
    -   Achieving "live" UI updates without polling requires more advanced setups (e.g., streaming, WebSockets).
    -   Can be difficult to ensure all caching layers are appropriately busted, leading to stale data display issues.

### 2. Client Components with Client-Side Data Fetching (e.g., `@tanstack/react-query`)

-   **Description:** Pages are Client Components (`"use client";`). Data is fetched from API endpoints using a client-side data fetching library like `@tanstack/react-query`.
-   **Pros:**
    -   Robust client-side caching and synchronization.
    -   Easier to implement "live" updates via polling (`refetchInterval`) or other RQ features (window focus refetching, etc.).
    -   Mature library with good developer experience for managing server state on the client.
-   **Cons:**
    -   Increases client-side JavaScript bundle.
    -   Requires maintaining separate API endpoints for data.
    -   May involve initial loading states on the client more visibly.

## Decision for Job Status Display (List & Detail Pages)

### Job List Page (`/jobs`)

-   **Implementation:** Client Component using `@tanstack/react-query` with a `refetchInterval`.
-   **Rationale:** This approach was found to be effective and reliable for displaying a list of jobs where statuses change frequently. The polling mechanism ensures the list stays up-to-date.

### Job Detail Page (`/jobs/[jobId]`)

-   **Initial Approach (Server Component):** Server Component fetching data via a Server Action (`getJobDetails`).
-   **Observed Issue:** Difficulty in reliably displaying the latest job status when it was updated by a background worker. Despite using `revalidatePath`, `dynamic = 'force-dynamic'`, and `unstable_noStore()`, inconsistencies (stale "processing" status for a "completed" job) were observed. This was due to the complexities of Next.js server-side caching layers when data changes asynchronously in the backend.
-   **Revised Approach (Client Component - Implemented):** Reverted to a Client Component using `@tanstack/react-query` to fetch data from an API endpoint (`/api/jobs/[jobId]`).
    -   The API endpoint itself uses the `getJobDetails` server action (which includes `unstable_noStore()`) to fetch fresh data from the database.
    -   A `refetchInterval` is used on the client-side query to poll for updates.
-   **Rationale for Revision:**
    1.  **Reliability for Dynamic Status:** Provides a more robust mechanism for ensuring the job status is current, especially for a page where users expect to see the outcome of a background process.
    2.  **Consistency:** Aligns the data fetching strategy with the job list page.
    3.  **Simplified Live Updates:** Polling via `refetchInterval` is a straightforward way to achieve near real-time status updates on the page.
    4.  **Leveraging Library Strengths:** Utilizes `@tanstack/react-query` for what it does best: managing server state on the client.

## General Recommendation

-   **For largely static content or content updated primarily through direct user interaction on the page:** Server Components with Server Actions are generally preferred for their performance benefits and reduced client-side load.
-   **For content that needs to reflect updates from background processes or requires "live" updates while the user is viewing the page:** Client Components with a robust client-side data fetching library like `@tanstack/react-query` (using features like polling or WebSocket integration) often provide a more reliable and developer-friendly solution. API endpoints called by the client should ensure they fetch fresh data from the source (e.g., by using `unstable_noStore()` in underlying server actions if applicable).

Always ensure that appropriate cache revalidation strategies (`revalidatePath`, `revalidateTag`) are used in backend processes that modify data, regardless of the front-end fetching strategy, to assist Next.js in keeping its server-side caches as current as possible for subsequent requests. 