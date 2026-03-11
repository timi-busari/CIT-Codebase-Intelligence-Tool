FROM node:20-alpine AS base

# tree-sitter native bindings need build tools
RUN apk add --no-cache python3 make g++ git

WORKDIR /app

# ── Install dependencies ────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# ── Build ────────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── Production ───────────────────────────────────────────────────────────────
FROM base AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# SQLite data and cloned repos directories
RUN mkdir -p /app/data /tmp/cit-repos

EXPOSE 4001

CMD ["node", "dist/main"]
