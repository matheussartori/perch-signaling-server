# Perch signaling server — a tiny WebSocket rendezvous. Deploy anywhere that
# gives it a PORT and terminates TLS in front (Koyeb, Fly, Render, Railway, or a
# VPS behind Caddy/nginx). It brokers WebRTC handshakes only; media stays P2P.
FROM node:22-alpine
WORKDIR /app

# Install deps first for layer caching. tsx is a runtime dep here (we run TS
# directly), so --omit=dev keeps it while dropping only the type-only packages.
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

# Platforms inject their own PORT; this is just the local/default fallback.
# Koyeb sets PORT automatically — index.ts reads process.env.PORT.
ENV PORT=8787
EXPOSE 8787

# Lightweight liveness probe for platforms that support HEALTHCHECK. The server
# answers GET /healthz on the same port the WebSocket upgrades ride on.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1

CMD ["npm", "start"]
