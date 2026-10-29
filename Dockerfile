# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build

WORKDIR /app

# node-pty is a native module; these are only needed if npm has to compile it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# npm ci runs the root postinstall hook, which invokes this script.
COPY bin/prepare-terminal.js ./bin/prepare-terminal.js
RUN npm ci

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOME=/home/node \
    PORT=30141 \
    PI_WEB_HOSTNAME=0.0.0.0 \
    PI_WEB_NO_OPEN=1

# git is used by project tools; bash is needed by the agent's shell tool and terminal.
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /home/node/.pi/agent /home/node/.agents/skills /home/node/pi-cwd \
    && chown -R node:node /home/node/.pi /home/node/.agents /home/node/pi-cwd

WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node

EXPOSE 30141
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}`).then(r => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "bin/pi-web.js"]
