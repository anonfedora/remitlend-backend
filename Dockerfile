# Builder Stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install all dependencies including devDependencies needed for tsc
COPY package*.json ./
RUN npm ci

# Copy source and compile
COPY tsconfig.json tsconfig.build.json ./
COPY migrations ./migrations
COPY src ./src
RUN npm run build

# Production Stage
FROM node:22-alpine AS production

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist
COPY migrations ./migrations

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3001

# Healthcheck: probe the /health endpoint on the exposed port.
# `wget` is bundled in busybox on the alpine image, so no extra packages are
# required. `--spider` performs a HEAD-style check without downloading the
# response body and exits non-zero for any HTTP 4xx/5xx (including our 503
# "degraded" response) or network failure, which Docker correctly reports as
# unhealthy. `--timeout=8` is a defense-in-depth bound so `wget` exits cleanly
# before Docker's `--timeout=10s` SIGKILL kicks in.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --spider --quiet --tries=1 --timeout=8 http://127.0.0.1:3001/health || exit 1

CMD ["node", "dist/index.js"]  
