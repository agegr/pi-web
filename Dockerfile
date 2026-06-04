# ============================================
# Stage 1: Build
# ============================================
FROM docker.m.daocloud.io/node:22-alpine AS builder
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY . .

# Build with standalone output
ENV NEXT_OUTPUT=standalone
RUN npm run build

# ============================================
# Stage 2: Runtime
# ============================================
FROM docker.m.daocloud.io/node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=30141
ENV HOSTNAME=0.0.0.0

# Install git + gh for agent use
RUN apk add --no-cache git openssh su-exec && \
    addgroup --system --gid 1001 piweb && \
    adduser --system --uid 1001 piweb && \
    mkdir -p /home/piweb/.pi/agent && \
    chown -R piweb:piweb /app /home/piweb

# Copy standalone server
COPY --from=builder /app/.next/standalone ./

# Copy full node_modules (standalone's minimal set misses some deps like undici)
COPY --from=builder /app/node_modules ./node_modules

# Copy static assets
COPY --from=builder /app/.next/static ./.next/static

# Copy public files
COPY --from=builder /app/public ./public

VOLUME /home/piweb/.pi/agent

EXPOSE 30141

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:30141/api/models || exit 1

# Entrypoint: fix volume permissions as root, then drop to piweb
COPY --chmod=755 <<'EOF' /entrypoint.sh
#!/bin/sh
chown -R piweb:piweb /home/piweb/.pi/agent
exec su-exec piweb "$@"
EOF

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
