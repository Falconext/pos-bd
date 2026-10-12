/**
 * Cerrar un turno de caja que quedó abierto de un día anterior.
 *
 * Caso real (LA DESPENSA HM E.I.R.L., 10 de octubre): abrieron caja a las 17:18
 * y nunca la cerraron. Al día siguiente el cajero no veía nada que cerrar y
 * tampoco veía la caja abierta — `verificarCajaAbierta` solo mira HOY, así que
 * el turno quedaba abierto para siempre y sin forma de cuadrarlo desde la
 * pantalla. Sus ventas sí se contabilizaban; lo que no existía era el arqueo.
 *
 * Lo que de verdad importa acá es la VENTANA: el arqueo de ese turno tiene que
 * mirar el día del turno, no los días que pasaron hasta que alguien se acordó
 * de cerrarlo. Con la ventana abierta hasta "ahora", las ventas de los días
 * siguientes entrarían al esperado y producirían una diferencia inventada.
 */
import { CajaService } from './caja.service';

describe('Cerrar un turno pendiente de un día anterior', () => {
  const APERTURA = {
    id: 835,
    // 10/10 22:18 UTC = 17:18 hora Lima. Es el dato real del caso.
    fecha: new Date('2026-10-10T22:18:17.674Z'),
    tipoMovimiento: 'APERTURA',
    estado: 'ACTIVO',
    montoInicial: 0,
    turno: 'TARDE',
    sedeId: 67,
    usuarioId: 81,
    empresaId: 56,
  };

  const montarService = (over: { cierreExistente?: any; apertura?: any } = {}) => {
    const prisma = {
      movimientoCaja: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(
            where?.tipoMovimiento === 'CIERRE'
              ? (over.cierreExistente ?? null)
              : over.apertura !== undefined
                ? over.apertura
                : APERTURA,
          ),
        ),
      },
    };
    return { service: new CajaService(prisma as any), prisma };
  };

  const buscar = (
    service: CajaService,
    args: Partial<{
      aperturaId: number;
      empresaId: number;
      usuarioId: number;
      sedeId: number;
      rol: string;
    }> = {},
  ) =>
    (service as any).buscarTurnoPendiente(
      args.aperturaId ?? 835,
      args.empresaId ?? 56,
      args.usuarioId ?? 81,
      args.sedeId ?? 67,
      args.rol,
    );

  describe('la ventana del arqueo', () => {
    it('termina al cierre del día del turno, no cuando se cuadra', () => {
      const { service } = montarService();
      const fin = (service as any).finDelDiaLima(APERTURA.fecha);
      // 10/10 23:59:59.999 hora Lima = 11/10 04:59:59.999 UTC.
      expect(fin.toISOString()).toBe('2026-10-11T04:59:59.999Z');
    });

    it('un turno abierto de noche sigue perteneciendo a SU día', () => {
      const { service } = montarService();
      // 23:40 hora Lima del 10 (= 11/10 04:40 UTC): el día es el 10, no el 11.
      const fin = (service as any).finDelDiaLima(
        new Date('2026-10-11T04:40:00.000Z'),
      );
      expect(fin.toISOString()).toBe('2026-10-11T04:59:59.999Z');
    });
  });

  describe('quién puede cerrarlo', () => {
    it('lo cierra quien lo abrió', async () => {
      const { service } = montarService();
      await expect(buscar(service, { usuarioId: 81 })).resolves.toMatchObject({
        id: 835,
      });
    });

    it('un administrador puede cerrar el turno de otro', async () => {
      const { service } = montarService();
      await expect(
        buscar(service, { usuarioId: 999, rol: 'ADMIN_EMPRESA' }),
      ).resolves.toMatchObject({ id: 835 });
    });

    it('otro cajero no: ese arqueo no es suyo', async () => {
      const { service } = montarService();
      await expect(
        buscar(service, { usuarioId: 999, rol: 'USUARIO_EMPRESA' }),
      ).rejects.toThrow(/otra persona/i);
    });
  });

  describe('qué se niega a cerrar', () => {
    it('un turno que ya tiene cierre, para no duplicar el arqueo', async () => {
      const { service } = montarService({ cierreExistente: { id: 900 } });
      await expect(buscar(service)).rejects.toThrow(/ya tiene un cierre/i);
    });

    it('un turno que no existe o ya no está activo', async () => {
      const { service } = montarService({ apertura: null });
      await expect(buscar(service)).rejects.toThrow(/no se encontró/i);
    });
  });

  it('el turno pendiente se busca por id, sin filtrar por el día de hoy', async () => {
    const { service, prisma } = montarService();
    await buscar(service);
    const where = prisma.movimientoCaja.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      id: 835,
      empresaId: 56,
      tipoMovimiento: 'APERTURA',
      estado: 'ACTIVO',
    });
    // Si filtrara por fecha volveríamos al bug: el turno de un día anterior
    // dejaría de encontrarse justo cuando hace falta encontrarlo.
    expect(where.fecha).toBeUndefined();
  });
});
