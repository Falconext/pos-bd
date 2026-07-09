import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class IntegrationLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async logEvent(empresaId: number, type: string, payload: any, error?: string) {
    // Implement logging to DB or external logging service
  }
}
