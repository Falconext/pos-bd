/**
 * Una empresa no hereda los términos comerciales de otra.
 *
 * Esto se escribe porque casi se desplegó lo contrario. Los valores de Hierba
 * Sana estaban como defecto de relleno, así que CUALQUIER otra empresa de la
 * plataforma que encendiera la IA de Ventas —o que simplemente tuviera su
 * tienda abierta— empezaba a:
 *
 *   - descontar entre S/ 10 y S/ 30 por pedido, sin que su dueño lo supiera;
 *   - cotizar "S/ 15 a domicilio en Lima" y "S/ 10 por agencia" con los 37
 *     distritos de otro negocio.
 *
 * En la base local había 20 empresas y CERO con descuentos configurados: las
 * 20 habrían recibido los tramos de Hierba Sana.
 */
import { SIN_DESCUENTO, REGLAS_HIERBA_SANA, calcularDescuento } from './reglas-descuento';
import {
  SIN_CONFIG_ENVIO,
  CONFIG_ENVIO_HIERBA_SANA,
  resolverDestino,
  tieneEnvioConfigurado,
} from './envio-zonas';
import { LeadsPedidoService } from './leads-pedido.service';

describe('descuentos: el defecto es NINGUNO', () => {
  it('sin tramos configurados, un carrito grande no descuenta nada', () => {
    const carro = [{ precioUnitario: 60, cantidad: 7 }];
    const r = calcularDescuento(carro, 15, SIN_DESCUENTO);
    expect(r.descuento).toBe(0);
    expect(r.montoAPagar).toBe(r.total);
    // Y el mismo carrito, con los tramos de Hierba Sana, sí descuenta: la
    // diferencia es justo lo que se regalaba por defecto.
    expect(calcularDescuento(carro, 15, REGLAS_HIERBA_SANA).descuento).toBe(30);
  });

  it('tampoco sugiere "te falta 1 para el descuento" que no existe', () => {
    const r = calcularDescuento([{ precioUnitario: 46, cantidad: 4 }], 15, SIN_DESCUENTO);
    expect(r.faltaParaSiguiente).toBeNull();
  });
});

describe('envíos: el defecto es SIN ZONAS', () => {
  it('una empresa sin configurar no tiene zonas', () => {
    expect(tieneEnvioConfigurado(SIN_CONFIG_ENVIO)).toBe(false);
    expect(tieneEnvioConfigurado(CONFIG_ENVIO_HIERBA_SANA)).toBe(true);
    expect(tieneEnvioConfigurado(null)).toBe(false);
  });

  it('y no resuelve destinos de otro negocio', () => {
    // "SJL" es un distrito de Lima en la config de Hierba Sana. Para una
    // empresa sin configurar no significa nada, y eso es lo correcto.
    expect(resolverDestino('SJL', CONFIG_ENVIO_HIERBA_SANA)).not.toBeNull();
    expect(resolverDestino('SJL', SIN_CONFIG_ENVIO)).toBeNull();
  });
});

describe('la configuración que recibe el flujo', () => {
  const servicio = (config: unknown) =>
    new LeadsPedidoService(
      {
        empresa: {
          findUnique: jest.fn().mockResolvedValue({ iaVentasConfigJson: config }),
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

  it('una empresa sin configurar no recibe nada de Hierba Sana', async () => {
    const config = await servicio(null).configDe(99);
    expect(config.envio.zonas).toHaveLength(0);
    expect(config.descuento.tramos).toHaveLength(0);
    // El horario sí tiene un defecto genérico: validar una franja contra
    // 9–19 no le cuesta plata a nadie, y sin horario la validación no tendría
    // referencia.
    expect(config.horario.desdeMin).toBeGreaterThan(0);
  });

  it('y la que sí configuró recibe LO SUYO', async () => {
    const mias = {
      envio: {
        zonaPorDefecto: 'Arequipa',
        zonas: [
          {
            nombre: 'Arequipa',
            tipo: 'DOMICILIO',
            costo: 8,
            lugares: [{ nombre: 'CAYMA' }],
          },
        ],
      },
      descuento: {
        precioUnitarioMinimo: 50,
        envioCuentaEnTotal: false,
        tramos: [{ descuento: 5, unidades: 2, totalMayorQue: 100 }],
      },
    };
    const config = await servicio(mias).configDe(99);
    expect(config.envio.zonas[0].nombre).toBe('Arequipa');
    expect(config.descuento.tramos[0].descuento).toBe(5);
    // Nada de los 37 distritos de Lima del otro negocio: "SJL" no es un
    // lugar conocido acá, así que cae en la zona por defecto de ESTA empresa
    // y cobra SU tarifa (S/ 8), no los S/ 15 de Lima del otro.
    const sjl = resolverDestino('SJL', config.envio);
    expect(sjl).not.toBe('ambiguo');
    expect((sjl as any)?.zona.nombre).toBe('Arequipa');
    expect((sjl as any)?.zona.costo).toBe(8);
    expect((resolverDestino('Cayma', config.envio) as any)?.lugar).toBe('CAYMA');
  });
});

describe('el flujo deriva en vez de inventar', () => {
  const servicio = () =>
    new LeadsPedidoService(
      {
        empresa: {
          findUnique: jest.fn().mockResolvedValue({ iaVentasConfigJson: null }),
        },
        leadPedidoBorrador: {
          findUnique: jest.fn().mockResolvedValue({ itemsJson: [] }),
          upsert: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

  it('al dar un distrito, pide derivar en vez de cobrar un envío inventado', async () => {
    const r = await servicio().guardarDatos(99, 1, { destino: 'SJL' });
    expect(r.aclarar).toMatch(/no inventes un costo de envío/i);
    expect(r.aclarar).toMatch(/deriva/i);
    expect(r.costoEnvio).toBeUndefined();
  });

  it('y al cotizar, tampoco arma un total con envío 0', async () => {
    // Un total sin envío es una promesa de envío gratis que nadie hizo.
    const r = await servicio().cotizar(99, 1, [{ productoId: 1, cantidad: 2 }]);
    expect(r.error).toMatch(/zonas de envío/i);
    expect(r.texto).toBeUndefined();
  });
});
