/**
 * Que `guardar_datos_envio` no acepte un dato que el cliente no dio.
 *
 * El 2026-10-16 en Hierba Sana un cliente de Cusco cotizó 3 Cardiox, yapeó y
 * mandó la captura. El agente solo le había pedido el nombre. Con el pago ya
 * hecho, `registrar_pedido` le contestó que faltaban DNI, celular y sede de
 * la agencia; el modelo los RELLENÓ —DNI 84956217, celular 987456123— y la
 * NV01-00000006 salió con un destinatario que nadie podía contactar. El
 * celular inventado no era ni el WhatsApp desde el que escribía.
 *
 * Lo que se defiende acá es la otra mitad del arreglo: las funciones puras
 * viven en `procedencia-datos.spec.ts`, pero lo que importa de verdad es que
 * el dato inventado NO llegue al borrador y que el pedido siga incompleto —
 * porque es `faltantes()` lo que frena el registro.
 */
import { LeadsPedidoService } from './leads-pedido.service';
import { CONFIG_ENVIO_HIERBA_SANA } from './envio-zonas';
import { REGLAS_HIERBA_SANA } from './reglas-descuento';

const EMPRESA = 89;
const CONV = 42;

/** Lo que el cliente escribió de verdad en el chat del incidente. */
const CHAT_REAL = [
  'hola , que servicio ofrecen?',
  'quiero cardiox',
  'es para mi, soy de cusco',
  'quisiera 3 unidades, hay descuento?',
  'ok, donde puedo yapear?',
  '[el cliente envió un comprobante de pago por Yape de S/ 135.00, operación 12345678, a nombre de Juan Salas Parra]',
];

function armar(mensajesDelCliente: string[] = CHAT_REAL) {
  let borrador: Record<string, unknown> | null = null;

  const prisma: any = {
    empresa: {
      findUnique: jest.fn().mockResolvedValue({
        iaVentasConfigJson: {
          envio: CONFIG_ENVIO_HIERBA_SANA,
          descuento: REGLAS_HIERBA_SANA,
        },
      }),
    },
    leadMensaje: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          mensajesDelCliente.map((contenido) => ({ contenido })),
        ),
    },
    leadPedidoBorrador: {
      findUnique: jest.fn(() => Promise.resolve(borrador)),
      upsert: jest.fn(({ create, update }: any) => {
        borrador = { ...(borrador ?? {}), ...(borrador ? update : create) };
        for (const c of [
          'zona',
          'tipoZona',
          'lugar',
          'nombre',
          'dni',
          'celular',
          'direccion',
          'referencia',
          'horario',
          'agenciaSede',
        ]) {
          if (!(c in (borrador as object))) (borrador as any)[c] = null;
        }
        return Promise.resolve(borrador);
      }),
    },
    leadProspecto: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };

  const servicio = new LeadsPedidoService(
    prisma,
    {} as never,
    {} as never,
    {} as never,
  );
  return {
    guardar: (datos: any) => servicio.guardarDatos(EMPRESA, CONV, datos),
    leadMensaje: prisma.leadMensaje,
    borradorActual: () => borrador,
  };
}

describe('datos que el cliente no dio', () => {
  it('no guarda el DNI que el modelo se inventó', async () => {
    const { guardar, borradorActual } = armar();
    const res = await guardar({ destino: 'Cusco', dni: '84956217' });

    expect(res.guardado).not.toContain('DNI');
    expect((borradorActual() as any).dni).toBeNull();
    expect(res.problemas?.join(' ')).toMatch(/no aparece en ningún mensaje/i);
  });

  it('no guarda el celular que el modelo se inventó', async () => {
    const { guardar, borradorActual } = armar();
    const res = await guardar({ destino: 'Cusco', celular: '987456123' });

    expect(res.guardado).not.toContain('celular');
    expect((borradorActual() as any).celular).toBeNull();
    expect(res.problemas?.join(' ')).toMatch(/pregúntaselo al cliente/i);
  });

  it('el pedido sigue incompleto, que es lo que frena el registro', async () => {
    // Es el punto del arreglo: con el dato rechazado, `faltan` lo vuelve a
    // pedir y `registrar_pedido` se niega. Sin esto, el pedido se registraba.
    const { guardar } = armar();
    const res = await guardar({
      destino: 'Cusco',
      nombre: 'Juan Salas Parra',
      dni: '84956217',
      celular: '987456123',
      agenciaSede: 'Shalom Cusco Sede Central',
    });

    expect(res.faltan).toContain('DNI');
    expect(res.faltan).toContain('celular de contacto');
  });

  it('no toma la dirección de la nada', async () => {
    const { guardar, borradorActual } = armar([
      'quiero 2 moringas',
      'estoy en comas',
    ]);
    const res = await guardar({
      destino: 'Comas',
      direccion: 'Av. Los Próceres 456',
    });

    expect((borradorActual() as any).direccion).toBeNull();
    expect(res.problemas?.join(' ')).toMatch(/dirección/i);
  });

  describe('lo que NO debe romperse', () => {
    it('el cliente que sí dicta sus datos los ve guardados', async () => {
      const { guardar, borradorActual } = armar([
        'soy de cusco',
        'mi nombre es Juan Salas Parra, dni 70123456',
        'mi celular es 987 654 321',
        'mandalo a la av. larco 123',
      ]);
      const res = await guardar({
        destino: 'Cusco',
        nombre: 'Juan Salas Parra',
        dni: '70123456',
        celular: '987654321',
        direccion: 'Av. Larco 123',
      });

      expect(res.guardado).toContain('DNI');
      expect(res.guardado).toContain('celular');
      expect(res.problemas).toBeUndefined();
      expect((borradorActual() as any).dni).toBe('70123456');
      expect((borradorActual() as any).celular).toBe('987654321');
    });

    it('si no se pueden leer los mensajes, el dato pasa y la venta sigue', async () => {
      // Fail-open a propósito: este control existe para que no entre un dato
      // falso, no para frenar las ventas de todos si la consulta se cae.
      const { guardar, leadMensaje, borradorActual } = armar();
      leadMensaje.findMany.mockRejectedValue(new Error('base caída'));

      const res = await guardar({ destino: 'Cusco', dni: '70123456' });

      expect(res.guardado).toContain('DNI');
      expect((borradorActual() as any).dni).toBe('70123456');
    });

    it('la sede de la agencia se acepta: el agente la ofrece y el cliente la confirma', async () => {
      const { guardar, borradorActual } = armar(['si, esa', 'soy de cusco']);
      await guardar({
        destino: 'Cusco',
        agenciaSede: 'Shalom Cusco Sede Central',
      });

      expect((borradorActual() as any).agenciaSede).toBe(
        'Shalom Cusco Sede Central',
      );
    });
  });
});
