/**
 * El aviso de una visita sin pedido (Hierba Sana, 28-10): decía "viene a ver
 * o a consultar" de un cliente que ya había cotizado 2 productos, y por
 * WhatsApp llegaban dos avisos en un minuto cuando solo completaba la hora.
 */
import { LeadsVisitaService } from './leads-visita.service';

function armar(antes: Record<string, unknown> | null, itemsJson: unknown = [{ productoId: 5, cantidad: 2 }]) {
  const avisos: { titulo: string; mensaje: string }[] = [];
  const prisma = {
    leadConversacion: { findUnique: jest.fn().mockResolvedValue({ nombreProspecto: 'Arturo' }) },
    leadPedidoBorrador: {
      findUnique: jest.fn().mockResolvedValue({ nombre: null, comprobanteId: null, itemsJson }),
    },
    leadVisitaTienda: {
      findUnique: jest.fn().mockResolvedValue(antes),
      upsert: jest.fn().mockResolvedValue({ id: 1, indicacionesEn: new Date() }),
    },
    producto: {
      findMany: jest.fn().mockResolvedValue([{ id: 5, descripcion: 'Pasuchaca Diabetes - OASIS ( 100 capsulas )' }]),
    },
  };
  const notificaciones = {
    notificarAdminsEmpresa: jest.fn(async (a: { titulo: string; mensaje: string }) => {
      avisos.push(a);
    }),
  };
  const svc = new LeadsVisitaService(prisma as never, {} as never, notificaciones as never);
  const registrar = (cuando: string, fecha?: string) =>
    svc.registrar(89, 1036, '51967983909', { cuando, fecha, conPedido: false });
  return { registrar, avisos };
}

const MANANA = new Date(Date.now() + 864e5).toISOString().slice(0, 10);

describe('aviso de visita sin pedido', () => {
  it('con productos cotizados dice cuáles, no "viene a ver"', async () => {
    const { registrar, avisos } = armar(null);
    const r = await registrar('mañana', MANANA);

    expect(avisos[0].mensaje).toMatch(/2x Pasuchaca Diabetes/);
    expect(avisos[0].mensaje).toMatch(/SIN pedido registrado ni stock apartado/);
    expect(avisos[0].mensaje).not.toMatch(/viene a ver/);
    expect(r.notificacion?.titulo).toMatch(/Va a visitar la tienda: Arturo/);
  });

  it('sin nada cotizado sí viene a ver', async () => {
    const { registrar, avisos } = armar(null, null);
    await registrar('mañana', MANANA);
    expect(avisos[0].mensaje).toMatch(/viene a ver o a consultar/);
  });

  it('si solo completa la hora del mismo día, la campana se actualiza pero no se repite el WhatsApp', async () => {
    const { registrar, avisos } = armar({
      indicacionesEn: new Date(),
      cuando: 'mañana',
      fecha: new Date(`${MANANA}T00:00:00Z`),
      actualizadoEn: new Date(Date.now() - 60_000),
    });
    const r = await registrar('mañana a las 2pm', MANANA);

    expect(avisos).toHaveLength(1);
    expect(avisos[0].titulo).toMatch(/Cambió su visita/);
    expect(r.notificacion).toBeUndefined();
  });

  it('si cambia de día, sí va por WhatsApp', async () => {
    const pasado = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
    const { registrar } = armar({
      indicacionesEn: new Date(),
      cuando: 'mañana',
      fecha: new Date(`${MANANA}T00:00:00Z`),
      actualizadoEn: new Date(Date.now() - 60_000),
    });
    const r = await registrar('pasado mañana', pasado);
    expect(r.notificacion?.titulo).toMatch(/Cambió su visita/);
  });
});
