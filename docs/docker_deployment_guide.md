# Docker Setup and Deployment Guide

This document outlines the Docker setup for the AI Video Transcribe application, detailing the purpose of each relevant file and the deployment workflow from GitHub Actions to Docker Hub, and finally to DigitalOcean.

## Docker Setup Overview

The application utilizes a multi-container Docker setup to separate concerns between the web-facing application and background worker processes. This approach involves:

1.  **Separate Dockerfiles:**
    *   `Dockerfile.web`: Builds the image for the Next.js web application using standalone build.
    *   `Dockerfile.worker`: Builds the image for the BullMQ background workers with full codebase access.
2.  **Multi-Stage Builds:** Both Dockerfiles use multi-stage builds to create optimized production images.
3.  **Different Copy Strategies:** Web and worker containers have different requirements and copy strategies.
4.  **TypeScript Execution:** The worker container uses `tsx` to run TypeScript files directly in production.
5.  **Docker Compose:** A `docker-compose.yml` file is provided for local development and testing.
6.  **Automated Image Builds:** A GitHub Actions workflow automates building and pushing images to Docker Hub.

## Key Architecture Principles

### 🚨 **CRITICAL: Different Copy Strategies for Web vs Worker**

**Web and worker containers have fundamentally different requirements:**

#### **Web Container (Next.js Standalone Approach)**
- **Purpose:** Serve HTTP requests efficiently
- **Strategy:** Copy only the optimized Next.js standalone build
- **Why:** Next.js creates a self-contained `server.js` that includes all dependencies
- **Result:** Smaller, faster, production-optimized

```dockerfile
# Web: Optimized standalone build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
CMD ["node", "server.js"]
```

#### **Worker Container (Full Codebase Approach)**
- **Purpose:** Execute complex background jobs with TypeScript
- **Strategy:** Copy the entire codebase for maximum flexibility
- **Why:** tsx needs access to all source files and dependencies
- **Result:** Full development environment for complex tasks

```dockerfile
# Worker: Full codebase access
COPY --from=builder --chown=nextjs:nodejs /app ./
CMD ["tsx", "scripts/init-workers.ts"]
```

### 🔍 **Why Different Approaches?**

#### **Next.js Build Process:**
When `npm run build` runs, Next.js:
1. Compiles TypeScript → JavaScript
2. Bundles all dependencies → Optimized chunks
3. Creates standalone server → `.next/standalone/server.js`
4. Generates static assets → `.next/static/`

The `server.js` file is a **complete, self-contained production server** that doesn't need source files or `node_modules`.

#### **Worker Process Requirements:**
Workers need to:
1. Execute TypeScript directly with `tsx`
2. Access any part of the codebase dynamically
3. Import from complex dependency chains
4. Handle runtime TypeScript compilation

## Key Files and Their Purpose

### 1. `Dockerfile.web`

*   **Purpose:** Builds the Docker image for the Next.js web application using the standalone approach.
*   **Description:**
    *   Uses a multi-stage build starting from `node:20.18.0-alpine`.
    *   **`base` stage:** Installs system dependencies (Python, ffmpeg, yt-dlp, build tools).
    *   **`deps` stage:** Installs Node.js dependencies with `npm ci`.
    *   **`builder` stage:**
        *   Copies source code and `node_modules`.
        *   Sets dummy environment variables for build.
        *   Runs `npm run build` to create Next.js standalone build.
    *   **`runner` stage:**
        *   **Copies Next.js standalone build:** `COPY --from=builder /app/.next/standalone ./`
        *   **Copies static assets:** `COPY --from=builder /app/.next/static ./.next/static`
        *   **Copies public folder:** `COPY --from=builder /app/public ./public`
        *   Installs runtime dependencies (python3, ffmpeg).
        *   Creates non-root user (`nextjs`).
        *   **Starts standalone server:** `CMD ["node", "server.js"]`

### 2. `Dockerfile.worker`

*   **Purpose:** Builds the Docker image for BullMQ background workers with full codebase access.
*   **Description:**
    *   Identical to `Dockerfile.web` for `base`, `deps`, and `builder` stages.
    *   **`runner` stage (Key Differences):**
        *   **Copies ENTIRE codebase:** `COPY --from=builder --chown=nextjs:nodejs /app ./`
        *   **Installs tsx globally:** `RUN npm install -g tsx`
        *   **Runs TypeScript directly:** `CMD ["tsx", "scripts/init-workers.ts"]`

### 3. `docker-compose.yml`

*   **Purpose:** Local development and testing of the multi-container setup.
*   **Services:**
    *   `web`: Builds with `Dockerfile.web`, maps port 3000:3000
    *   `worker`: Builds with `Dockerfile.worker`
    *   Both configured with `NODE_ENV=production` and `restart: unless-stopped`

### 4. `package.json`

*   **Key Scripts:**
    *   `"build": "next build"`: Creates Next.js standalone build and static assets
    *   `"workers": "tsx scripts/init-workers.ts"`: Runs workers in development

### 5. `scripts/init-workers.ts`

*   **Purpose:** Worker initialization script that starts BullMQ workers.
*   **Execution:** Run directly with `tsx` in production container.
*   **Features:**
    *   Initializes transcription and content ideas workers
    *   Handles graceful shutdown on SIGINT
    *   Automatically connects to Redis and database

### 6. `.github/workflows/docker-build.yml`

*   **Purpose:** Automates building and pushing Docker images to Docker Hub.
*   **Triggers:** Pushes or PRs to `main`/`master` branches.
*   **Outputs:**
    *   `your_username/ai-video-transcribe:web-latest`
    *   `your_username/ai-video-transcribe:worker-latest`
    *   Commit-specific tags for both images

## Deployment Flow

### 1. GitHub Actions: Build and Push to Docker Hub

1. **Code Push:** Triggers `.github/workflows/docker-build.yml` workflow
2. **Setup:** Checks out code, sets up Docker Buildx
3. **Authentication:** Logs into Docker Hub with secrets
4. **Build Web Image:** Uses `Dockerfile.web`, tags as `web-latest`
5. **Build Worker Image:** Uses `Dockerfile.worker`, tags as `worker-latest`
6. **Push:** Both images pushed to Docker Hub with latest and commit tags

### 2. Manual Deployment to DigitalOcean App Platform

#### **Deploy Web Service:**
1. Choose "Docker Hub" as source
2. Repository: `your_dockerhub_username/ai-video-transcribe`
3. Tag: `web-latest`
4. Configure environment variables and HTTP port 3000
5. **Important:** Web service uses Next.js standalone server

#### **Deploy Worker Service:**
1. Choose "Docker Hub" as source  
2. Repository: `your_dockerhub_username/ai-video-transcribe`
3. Tag: `worker-latest`
4. Configure environment variables (Redis, database, etc.)
5. **Important:** No HTTP port needed, workers start automatically

## Environment Variables

### **Required for Both Services:**
```env
NODE_ENV=production
DATABASE_URL=your-database-url
# ... other shared variables
```

### **Required for Worker Service:**
```env
REDIS_HOST=your-redis-host
REDIS_PORT=your-redis-port
REDIS_PASSWORD=your-redis-password
TRANSCRIPTION_CONCURRENCY=3
CONTENT_IDEAS_CONCURRENCY=2
```

## Troubleshooting

### **Web Container Issues**

#### 1. `Cannot find module '/app/server.js'`
**Cause:** Missing Next.js standalone build or incorrect copy strategy.
**Solution:** Ensure Dockerfile.web uses:
```dockerfile
COPY --from=builder /app/.next/standalone ./
CMD ["node", "server.js"]
```

#### 2. Web Container Using Full Codebase
**Problem:** Copying entire codebase to web container loses the standalone `server.js`.
**Solution:** Web containers must use standalone build, not full codebase.

### **Worker Container Issues**

#### 1. `ERR_MODULE_NOT_FOUND` for npm packages
**Cause:** Missing dependencies or incomplete codebase copy.
**Solution:** Ensure Dockerfile.worker uses:
```dockerfile
COPY --from=builder --chown=nextjs:nodejs /app ./
```

#### 2. TypeScript Import Extension Errors
**Cause:** Attempting to compile TypeScript instead of running directly.
**Solution:** Use `tsx` to run TypeScript files directly in production.

#### 3. Workers Not Starting
**Cause:** Missing environment variables or Redis connection issues.
**Solution:** Verify all Redis connection variables are set correctly.

### **Common Deployment Issues**

#### 1. Image Not Found or Private
**Causes:**
- Repository is private without proper credentials
- Incorrect image tag or repository name
- Recent push not yet available

**Solutions:**
- Verify repository is public on Docker Hub
- Use exact repository path: `username/repository:tag`
- Try commit-specific tag instead of `latest`

#### 2. Build Failures in GitHub Actions
**Cause:** Missing dummy environment variables during build.
**Solution:** Ensure all required dummy variables are present in builder stage.

## Monitoring and Verification

### **Web Service Logs (Success):**
```
Starting server on port 3000
```

### **Worker Service Logs (Success):**
```
[WorkerInit] Initializing queue workers...
Starting transcription worker with concurrency: 3
Starting content ideas worker with concurrency: 2
Queue workers initialized successfully
Successfully connected to Redis
[Database] Neon Database connected successfully via Drizzle
```

## Architecture Benefits

### **Optimized Web Performance:**
- Smaller image size (Next.js standalone)
- Faster startup time
- Production-optimized server
- No unnecessary development dependencies

### **Flexible Worker Environment:**
- Full codebase access for complex operations
- Direct TypeScript execution with tsx
- Access to all libraries and utilities
- Development-like environment for debugging

### **Scalability:**
- Independent scaling of web and worker containers
- Separation of concerns
- Different resource requirements can be met appropriately

### **Maintainability:**
- Clear distinction between serving and processing roles
- Optimized for each container's specific purpose
- Easier debugging with appropriate tooling for each service

This architecture provides the best of both worlds: efficient web serving with Next.js standalone builds and flexible worker processing with full development environment access. 