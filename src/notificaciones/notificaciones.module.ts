import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificacionesController } from './notificaciones.controller';
import { NotificacionesService } from './notificaciones.service';
import { NotificacionesGateway } from './notificaciones.gateway';
import { InventarioNotificacionesService } from './inventario-notificaciones.service';
import { PrismaModule } from '../prisma/prisma.module';
import { resolveJwtSecret } from '../auth/jwt-secret';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: resolveJwtSecret(config),
        signOptions: { expiresIn: '24h' },
      }),
    }),
  ],
  controllers: [NotificacionesController],
  providers: [
    NotificacionesService,
    NotificacionesGateway,
    InventarioNotificacionesService,
  ],
  exports: [NotificacionesService, InventarioNotificacionesService],
})
export class NotificacionesModule {}
