## ---------- SINGLE STAGE WITH PUPPETEER SUPPORT ----------
FROM node:20-slim
WORKDIR /app

# Instalar dependencias de Chromium para Puppeteer (siguiendo guía oficial)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxkbcommon0 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    wget \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Configurar Puppeteer para usar Chromium del sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Instalar pnpm globalmente
RUN npm install -g pnpm@9.12.2

# Copiar package files y prisma schema
COPY package.json pnpm-lock.yaml* ./
COPY prisma ./prisma

# Instalar TODAS las dependencias
RUN pnpm install --no-frozen-lockfile

# Copiar código fuente
COPY tsconfig*.json ./
COPY src ./src

# Build de la aplicación
RUN npx nest build

# Generar Prisma client después del build
RUN npx prisma generate

# Configurar producción
ENV NODE_ENV=production

# Crear directorio de datos para Chrome crashpad
RUN mkdir -p /tmp/chrome-data && chmod 777 /tmp/chrome-data

# Usuario no root
RUN groupadd -r appgroup && useradd -r -g appgroup -d /home/appuser -m appuser
RUN chown -R appuser:appgroup /app /tmp/chrome-data

USER appuser
EXPOSE 4000

# Ejecutar migraciones y iniciar aplicación
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node dist/src/main.js"]
