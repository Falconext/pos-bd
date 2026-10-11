/**
 * El despacho que crea la IA sale con su courier.
 *
 * Antes quedaba vacío: el pedido se creaba, pero el panel no sabía con quién
 * iba el paquete y el botón "Coordinar envío" arrancaba en blanco, obligando
 * a elegirlo a mano en cada pedido.
 *
 * El courier va en la configuración de la empresa, no en el código: cada
 * negocio trabaja con los suyos, y el de uno no puede salir en el despacho
 * de otro.
 */
import {
  CONFIG_ENVIO_HIERBA_SANA,
  SIN_CONFIG_ENVIO,
  resolverDestino,
} from './envio-zonas';

const zona = (nombre: string) =>
  CONFIG_ENVIO_HIERBA_SANA.zonas.find((z) => z.nombre === nombre);

describe('el courier de cada zona', () => {
  it('provincia sale por Shalom', () => {
    expect(zona('Provincia')?.courier).toBe('SHALOM_PRO');
  });

  it('Lima va con reparto propio: es contraentrega, no agencia', () => {
    expect(zona('Lima')?.courier).toBe('PROPIOS');
  });

  it('el recojo en tienda no tiene courier, y está bien', () => {
    // No hay nada que despachar: el cliente viene.
    expect(zona('Recojo en tienda')?.courier).toBeUndefined();
  });

  it('una empresa sin configurar no hereda el courier de otra', () => {
    expect(SIN_CONFIG_ENVIO.zonas).toHaveLength(0);
  });
});

describe('de la ciudad al courier, que es el camino real', () => {
  it('Trujillo → provincia → Shalom', () => {
    const r = resolverDestino('Trujillo', CONFIG_ENVIO_HIERBA_SANA);
    expect(r).not.toBe('ambiguo');
    expect((r as any)?.zona.courier).toBe('SHALOM_PRO');
    expect((r as any)?.zona.tarifa).toBe(10);
  });

  it('SJL → Lima → reparto propio', () => {
    const r = resolverDestino('SJL', CONFIG_ENVIO_HIERBA_SANA);
    expect((r as any)?.zona.courier).toBe('PROPIOS');
    expect((r as any)?.zona.tarifa).toBe(15);
  });
});
