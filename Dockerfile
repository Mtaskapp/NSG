# ── Stage 1: dependencies ────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
# Use npm ci when a lockfile is present (reproducible builds), otherwise fall
# back to npm install so the build never fails due to a missing lockfile.
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev; \
    else \
      npm install --omit=dev; \
    fi && npm cache clean --force

# ── Stage 2: final image ─────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Non-root user for security
RUN addgroup -S snapbot && adduser -S snapbot -G snapbot

# Copy production deps and source
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=snapbot:snapbot . .

# Create log directory
RUN mkdir -p logs && chown -R snapbot:snapbot logs

USER snapbot

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
