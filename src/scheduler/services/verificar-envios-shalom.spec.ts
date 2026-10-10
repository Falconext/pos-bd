/**
 * Selección de envíos para el rastreo automático de Shalom.
 *
 * Un despacho de Shalom se crea ANTES de generar la guía, así que su número de
 * orden y su clave quedan en cadena vacía hasta que el empresario la emite. El
 * filtro pedía `not: null`, que a una cadena vacía la deja pasar: esos envíos
 * entraban a cada corrida, fallaban al consultar Shalom y nunca grababan
 * `shalomSyncAt`. Como la cola ordena "los nunca sincronizados primero", se
 * quedaban de primeros para siempre y copaban las plazas de la corrida, dejando
 * sin revisar a los envíos que sí tenían datos (en producción: 264 rotos contra
 * 230 buenos que nunca se procesaron).
 */
import { VerificarEnviosShalomService } from './verificar-envios-shalom.service';

function armar() {
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma: any = { envioDespacho: { findMany } };
  const noop: any = new Proxy({}, { get: () => jest.fn() });
  const service = new VerificarEnviosShalomService(prisma, noop, noop, noop);
  return { service, findMany };
}

/** Aplana el `where` a una lista de condiciones comparables. */
function condiciones(where: any): string[] {
  const out: string[] = [];
  for (const [campo, valor] of Object.entries(where ?? {})) {
    if (campo === 'AND' && Array.isArray(valor)) {
      valor.forEach((c) => out.push(...condiciones(c)));
    } else {
      out.push(`${campo}=${JSON.stringify(valor)}`);
    }
  }
  return out;
}

describe('Rastreo automático de Shalom · a quién consulta', () => {
  it('exige número de orden con contenido, no solo distinto de null', async () => {
    const { service, findMany } = armar();
    await service.execute();
    const cond = condiciones(findMany.mock.calls[0][0].where);
    expect(cond).toContain('nroOrden={"not":null}');
    expect(cond).toContain('nroOrden={"not":""}');
  });

  it('exige clave con contenido, no solo distinta de null', async () => {
    const { service, findMany } = armar();
    await service.execute();
    const cond = condiciones(findMany.mock.calls[0][0].where);
    expect(cond).toContain('claveOrden={"not":null}');
    expect(cond).toContain('claveOrden={"not":""}');
  });

  it('solo mira couriers de Shalom: el reparto propio no se auto-rastrea', async () => {
    const { service, findMany } = armar();
    await service.execute();
    const { where } = findMany.mock.calls[0][0];
    expect(where.transportista.in).toEqual(
      expect.arrayContaining(['SHALOM_PRO', 'SHALOM_COD']),
    );
    expect(where.transportista.in).not.toContain('PROPIOS');
    expect(where.transportista.in).not.toContain('OLVA');
  });

  it('no vuelve a consultar lo ya entregado', async () => {
    const { service, findMany } = armar();
    await service.execute();
    expect(findMany.mock.calls[0][0].where.shalomEntregado).toBe(false);
  });

  it('respeta el opt-in de la empresa', async () => {
    const { service, findMany } = armar();
    await service.execute();
    const { where } = findMany.mock.calls[0][0];
    expect(where.comprobante.empresa.shalomAutoTrackingActivo).toBe(true);
  });
});
