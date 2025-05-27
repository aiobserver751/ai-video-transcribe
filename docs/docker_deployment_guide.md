# Docker Setup and Deployment Guide

This document outlines the Docker setup for the AI Video Transcribe application, detailing the purpose of each relevant file and the deployment workflow from GitHub Actions to Docker Hub, and finally to DigitalOcean.

## Docker Setup Overview

The application utilizes a multi-container Docker setup to separate concerns between the web-facing application and background worker processes. This approach involves:

1.  **Separate Dockerfiles:**
    *   `Dockerfile.web`: Builds the image for the Next.js web application.
    *   `Dockerfile.worker`: Builds the image for the BullMQ background workers.
2.  **Multi-Stage Builds:** Both Dockerfiles use multi-stage builds to create lean production images, separating build-time dependencies from runtime necessities.
3.  **TypeScript Execution:** The worker container uses `tsx` to run TypeScript files directly in production, avoiding compilation issues with ES module imports.
4.  **Docker Compose:** A `docker-compose.yml` file is provided for local development and testing of the multi-service environment.
5.  **Automated Image Builds:** A GitHub Actions workflow (`.github/workflows/docker-build.yml`) automates the building of both web and worker Docker images and pushes them to Docker Hub upon changes to the main branches.

## Key Files and Their Purpose

Here's a description of the important files in this Docker setup:

### 1. `Dockerfile.web`

*   **Purpose:** Defines the instructions to build the Docker image for the Next.js web application.
*   **Description:**
    *   Uses a multi-stage build starting from a `node:20.18.0-alpine` base image.
    *   **`base` stage:** Installs system dependencies like Python, ffmpeg, yt-dlp, and build tools.
    *   **`deps` stage:** Installs Node.js project dependencies using `npm ci`.
    *   **`builder` stage:**
        *   Copies source code and `node_modules`.
        *   Sets dummy environment variables for the build process.
        *   Runs `npm run build` (which executes `next build`) to build the Next.js application (generating the `.next/standalone` and `.next/static` directories).
    *   **`runner` stage:**
        *   Creates a lean production image.
        *   Copies essential artifacts from the `builder` stage: `public` folder, `.next/standalone`, and `.next/static`.
        *   Installs only necessary runtime system dependencies (e.g., `python3`, `ffmpeg`).
        *   Sets `NODE_ENV=production`.
        *   Creates a non-root user (`nextjs`) for running the application.
        *   The `CMD ["node", "server.js"]` starts the Next.js production server.

### 2. `Dockerfile.worker`

*   **Purpose:** Defines the instructions to build the Docker image for the BullMQ background worker processes.
*   **Description:**
    *   Structurally very similar to `Dockerfile.web` for its `base`, `deps`, and `builder` stages. This ensures consistency and utilizes Docker's layer caching effectively.
    *   The `RUN npm run build` in the `builder` stage builds the Next.js application but does not compile worker scripts.
    *   **`runner` stage (Key Differences):**
        *   Copies the Next.js build artifacts (`public`, `.next/standalone`, `.next/static`) similar to `Dockerfile.web`.
        *   **Crucially, it copies the source TypeScript files:**
            ```dockerfile
            COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
            COPY --from=builder --chown=nextjs:nodejs /app/lib ./lib
            COPY --from=builder --chown=nextjs:nodejs /app/server ./server
            COPY --from=builder --chown=nextjs:nodejs /app/types ./types
            COPY --from=builder --chown=nextjs:nodejs /app/context ./context
            COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
            COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
            COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
            ```
        *   Installs `tsx` globally: `RUN npm install -g tsx`
        *   The `CMD ["tsx", "scripts/init-workers.ts"]` uses tsx to run the TypeScript worker initialization script directly.

### 3. `docker-compose.yml`

*   **Purpose:** Facilitates local development and testing by defining and running the multi-container application (web and worker services).
*   **Description:**
    *   Defines two services: `web` and `worker`.
    *   The `web` service builds using `Dockerfile.web` and maps port `3000:3000`.
    *   The `worker` service builds using `Dockerfile.worker`.
    *   Both services are configured with `NODE_ENV=production` and `restart: unless-stopped` for local simulation.
    *   Allows developers to easily spin up the entire application stack locally using `docker-compose up --build`.

### 4. `package.json`

*   **Purpose:** Manages project dependencies and defines various npm scripts.
*   **Key Scripts:**
    *   `"build": "next build"`: This is the main build script run within the Dockerfiles. It builds the Next.js application.
    *   `"workers": "tsx scripts/init-workers.ts"`: This script runs the worker initialization using tsx for development.
    *   `"workers:prod": "node scripts/init-workers.js"`: Legacy script (no longer used in Docker).

### 5. `tsconfig.json` (Root)

*   **Purpose:** The main TypeScript configuration file for the Next.js application.
*   **Key Setting:** Includes `"allowImportingTsExtensions": true` and `"noEmit": true` because Next.js handles its own TypeScript-to-JavaScript transpilation.

### 6. `tsconfig.workers.json`

*   **Purpose:** A dedicated TypeScript configuration file for worker scripts (currently not used in production Docker builds).
*   **Note:** With the tsx approach, this file is no longer required for production builds but may still be useful for development tooling.

### 7. `.github/workflows/docker-build.yml`

*   **Purpose:** Defines a GitHub Actions workflow to automatically build the Docker images for the web and worker services and push them to Docker Hub.
*   **Description:**
    *   **Trigger:** Runs on pushes or pull requests to `main` or `master` branches.
    *   **Steps:**
        1.  Checks out the code.
        2.  Sets up Docker Buildx for multi-platform builds (though currently configured for `linux/amd64`).
        3.  Logs into Docker Hub using secrets (`DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`).
        4.  **Builds and Pushes Web Image:**
            *   Uses `docker/build-push-action`.
            *   Specifies `context: .` and `file: ./Dockerfile.web`.
            *   Tags the image as `your_username/ai-video-transcribe:web-latest` and `your_username/ai-video-transcribe:web-<commit-sha>`.
            *   Enables build caching.
        5.  **Builds and Pushes Worker Image:**
            *   Similar to the web image step but uses `file: ./Dockerfile.worker`.
            *   Tags the image as `your_username/ai-video-transcribe:worker-latest` and `your_username/ai-video-transcribe:worker-<commit-sha>`.
            *   The tagged image is pushed to Docker Hub.

## Deployment Flow

The deployment process involves automated builds via GitHub Actions and manual deployment to DigitalOcean App Platform.

### 1. GitHub Actions: Build and Push to Docker Hub

1.  **Code Push:** When code is pushed to the `main` or `master` branch (or a PR is made to these branches), the `.github/workflows/docker-build.yml` workflow is triggered.
2.  **Checkout & Setup:** The workflow checks out the latest code and sets up the Docker build environment.
3.  **Docker Hub Login:** It securely logs into Docker Hub using credentials stored as GitHub secrets.
4.  **Image Build & Push (Web):**
    *   The workflow builds the web application image using `Dockerfile.web`.
    *   The resulting image is tagged with `web-latest` and a commit-specific tag (e.g., `web-a1b2c3d`).
    *   The tagged image is pushed to Docker Hub under your specified repository (e.g., `your_dockerhub_username/ai-video-transcribe`).
5.  **Image Build & Push (Worker):**
    *   The workflow builds the worker image using `Dockerfile.worker`.
    *   The resulting image is tagged with `worker-latest` and a commit-specific tag (e.g., `worker-a1b2c3d`).
    *   The tagged image is pushed to Docker Hub.

### 2. Manual Deployment to DigitalOcean App Platform

After the GitHub Actions workflow has successfully built and pushed the images to Docker Hub, you will deploy or update your services on DigitalOcean App Platform manually through the DigitalOcean GUI.

1.  **Access DigitalOcean App Platform:** Log in to your DigitalOcean account and navigate to your App Platform application.
2.  **Deploy Web Service:**
    *   If creating a new service or updating an existing one for the web application:
        *   Choose "Docker Hub" as the source.
        *   Specify the repository: `your_dockerhub_username/ai-video-transcribe`
        *   Specify the tag: `web-latest` (or a specific commit SHA tag like `web-a1b2c3d` if you prefer to pin to a version).
        *   Configure necessary environment variables, port settings (e.g., HTTP port 3000), scaling, etc., as required for the web service.
        *   Ensure `ENABLE_QUEUE_WORKERS` environment variable is set to `false` or not present if this service should not run workers.
    *   Deploy/Update the service.
3.  **Deploy Worker Service:**
    *   If creating a new service or updating an existing one for the worker processes:
        *   Choose "Docker Hub" as the source.
        *   Specify the repository: `your_dockerhub_username/ai-video-transcribe`
        *   Specify the tag: `worker-latest` (or a specific commit SHA tag like `worker-a1b2c3d`).
        *   Configure necessary environment variables (e.g., Redis connection details, API keys needed by jobs). The worker service typically does not need an exposed HTTP port unless it has a health check endpoint.
        *   Ensure `ENABLE_QUEUE_WORKERS` environment variable is set to `true` for this service.
        *   **Important:** The worker service will automatically run `tsx scripts/init-workers.ts` as defined in the Dockerfile CMD.
    *   Deploy/Update the service.

## Key Changes from Previous Setup

1. **No TypeScript Compilation:** The worker container no longer attempts to compile TypeScript to JavaScript, avoiding import extension conflicts.
2. **Direct TypeScript Execution:** Uses `tsx` to run TypeScript files directly in production.
3. **Simplified Build Process:** The `npm run build` command only builds the Next.js application, not worker scripts.
4. **Source Code Copying:** The worker container copies all necessary source files instead of compiled JavaScript.

This process allows for automated builds and image management via GitHub Actions and Docker Hub, while giving you control over the deployment timing and configuration on DigitalOcean. 