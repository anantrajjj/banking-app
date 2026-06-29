# =============================================================================
# SecureBank API — multi-stage Dockerfile
#
# Stages:
#   deps     — install production-only node_modules (builds bcrypt native binding)
#   build    — install all deps + compile TypeScript to dist/
#   production — minimal runtime image (Debian slim for glibc compat with bcrypt)
# =============================================================================

# ── Stage 1: production dependencies (native compile) ────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Build tools required by bcrypt's native binding
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --omit=dev --prefer-offline

# ── Stage 2: compile TypeScript ───────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --prefer-offline

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ── Stage 3: production runtime ───────────────────────────────────────────────
FROM node:20-alpine AS production

# curl is required for the ECS container health check
RUN apk add --no-cache curl

WORKDIR /app

# Bring in compiled output and production dependencies
COPY --from=build /app/dist           ./dist
COPY --from=deps  /app/node_modules   ./node_modules
COPY              package.json        ./

# Run as a non-root user — never run untrusted code as root in production
RUN addgroup -S appgroup && \
    adduser  -S appuser -G appgroup && \
    chown -R appuser:appgroup /app

USER appuser

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# ECS registers tasks as unhealthy if this fails after startPeriod (60 s)
HEALTHCHECK \
  --interval=30s \
  --timeout=5s \
  --start-period=60s \
  --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/app.js"]
