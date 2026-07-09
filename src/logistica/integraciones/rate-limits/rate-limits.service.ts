import { Injectable } from '@nestjs/common';

@Injectable()
export class RateLimitsService {
  async checkLimit(empresaId: number, endpoint: string) {
    // Implement rate limiting logic (e.g. Redis based)
    return { allowed: true };
  }
}
