import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class WebhooksService {
  constructor(private readonly prisma: PrismaService) {}

  async dispatchEvent(empresaId: number, event: string, payload: any) {
    // Implement webhook dispatch logic here
    // Supported events: delivery.created, delivery.assigned, delivery.started, delivery.arrived, delivery.completed, delivery.failed, delivery.returned, delivery.cancelled
    return { success: true, event };
  }
}
