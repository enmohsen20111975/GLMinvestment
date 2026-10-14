# ============================================================================
# GLMinvestment — Next.js Production Dockerfile
# P3 FIX (2026-10-14): Multi-stage build for containerized production.
# ============================================================================
# Usage:
#   docker build -t glminvestment-web .
#   docker run -p 3000:3000 --env-file .env.production glminvestment-web
#
# NOTE: This Dockerfile only containerizes the Next.js app.
# Python backend, data-engine, ws-service, telegram-events, and news-agent
# run as separate PM2 services or separate containers (see vps-service/Dockerfile).
# ============================================================================

# ─── Stage 1: Dependencies ──────────────────────────────────────────────────
FROM node:20-slim AS deps
WORKDIR /app

# Install bun for faster installs
RUN npm install -g bun

# Copy lockfile + package.json
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile || bun install

# ─── Stage 2: Build ─────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

RUN npm install -g bun

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma clients (3 schemas)
RUN bunx prisma generate
RUN bunx prisma generate --schema=prisma/auth-schema.prisma
RUN bunx prisma generate --schema=prisma/predictions-schema.prisma

# Build Next.js (skip lint — CI handles it separately)
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS='--max-old-space-size=4096'
RUN bun run build

# ─── Stage 3: Production ────────────────────────────────────────────────────
FROM node:20-slim AS production
WORKDIR /app

# Install only production dependencies
RUN npm install -g bun
COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile || bun install --production

# Copy built artifacts
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Environment
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/api/keepalive || exit 1

# Start
CMD ["bun", "run", "start"]
