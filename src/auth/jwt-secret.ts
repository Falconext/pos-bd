import type { ConfigService } from '@nestjs/config';

export function resolveJwtSecret(config: ConfigService): string {
  const nodeEnv =
    config.get<string>('NODE_ENV') || process.env.NODE_ENV || 'development';
  const secret = config.get<string>('JWT_SECRET') || process.env.JWT_SECRET;

  if (nodeEnv === 'production' && (!secret || secret.length < 32)) {
    throw new Error(
      'JWT_SECRET debe existir y tener al menos 32 caracteres en produccion.',
    );
  }

  return secret || 'dev-only-falconext-jwt-secret-change-me';
}
