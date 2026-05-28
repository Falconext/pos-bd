import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
// Force rebuild to regenerate Prisma Client with new schema columns
import { ValidationPipe } from '@nestjs/common'; // rebuilt
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import * as express from 'express';
import { PrismaService } from './prisma/prisma.service';
import { initializeDatabase } from './common/utils/init-db';

async function bootstrap() {
  process.env.TZ = 'America/Lima';
  const app = await NestFactory.create(AppModule, {
    bodyParser: false, // Desactivamos el body parser por defecto
  });

  // Configurar límites de payload
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  const extraCorsOrigins = String(process.env.CORS_EXTRA_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  // CORS configuration - supports both local and production environments
  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'http://app.jamble.peru:5174',
    'https://app.jamble.peru',
    'http://192.168.100.16:4000',
    'tauri://localhost',  // Desktop app
    'https://tauri.localhost',  // Desktop app (Windows)
    'https://falconext-mype-production.up.railway.app',
    // Production domains
    'https://falconext.pe',
    'https://www.falconext.pe',
    'https://app.falconext.pe',
    'https://app.krezka.com',
    'https://www.krezka.com',
    process.env.FRONTEND_URL,
    ...extraCorsOrigins,
  ].filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman, curl)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`CORS: Origin ${origin} not allowed`);
        callback(null, true); // Allow temporarily for desktop/debugging
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'PATCH', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('api');

  const PORT = process.env.PORT ? Number(process.env.PORT) : 4001;

  // Auto-initialize (Seed) if empty
  try {
    const prismaService = app.get(PrismaService);
    await initializeDatabase(prismaService);
  } catch (e) {
    console.warn('Skipping auto-seed:', e.message);
  }

  await app.listen(PORT, '0.0.0.0');
}
bootstrap();
