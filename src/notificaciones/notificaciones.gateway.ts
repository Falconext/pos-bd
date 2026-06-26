import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { resolveJwtSecret } from '../auth/jwt-secret';

const allowedSocketOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
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
  ...(process.env.CORS_EXTRA_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
].filter(Boolean);

function isAllowedSocketOrigin(origin?: string): boolean {
  if (!origin) return true;
  if (allowedSocketOrigins.includes(origin)) return true;
  if (process.env.NODE_ENV === 'production') return false;
  return (
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin) ||
    /^https?:\/\/192\.168\.\d+\.\d+(?::\d+)?$/.test(origin) ||
    /^https?:\/\/10\.\d+\.\d+\.\d+(?::\d+)?$/.test(origin) ||
    /^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+(?::\d+)?$/.test(origin)
  );
}

@WebSocketGateway({
  cors: {
    origin: (origin, callback) => {
      if (isAllowedSocketOrigin(origin)) return callback(null, true);
      callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
  },
})
export class NotificacionesGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificacionesGateway.name);
  private usuariosConectados = new Map<number, string[]>(); // usuarioId -> socketIds[]

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token;

      if (!token) {
        client.disconnect();
        return;
      }

      const secret = resolveJwtSecret(this.configService);
      const payload = await this.jwtService.verifyAsync(token, { secret });

      const usuarioId = payload.sub;
      client.data.usuarioId = usuarioId;

      // Agregar socket a la lista de conexiones del usuario
      if (!this.usuariosConectados.has(usuarioId)) {
        this.usuariosConectados.set(usuarioId, []);
      }
      this.usuariosConectados.get(usuarioId)!.push(client.id);

      this.logger.debug(
        `Usuario ${usuarioId} conectado (socket: ${client.id})`,
      );
      this.logger.debug(`Usuarios conectados: ${this.usuariosConectados.size}`);
    } catch (error) {
      this.logger.warn('Error en autenticacion WebSocket');
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const usuarioId = client.data.usuarioId;

    if (usuarioId && this.usuariosConectados.has(usuarioId)) {
      const sockets = this.usuariosConectados.get(usuarioId);

      if (sockets) {
        const index = sockets.indexOf(client.id);

        if (index > -1) {
          sockets.splice(index, 1);
        }

        if (sockets.length === 0) {
          this.usuariosConectados.delete(usuarioId);
        }
      }

      this.logger.debug(
        `Usuario ${usuarioId} desconectado (socket: ${client.id})`,
      );
      this.logger.debug(`Usuarios conectados: ${this.usuariosConectados.size}`);
    }
  }

  // Enviar notificación a un usuario específico
  enviarNotificacionAUsuario(usuarioId: number, notificacion: any) {
    const sockets = this.usuariosConectados.get(usuarioId);

    if (sockets && sockets.length > 0) {
      sockets.forEach((socketId) => {
        this.server.to(socketId).emit('nueva-notificacion', notificacion);
      });
      console.log(
        `📬 Notificación enviada a usuario ${usuarioId} (${sockets.length} conexiones)`,
      );
    } else {
      console.log(`⚠️ Usuario ${usuarioId} no está conectado`);
    }
  }

  // Enviar notificación a múltiples usuarios
  enviarNotificacionAUsuarios(usuariosIds: number[], notificacion: any) {
    usuariosIds.forEach((usuarioId) => {
      this.enviarNotificacionAUsuario(usuarioId, notificacion);
    });
  }

  // Broadcast a todos los usuarios conectados
  enviarNotificacionATodos(notificacion: any) {
    this.server.emit('nueva-notificacion', notificacion);
    console.log(`📢 Notificación broadcast a todos los usuarios`);
  }
}
