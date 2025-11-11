# Multi-stage build for NestJS on Railway
FROM node:20-alpine AS deps
WORKDIR /app
# Install pnpm (preferred) and fallback to npm if needed
RUN corepack enable && corepack prepare pnpm@9.12.2 --activate
# Copy package manifests and Prisma schema BEFORE install so postinstall (prisma generate) succeeds
COPY package.json pnpm-lock.yaml* ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile || npm ci

FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.2 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate Prisma client and build
RUN npx prisma generate
RUN pnpm run build || npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
# Copy package.json to preserve metadata
COPY package.json ./package.json
USER appuser
EXPOSE 4000
# Run migrations on start then launch app
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
