# syntax=docker/dockerfile:1

# ==========================================
# Stage 1: Build Frontend & Backend Bundle
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package manifests first for layer caching
COPY package.json package-lock.json* ./

# Install dependencies (works with or without package-lock.json)
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy application source
COPY index.html tsconfig.json vite.config.ts server.ts metadata.json ./
COPY src ./src

# Build Vite client bundle -> /app/dist
RUN npm run build

# Bundle Express server entry -> /app/server.mjs
RUN npx esbuild server.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --packages=external \
  --outfile=server.mjs


# ==========================================
# Stage 2: Minimal Production Runtime
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json* ./

# Install runtime dependencies only
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --ignore-scripts; else npm install --omit=dev --ignore-scripts; fi \
  && npm cache clean --force

# Copy compiled frontend & server artifacts owned by node
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server.mjs ./server.mjs

# Run as non-root. No recursive chown: node_modules stays root-owned and read-only at
# runtime, which is fine for this server (it only reads /app and serves dist/).
# If mounting a host kubeconfig, ensure the file is readable by uid 1000.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/k8s/local-status" >/dev/null || exit 1

CMD ["node", "server.mjs"]
