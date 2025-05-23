# Use Node.js official image with the correct version
FROM node:20.18.0-alpine AS base

# Install system dependencies including Python and build tools
RUN apk add --no-cache \
    python3 \
    py3-pip \
    make \
    g++ \
    gcc \
    musl-dev \
    linux-headers \
    curl \
    wget \
    git \
    ffmpeg

# Install yt-dlp using the recommended method for Alpine
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
RUN chmod a+rx /usr/local/bin/yt-dlp

# Verify installations
RUN ffmpeg -version && ffprobe -version && yt-dlp --version

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set dummy environment variables for build process
# OpenAI/AI Configuration
ENV OPENAI_API_KEY="sk-dummy-openai-api-key-for-build"
ENV OPENAI_MODEL_NAME="gpt-4"
ENV GROQ_API_KEY="gsk_dummy-groq-api-key-for-build"

# App Configuration
ENV NEXT_PUBLIC_APP_URL="http://localhost:3000"
ENV NEXT_PUBLIC_MAX_FILE_SIZE="104857600"

# Database
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"

# Redis/Queue Configuration
ENV REDIS_HOST="localhost"
ENV REDIS_PORT="6379"
ENV REDIS_PASSWORD="dummy-password"
ENV ENABLE_QUEUE_WORKERS="false"
ENV TRANSCRIPTION_CONCURRENCY="2"
ENV CONTENT_IDEAS_CONCURRENCY="1"

# Local Storage
ENV LOCAL_STORAGE_PATH="/tmp/uploads"

# Authentication
ENV GOOGLE_CLIENT_ID="dummy-google-client-id"
ENV GOOGLE_CLIENT_SECRET="dummy-google-client-secret"
ENV AUTH_SECRET="dummy-secret-for-build"
ENV NEXTAUTH_URL="http://localhost:3000"

# Stripe Configuration
ENV STRIPE_SECRET_KEY="sk_test_dummy_key_for_build"
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_dummy_publishable_key"
ENV STRIPE_WEBHOOK_SECRET="whsec_dummy_webhook_secret"
ENV NEXT_PUBLIC_STRIPE_PRICE_ID_STARTER="price_dummy_starter"
ENV NEXT_PUBLIC_STRIPE_PRICE_ID_PRO="price_dummy_pro"

# Credits System
ENV CREDITS_FREE="100"
ENV CREDITS_STARTER="1000"
ENV CREDITS_PRO="5000"
ENV FREE_TIER_INITIAL_CREDITS="100"
ENV FREE_TIER_REFRESH_CREDITS="50"
ENV FREE_TIER_REFRESH_INTERVAL_DAYS="30"
ENV FREE_TIER_MAX_CREDITS="200"
ENV STARTER_TIER_MONTHLY_CREDITS="1000"
ENV PRO_TIER_MONTHLY_CREDITS="5000"

# Credit Costs
ENV CREDITS_CAPTION_FIRST_FIXED="10"
ENV CREDITS_PER_10_MIN_STANDARD="5"
ENV CREDITS_PER_10_MIN_PREMIUM="10"
ENV CREDITS_BASIC_SUMMARY_FIXED="15"
ENV CREDITS_EXTENDED_SUMMARY_FIXED="25"

# Content Ideas Credit Costs
ENV CONTENT_IDEA_NORMAL_CREDIT_COST="20"
ENV CONTENT_IDEA_COMMENT_SMALL_CREDIT_COST="25"
ENV CONTENT_IDEA_COMMENT_MEDIUM_CREDIT_COST="35"
ENV CONTENT_IDEA_COMMENT_LARGE_CREDIT_COST="50"
ENV CONTENT_IDEA_COMMENT_XLARGE_CREDIT_COST="75"

# YouTube Configuration
ENV MAX_YOUTUBE_COMMENTS_TO_FETCH="500"
ENV MIN_YOUTUBE_COMMENTS_FOR_ANALYSIS="10"

# Prompt Templates
ENV PROMPT_TEMPLATE_CONTENT_IDEAS_NORMAL_PATH="/prompts/content-ideas-normal.txt"
ENV PROMPT_TEMPLATE_CONTENT_IDEAS_YT_COMMENTS_PATH="/prompts/content-ideas-yt-comments.txt"
ENV PROMPT_TEMPLATE_BASIC_SUMMARY_PATH="/prompts/basic-summary.txt"
ENV PROMPT_TEMPLATE_EXTENDED_SUMMARY_PATH="/prompts/extended-summary.txt"

# Local/Cron
ENV LOCAL_CRON_SCRIPT_SECRET="dummy-cron-secret"

# S3 Configuration
ENV S3_ENDPOINT_URL="https://dummy-endpoint.com"
ENV S3_ACCESS_KEY="dummy-access-key"
ENV S3_SECRET_KEY="dummy-secret-key"
ENV S3_BUCKET_NAME="dummy-bucket"
ENV S3_REGION="us-east-1"

# Skip static generation during build to avoid database connections
ENV SKIP_STATIC_GENERATION="true"
ENV NEXT_TELEMETRY_DISABLED="1"
ENV DISABLE_STATIC_GENERATION="true"

RUN npm run build

# Production image - create a clean runtime image
FROM node:20.18.0-alpine AS runner
WORKDIR /app

# Install only runtime system dependencies
RUN apk add --no-cache \
    python3 \
    ffmpeg

# Copy yt-dlp binary from the base stage
COPY --from=base /usr/local/bin/yt-dlp /usr/local/bin/yt-dlp

ENV NODE_ENV=production

# Create user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy the public folder
COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Copy the build output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"] 