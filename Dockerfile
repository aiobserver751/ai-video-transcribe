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

# Install yt-dlp
RUN pip3 install yt-dlp

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
RUN npm run build

# Production image - create a clean runtime image
FROM node:20.18.0-alpine AS runner
WORKDIR /app

# Install only runtime system dependencies (smaller image)
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg

# Install yt-dlp in production image
RUN pip3 install yt-dlp

ENV NODE_ENV production

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

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"] 