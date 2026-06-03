# ============================================
# Stage 1: Build (bun)
# ============================================
FROM docker.m.daocloud.io/oven/bun:1.3 AS builder
WORKDIR /app

# Install dependencies (faster with bun)
COPY package.json package-lock.json ./
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build with standalone output
ENV NEXT_OUTPUT=standalone
RUN bun run build

# ============================================
# Stage 2: Runtime (node, for max compatibility)
# ============================================
FROM docker.m.daocloud.io/node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=30141
ENV HOSTNAME=0.0.0.0

# pi agent stores sessions and config at $HOME/.pi/agent/
RUN addgroup --system --gid 1001 piweb && \
    adduser --system --uid 1001 piweb && \
    mkdir -p /home/piweb/.pi/agent && \
    chown -R piweb:piweb /app /home/piweb

# Copy standalone server
COPY --from=builder /app/.next/standalone ./

# Standalone's minimal node_modules misses some transitive deps (e.g. undici).
# Overwrite with the full node_modules to ensure everything is available.
COPY --from=builder /app/node_modules ./node_modules

# Copy static assets
COPY --from=builder /app/.next/static ./.next/static

# Copy public files
COPY --from=builder /app/public ./public

# Use non-root user
USER piweb

VOLUME /home/piweb/.pi/agent

EXPOSE 30141

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:30141/api/models || exit 1

CMD ["node", "server.js"]
