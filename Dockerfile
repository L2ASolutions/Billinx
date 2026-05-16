# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install deps first (layer-cached unless package files change)
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source and compile
COPY tsconfig*.json nest-cli.json ./
COPY prisma ./prisma/
COPY packages ./packages/
COPY src ./src/

RUN npx prisma generate
RUN npm run build

# Prune dev dependencies
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:20-alpine AS production

LABEL org.opencontainers.image.title="Billinx API"
LABEL org.opencontainers.image.description="Nigeria FIRS/NRS e-Invoicing Compliance API"
LABEL org.opencontainers.image.vendor="L2A Solutions Ltd"

# Security: run as non-root
RUN addgroup -S billinx && adduser -S billinx -G billinx

WORKDIR /app

# Copy compiled output and production node_modules from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/package.json ./package.json

# Drop to non-root user
USER billinx

EXPOSE 3000

# Health check — matches the /health endpoint added to the app
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
