import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  // Nº de intentos y espera entre ellos. En Railway la red privada
  // (`*.railway.internal`, IPv6) puede tardar un instante en estar disponible
  // al arrancar el contenedor, y la DB puede reiniciarse durante un deploy.
  // Reintentar evita que el backend caiga con "Can't reach database server".
  private readonly maxRetries = 10;
  private readonly retryDelayMs = 3000;

  async onModuleInit() {
    await this.connectWithRetry();
  }

  private async connectWithRetry(attempt = 1): Promise<void> {
    try {
      await this.$connect();
      if (attempt > 1) {
        this.logger.log(`Conexión a la base de datos establecida (intento ${attempt}).`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= this.maxRetries) {
        this.logger.error(
          `No se pudo conectar a la base de datos tras ${this.maxRetries} intentos: ${message}`,
        );
        throw error;
      }
      this.logger.warn(
        `Base de datos no disponible (intento ${attempt}/${this.maxRetries}). ` +
          `Reintentando en ${this.retryDelayMs}ms... [${message}]`,
      );
      await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      return this.connectWithRetry(attempt + 1);
    }
  }

  // Cierra el pool de conexiones al recargar en caliente (nest watch) o al
  // apagar la app. Sin esto, cada recarga deja conexiones "idle" colgadas en
  // Postgres que luego el servidor cierra por timeout, provocando el error
  // "Server has closed the connection" (P1017) en la siguiente query.
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
