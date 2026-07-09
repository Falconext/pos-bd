/**
 * Construcción del documento OpenAPI de la API pública de Logística.
 *
 * Se usa desde dos lugares (mismo resultado):
 *  - `src/main.ts` → montar Swagger UI en el server.
 *  - `scripts/emit-logistica-openapi.ts` → emitir el JSON a disco sin levantar.
 *
 * Scope: SOLO `IntegracionesModule` (los controllers públicos en inglés
 * `v1/logistics/orders` + `v1/logistics/tracking`). NO incluye los controllers
 * internos del ERP en español (pedidos, despachos, conductores…).
 *
 * Normalización: el prefijo interno `/v1/logistics` se recorta de las rutas para
 * que el contrato quede sobre el recurso (`/orders`, `/tracking/{id}`), alineado
 * al `server` público (`https://api.falconext.com/v1`), tal como el portal.
 */
import { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { IntegracionesModule } from '../integraciones/integraciones.module';

export const LOGISTICA_API_VERSION = '2025-07-01';

export function buildLogisticaConfig() {
  return new DocumentBuilder()
    .setTitle('Falconext Logística API')
    .setDescription(
      'API pública de Falconext Logística: crear órdenes de entrega, rastrearlas y recibir webhooks. ' +
        'Contrato en inglés (snake_case). Documentación en español en el portal de desarrolladores.',
    )
    .setVersion(LOGISTICA_API_VERSION)
    .addServer('https://api.falconext.com/v1', 'Producción')
    .addServer('https://sandbox.api.falconext.com/v1', 'Sandbox')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', description: 'API key como Bearer token.' },
      'bearerAuth',
    )
    .addTag('Pedidos', 'Crear, listar, obtener y cancelar órdenes.')
    .addTag('Rastreo', 'Estado y línea de tiempo de una orden.')
    .addTag('Webhooks', 'Suscripción a eventos order.*')
    .build();
}

/** Recorta el prefijo interno `/v1/logistics` de las rutas del documento. */
function normalizarPaths(doc: OpenAPIObject): OpenAPIObject {
  const paths = doc.paths ?? {};
  const nuevos: Record<string, any> = {};
  for (const ruta of Object.keys(paths)) {
    const limpia = ruta.replace(/^\/v1\/logistics/, '') || '/';
    nuevos[limpia] = paths[ruta];
  }
  doc.paths = nuevos;
  return doc;
}

export function buildLogisticaDocument(app: INestApplication): OpenAPIObject {
  const doc = SwaggerModule.createDocument(app, buildLogisticaConfig(), {
    include: [IntegracionesModule],
    deepScanRoutes: true,
  });
  // Seguridad por defecto en todas las operaciones (bearer).
  doc.security = [{ bearerAuth: [] }];
  return normalizarPaths(doc);
}
