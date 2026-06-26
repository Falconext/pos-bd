import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
// Force rebuild to regenerate Prisma Client with new schema columns
import { Logger, ValidationPipe } from '@nestjs/common'; // rebuilt
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import * as express from 'express';
import { PrismaService } from './prisma/prisma.service';
import { initializeDatabase } from './common/utils/init-db';
import { httpSecurityHeaders } from './common/security/http-security.middleware';
import { authRateLimit } from './common/security/rate-limit.middleware';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  process.env.TZ = 'America/Lima';
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const app = await NestFactory.create(AppModule, {
    bodyParser: false, // Desactivamos el body parser por defecto
  });
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Configurar límites de payload
  app.use(httpSecurityHeaders(isProduction));
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '10mb' }));
  app.use(
    express.urlencoded({
      extended: true,
      limit: process.env.URLENCODED_BODY_LIMIT || '2mb',
    }),
  );
  app.use(authRateLimit());

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
    'tauri://localhost', // Desktop app
    'https://tauri.localhost', // Desktop app (Windows)
    'https://falconext-mype-production.up.railway.app',
    // Production domains
    'https://falconext.pe',
    'https://www.falconext.pe',
    'https://app.falconext.pe',
    'https://app.krezka.com',
    'https://www.krezka.com',
    // Reseller white-label: Jamble POS (dominio propio del cliente reseller)
    'https://app.jamblepos.com',
    'https://www.jamblepos.com',
    'https://jamblepos.com',
    process.env.FRONTEND_URL,
    ...extraCorsOrigins,
  ].filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman, curl)
      if (!origin) return callback(null, true);

      const isLocalDevelopmentOrigin =
        /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin) ||
        /^https?:\/\/192\.168\.\d+\.\d+(?::\d+)?$/.test(origin) ||
        /^https?:\/\/10\.\d+\.\d+\.\d+(?::\d+)?$/.test(origin) ||
        /^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+(?::\d+)?$/.test(
          origin,
        ) ||
        origin.startsWith('tauri://') ||
        origin.startsWith('capacitor://');

      if (
        allowedOrigins.includes(origin) ||
        (!isProduction && isLocalDevelopmentOrigin)
      ) {
        callback(null, true);
      } else {
        logger.warn(`CORS bloqueado para origin: ${origin}`);
        callback(new Error('Not allowed by CORS'), false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'PATCH', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // whitelist descarta los campos no declarados en el DTO (protege contra
      // mass-assignment). forbidNonWhitelisted los RECHAZA con error 400; lo
      // dejamos desactivado por defecto porque el frontend envía campos de UI
      // (nombres de display, ids de relación) en sus payloads. Para validación
      // estricta, setear VALIDATION_FORBID_EXTRA_FIELDS=true.
      whitelist: true,
      forbidNonWhitelisted:
        process.env.VALIDATION_FORBID_EXTRA_FIELDS === 'true',
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('api');

  const PORT = process.env.PORT ? Number(process.env.PORT) : 4001;

  // Auto-initialize (Seed) if empty
  try {
    logger.log('Validando base de datos inicial...');
    const prismaService = app.get(PrismaService);
    await initializeDatabase(prismaService);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn(`Seed inicial omitido: ${message}`);
  }

  await app.listen(PORT, '0.0.0.0');
  logger.log(`Falconext MYPE API lista en http://localhost:${PORT}/api`);
}
bootstrap();
