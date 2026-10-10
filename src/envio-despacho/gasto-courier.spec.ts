/**
 * Gasto de envío por courier.
 *
 * Pedido de COMERCIAL LINNA MODA: *"Hay manera que el sistema me permita
 * registrar los pagos que se realizan al courrier local, ya que me gustaría que
 * se registren esos gastos para que haya un Reporte de gastos de envío por
 * courrier"*.
 *
 * El sistema solo guardaba `costoEnvio`, que es lo que se le COBRA al cliente.
 * `costoCourier` es la contracara: lo que el negocio PAGA. Son independientes —
 * se le puede cobrar S/15 al comprador y pagarle S/8 al motorizado, y esa
 * diferencia es justamente lo que el reporte tiene que dejar ver.
 */
import { ValidationPipe } from '@nestjs/common';
import { EnvioDespachoService } from './envio-despacho.service';
import { UpdateEnvioDespachoDto } from './dto/envio-despacho.dto';

describe('Gasto de envío por courier', () => {
  const service = new EnvioDespachoService({} as any, {} as any, {} as any);
  const fila = (envio: any) => (service as any).filaReparto(envio);
  const agrupar = (filas: any[], key: string) =>
    (service as any).agrupar(filas, key);

  const base = (over: any = {}) => ({
    estado: 'ENTREGADO',
    transportista: 'PROPIOS',
    distrito: 'MIRAFLORES',
    tipoVentaReparto: 'CONTRAENTREGA',
    formaPagoCobro: 'EFECTIVO',
    direccionDestino: 'Av. Pardo 123',
    nombreDestinatario: 'CLIENTE DE PRUEBA',
    celularDest: '999999999',
    montoCOD: 139,
    costoEnvio: 15,
    creadoEn: new Date('2026-10-07T15:00:00.000Z'),
    repartidor: { nombre: 'GORENZA' },
    comprobante: {
      serie: 'NV01',
      correlativo: '8',
      mtoImpVenta: 139,
      saldo: 0,
      tipoMoneda: 'PEN',
      sede: { nombre: 'Sede Principal' },
      cliente: { nombre: 'CLIENTE DE PRUEBA' },
      detalles: [],
    },
    ...over,
  });

  it('registra lo que se le paga al courier, aparte de lo que se cobra al cliente', () => {
    const f = fila(base({ costoEnvio: 15, costoCourier: 8 }));
    expect(f.meta.costoEnvio).toBe(15); // lo que paga el comprador
    expect(f.meta.costoCourier).toBe(8); // lo que recibe el motorizado
  });

  it('si no se registró el pago, cuenta cero y no rompe el reporte', () => {
    const f = fila(base({ costoCourier: null }));
    expect(f.meta.costoCourier).toBe(0);
  });

  it('suma el gasto por courier: eso es el reporte que pidió el cliente', () => {
    const filas = [
      fila(base({ costoCourier: 8, repartidor: { nombre: 'GORENZA' } })),
      fila(base({ costoCourier: 12, repartidor: { nombre: 'GORENZA' } })),
      fila(base({ costoCourier: 5, repartidor: { nombre: 'DINSIDES' } })),
    ];
    const porRepartidor = agrupar(filas, 'repartidor');
    const gorenza = porRepartidor.find((r: any) => r.nombre === 'GORENZA');
    const dinsides = porRepartidor.find((r: any) => r.nombre === 'DINSIDES');

    expect(gorenza.pedidos).toBe(2);
    expect(gorenza.costoCourier).toBe(20);
    expect(dinsides.costoCourier).toBe(5);
  });

  it('también agrupa por empresa de transporte (Shalom, Olva, propio)', () => {
    const filas = [
      fila(base({ costoCourier: 8 })),
      fila(base({ transportista: 'SHALOM_PRO', agenciaDestino: 'SHALOM CUSCO', costoCourier: 25 })),
    ];
    const porCourier = agrupar(filas, 'courier');
    expect(porCourier.reduce((s: number, c: any) => s + c.costoCourier, 0)).toBe(33);
  });

  it('redondea a dos decimales para que el total cuadre al céntimo', () => {
    const filas = [
      fila(base({ costoCourier: 8.555 })),
      fila(base({ costoCourier: 3.335 })),
    ];
    const total = agrupar(filas, 'courier')[0].costoCourier;
    expect(total).toBeCloseTo(11.9, 2);
    expect(Number.isFinite(total)).toBe(true);
  });

  it('el gasto es independiente de lo que se le cobra al cliente', () => {
    // Envío gratis para el comprador, pero al motorizado igual se le paga.
    const f = fila(base({ costoEnvio: 0, costoCourier: 10 }));
    expect(f.meta.costoEnvio).toBe(0);
    expect(f.meta.costoCourier).toBe(10);
  });
});

/**
 * Que el dato llegue a la base. Un campo que el reporte suma pero que el
 * guardado descarta deja el reporte en cero para siempre, y el error es mudo:
 * el usuario escribe el monto, guarda, y nadie avisa que se perdió.
 */
describe('Gasto de envío por courier · se guarda de verdad', () => {
  const service = new EnvioDespachoService({} as any, {} as any, {} as any);
  const pick = (dto: any) => (service as any).pickFields(dto);

  it('el monto pagado al courier sobrevive al guardado', () => {
    expect(pick({ costoCourier: 8.5 })).toEqual({ costoCourier: 8.5 });
  });

  it('un cero explícito se guarda (no es lo mismo que "no lo toqué")', () => {
    expect(pick({ costoCourier: 0 })).toEqual({ costoCourier: 0 });
  });

  it('si no se envía, no se pisa lo que ya estaba guardado', () => {
    expect(pick({ costoEnvio: 15 })).toEqual({ costoEnvio: 15 });
  });

  it('se guarda junto al resto del despacho, sin desplazar nada', () => {
    const guardado = pick({ transportista: 'PROPIOS', costoEnvio: 15, costoCourier: 8 });
    expect(guardado).toEqual({ transportista: 'PROPIOS', costoEnvio: 15, costoCourier: 8 });
  });
});

/**
 * El ValidationPipe corre con `whitelist: true`: lo que no esté declarado en el
 * DTO se descarta en silencio antes de llegar al servicio. Si el campo faltara
 * ahí, el front lo enviaría, nadie se quejaría y el monto nunca se guardaría.
 */
describe('Gasto de envío por courier · el DTO lo deja pasar', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const meta = { type: 'body' as const, metatype: UpdateEnvioDespachoDto };

  it('no se descarta por el whitelist', async () => {
    const out: any = await pipe.transform({ costoCourier: 8.5 }, meta);
    expect(out.costoCourier).toBe(8.5);
  });

  it('acepta el monto como texto desde el formulario', async () => {
    const out: any = await pipe.transform({ costoCourier: '12.30' }, meta);
    expect(out.costoCourier).toBe(12.3);
  });

  it('rechaza un monto negativo', async () => {
    await expect(pipe.transform({ costoCourier: -5 }, meta)).rejects.toBeDefined();
  });
});
