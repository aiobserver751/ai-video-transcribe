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
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ENV NEXTAUTH_SECRET="dummy-secret-for-build"
ENV REDIS_HOST="localhost"
ENV REDIS_PORT="6379"
ENV REDIS_PASSWORD="dummy-password"
ENV GOOGLE_CLIENT_ID="dummy-google-client-id"
ENV GOOGLE_CLIENT_SECRET="dummy-google-client-secret"
ENV NEXTAUTH_URL="http://localhost:3000"

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