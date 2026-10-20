/**
 * Avisar a la tienda que el cliente va a pasar a recoger.
 *
 * El caso que lo pidió, de Hierba Sana: un señor de SJL dijo que el envío de
 * S/ 15 le salía caro, que iba a pasar por la tienda, y al día siguiente
 * avisó que llegaba a las 2 p. m. El agente le contestó "sí, tenemos stock
 * asegurado para mañana" — y en el negocio NADIE sabía que venía ni por qué
 * producto. El recojo existía como zona de envío y se contaba en los
 * reportes, pero no había forma de registrar la visita.
 *
 * Lo que se defiende acá:
 *   1. que el aviso llegue con producto, cantidad y cuándo viene;
 *   2. que diga que el stock NO está apartado, porque eso lo decide el
 *      negocio —una reserva automática apartaría producto de gente que no
 *      viene, y en la tienda el stock es limitado;
 *   3. que no se mande el mismo aviso dos veces, pero sí cuando cambia el día;
 *   4. que no se avise una visita de la nada, sin nada cotizado.
 */
import { LeadsPedidoService } from './leads-pedido.service';
import { CONFIG_ENVIO_HIERBA_SANA } from './envio-zonas';
import { REGLAS_HIERBA_SANA } from './reglas-descuento';

const EMPRESA = 89;
const CONV = 212;
const TELEFONO = '51987654321';

const BORRADOR_RECOJO = {
  tipoZona: 'RECOJO',
  zona: 'Recojo en tienda',
  lugar: 'Recojo en tienda',
  nombre: 'Luis Gamarra',
  horario: null,
  itemsJson: [{ productoId: 1, cantidad: 1 }],
};

function armar(
  borradorInicial: Record<string, unknown> | null = BORRADOR_RECOJO,
) {
  let borrador = borradorInicial ? { ...borradorInicial } : null;
  const avisos: any[] = [];

  const prisma: any = {
    empresa: {
      findUnique: jest.fn().mockResolvedValue({
        iaVentasConfigJson: {
          envio: CONFIG_ENVIO_HIERBA_SANA,
          descuento: REGLAS_HIERBA_SANA,
        },
      }),
    },
    leadPedidoBorrador: {
      findUnique: jest.fn(() => Promise.resolve(borrador)),
      update: jest.fn(({ data }: any) => {
        borrador = { ...(borrador ?? {}), ...data } as any;
        return Promise.resolve(borrador);
      }),
    },
    producto: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          {
            id: 1,
            descripcion: 'Mashua_curaprostata - NATURAL MEDIX (100 caps)',
          },
        ]),
    },
  };
  const notificaciones: any = {
    notificarAdminsEmpresa: jest.fn((a: any) => {
      avisos.push(a);
      return Promise.resolve();
    }),
  };

  const servicio = new LeadsPedidoService(
    prisma,
    {} as never,
    {} as never,
    notificaciones,
  );
  // La nota del recojo se arma con registrarPedido, que tiene su propia spec.
  const registrar = jest
    .spyOn(servicio, 'registrarPedido')
    .mockResolvedValue({ registrado: true, pedido: 'NV01-00000099', montoAPagar: 7 });
  return {
    registrar,
    avisar: (cuando: string) =>
      servicio.avisarVisitaTienda(EMPRESA, CONV, TELEFONO, cuando),
    avisos,
    borradorActual: () => borrador,
  };
}

describe('visita a la tienda', () => {
  it('avisa con el producto, la cantidad y cuándo viene', async () => {
    const { avisar, avisos } = armar();
    const res = await avisar('mañana a las 2 de la tarde');

    expect(res.avisado).toBe(true);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].titulo).toContain('Luis Gamarra');
    expect(avisos[0].mensaje).toContain('mañana a las 2 de la tarde');
    expect(avisos[0].mensaje).toMatch(/1x Mashua/);
    expect(avisos[0].mensaje).toContain(TELEFONO);
  });

  it('deja claro que el stock NO quedó apartado', async () => {
    // Es la mitad del valor del aviso: el negocio decide si lo separa.
    const { avisar, avisos } = armar();
    await avisar('el sábado por la mañana');

    expect(avisos[0].mensaje).toMatch(/SIN RESERVA/);
    expect(avisos[0].mensaje).toMatch(/no está apartado/i);
  });

  it('guarda cuándo viene, para que no se pierda', async () => {
    const { avisar, borradorActual } = armar();
    await avisar('mañana 2pm');

    expect((borradorActual() as any).horario).toBe('mañana 2pm');
  });

  it('deja registrada la nota del recojo, para que la reserva tenga dónde quedar', async () => {
    // 20-10: el Yape de S/ 5 de la reserva no se pudo asentar porque el
    // recojo no tenía nota de venta.
    const { avisar, registrar } = armar();
    const res = await avisar('el sábado por la mañana');

    expect(registrar).toHaveBeenCalledWith(EMPRESA, CONV, TELEFONO);
    expect(res).toMatchObject({ avisado: true, pedido: 'NV01-00000099', montoAPagar: 7 });
  });

  it('si la nota no se pudo registrar, no deja decir que quedó registrado', async () => {
    const { avisar, registrar } = armar();
    registrar.mockResolvedValue({ error: 'No se pudo registrar el pedido en el sistema.' });
    const res = await avisar('mañana');

    expect(res.avisado).toBe(true);
    expect(res.pedido).toBeUndefined();
    expect(res.aviso).toMatch(/NO se registró/);
  });

  describe('lo que NO debe pasar', () => {
    it('no manda el mismo aviso dos veces', async () => {
      // El modelo reintenta cuando el cliente repite "sí, mañana voy".
      const { avisar, avisos } = armar();
      await avisar('mañana a las 2');
      const segundo = await avisar('mañana a las 2');

      expect(segundo).toMatchObject({ avisado: true, yaAvisado: true });
      expect(avisos).toHaveLength(1);
    });

    it('pero sí avisa de nuevo si cambia el día', async () => {
      const { avisar, avisos } = armar();
      await avisar('mañana a las 2');
      await avisar('el lunes a las 5');

      expect(avisos).toHaveLength(2);
      expect(avisos[1].mensaje).toContain('el lunes a las 5');
    });

    it('sin nada cotizado no se avisa ninguna visita', async () => {
      const { avisar, avisos } = armar(null);
      const res = await avisar('mañana');

      expect(res.error).toMatch(/cotiza primero/i);
      expect(avisos).toHaveLength(0);
    });

    it('sin productos confirmados tampoco', async () => {
      const { avisar, avisos } = armar({ ...BORRADOR_RECOJO, itemsJson: [] });
      const res = await avisar('mañana');

      expect(res.error).toMatch(/no hay productos/i);
      expect(avisos).toHaveLength(0);
    });

    it('un pedido con envío no se avisa como visita', async () => {
      // Si el pedido es a domicilio o por agencia, lo que toca es
      // registrar_pedido: avisar una visita lo dejaría sin despachar.
      const { avisar, avisos } = armar({
        ...BORRADOR_RECOJO,
        tipoZona: 'DOMICILIO',
      });
      const res = await avisar('mañana');

      expect(res.error).toMatch(/registrar_pedido/);
      expect(avisos).toHaveLength(0);
    });

    it('sin el nombre no se avisa: el negocio no sabría a quién espera', async () => {
      const { avisar, avisos } = armar({ ...BORRADOR_RECOJO, nombre: null });
      const res = await avisar('mañana');

      expect(res.falta).toEqual(['nombre completo']);
      expect(avisos).toHaveLength(0);
    });

    it('sin el día tampoco, que es justo el dato que falta hoy', async () => {
      const { avisar, avisos } = armar();
      const res = await avisar('   ');

      expect(res.falta?.[0]).toMatch(/día y la hora/i);
      expect(avisos).toHaveLength(0);
    });
  });
});
