import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async generateKey(empresaId: number) {
    // Implement API key generation logic
    return { apiKey: 'sk_test_falconext' };
  }

  async validateKey(apiKey: string) {
    // Implement validation logic
    return true;
  }
}
