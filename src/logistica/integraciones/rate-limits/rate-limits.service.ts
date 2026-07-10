import { Injectable } from '@nestjs/common';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number; // segundos hasta que se reinicia la ventana
}

/**
 * Rate limiter por API key, ventana fija de 1 minuto (contrato: 600 GET / 120
 * escritura por minuto). In-memory: simple y suficiente para una instancia. Si
 * se escala a múltiples instancias, migrar a Redis (misma interfaz).
 */
@Injectable()
export class RateLimitsService {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private readonly windowMs = 60_000;

  private limitePorMetodo(method: string): number {
    return method.toUpperCase() === 'GET' ? 600 : 120;
  }

  consume(apiKeyId: string, method: string): RateLimitResult {
    const limit = this.limitePorMetodo(method);
    const bucketKey = `${apiKeyId}:${method.toUpperCase() === 'GET' ? 'read' : 'write'}`;
    const now = Date.now();
    let b = this.buckets.get(bucketKey);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(bucketKey, b);
    }
    b.count += 1;
    const remaining = Math.max(0, limit - b.count);
    const reset = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    return { allowed: b.count <= limit, limit, remaining, reset };
  }

  /** Compat con la firma anterior (no usada por el guard nuevo). */
  async checkLimit(_empresaId: number, _endpoint: string) {
    return { allowed: true };
  }
}
