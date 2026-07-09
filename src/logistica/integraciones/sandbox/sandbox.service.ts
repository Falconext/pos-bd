import { Injectable } from '@nestjs/common';

@Injectable()
export class SandboxService {
  isSandboxMode(req: any): boolean {
    return req.headers['x-sandbox-mode'] === 'true';
  }

  mockOrderResponse(payload: any) {
    return {
      status: 'success',
      mocked: true,
      data: payload,
    };
  }
}
