# pi-web — local Docker packaging (not upstream; local addition)
#
# The npm package ships prebuilt Next.js artifacts, so the image just
# installs the global package — no build step needed.
#
# Build:   docker build -t tigerai/pi-web .
# Run:     docker compose up -d        (see docker-compose.yml)

FROM node:22-alpine

ENV NODE_ENV=production

RUN npm install -g @agegr/pi-web@latest

# Run as the unprivileged node user; pi data lives in its home (/home/node).
USER node

# pi-web reads/writes pi config, sessions, and auth under the node user's
# home. Mount the host's ~/.pi/agent onto this path (see docker-compose.yml).
#
# WARNING: mounting host ~/.pi/agent exposes API keys and full session
# history to the container. Only do this for containers you trust.
VOLUME ["/home/node/.pi/agent"]

# Default pi-web port
EXPOSE 30141

# NOTE: container must bind 0.0.0.0 for port mapping to work (set
# PI_WEB_HOSTNAME=0.0.0.0 in the compose file). For any access beyond your
# own machine, also set PI_WEB_PASSWORD to a long random password.
CMD ["pi-web", "--no-open"]
