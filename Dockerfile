# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first for better layer caching
COPY package.json package-lock.json tsconfig.json ./

# Install all dependencies (including devDependencies for the build)
RUN npm ci

# Copy source and compile
COPY src/ ./src/
RUN npm run build

# Remove devDependencies from production install
RUN npm ci --omit=dev

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

LABEL org.opencontainers.image.title="DockerSwarmMCP"
LABEL org.opencontainers.image.description="Model Context Protocol server for Docker Swarm"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Non-root user for least-privilege execution
# Add mcp user to docker group so it can access docker.sock
RUN addgroup -S docker 2>/dev/null || true && \
    addgroup -S mcp && \
    adduser -S -G mcp mcp && \
    addgroup mcp docker

# Copy only what the server needs at runtime
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY package.json ./

USER mcp

# Default: HTTP transport on port 3000, bound to loopback
ENV MCP_TRANSPORT=http \
    PORT=3000 \
    MCP_BIND=127.0.0.1 \
    READ_ONLY=true

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1

CMD ["node", "build/index.js"]
