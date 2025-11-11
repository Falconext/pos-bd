## ---------- SINGLE STAGE ----------
FROM node:20-alpine
WORKDIR /app

# Instalar pnpm
RUN corepack enable && corepack prepare pnpm@9.12.2 --activate

# Copiar package files y prisma schema
COPY package.json pnpm-lock.yaml* ./
COPY prisma ./prisma

# Instalar TODAS las dependencias (incluye devDependencies para build)
RUN pnpm install --no-frozen-lockfile

# Copiar código fuente
COPY tsconfig*.json ./
COPY src ./src

# Build de la aplicación (usar pnpm exec para asegurar que nest esté disponible)
RUN pnpm exec nest build

# Ahora configurar para producción
ENV NODE_ENV=production

# Usuario no root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app

USER appuser
EXPOSE 4000

# Ejecutar migraciones y iniciar aplicación
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
