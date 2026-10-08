import { ValidationPipe } from '@nestjs/common';
import { EnvioDespachoService } from './envio-despacho.service';
import { ExportarRepartoQueryDto } from './dto/envio-despacho.dto';

/**
 * El resumen y el export de envíos existían solo para el reparto propio
 * (`transportista: 'PROPIOS'` hardcodeado), así que los envíos por Shalom y
 * Olva no aparecían en ninguna estadística. Estas pruebas fijan las tres
 * decisiones del cambio:
 *
 *  1. el filtro por courier cubre las tres variantes de Shalom y nunca
 *     arrastra `NO_APLICA` (ventas que no se despachan),
 *  2. un envío por agencia no se valida con las reglas de la plantilla del
 *     motorizado (si no, todos saldrían "FALTAN DATOS"),
 *  3. el destino es el distrito en reparto propio y la agencia en Shalom/Olva,
 *     que es lo que hace comparable el "a dónde mando más".
 */
describe('Reporte de envíos — filtro por courier y modo agencia', () => {
  const service = new EnvioDespachoService(
    {} as any,
    {} as any,
    {} as any,
  );
  const filtro = (c?: string) => (service as any).filtroCourier(c);
  const modo = (c?: string) => (service as any).modoReporte(c);
  // El modo ya no se pasa: cada fila se interpreta por su propio transportista.
  const fila = (envio: any, _m?: 'PROPIOS' | 'AGENCIA') =>
    (service as any).filaReparto(envio);
  const envioPropio = (over: any = {}) => ({
    ...envioAgencia(),
    transportista: 'PROPIOS',
    agenciaDestino: null,
    distrito: 'SAN JUAN DE LURIGANCHO',
    tipoVentaReparto: 'CONTRAENTREGA',
    formaPagoCobro: 'EFECTIVO',
    montoCOD: 180,
    costoEnvio: 8,
    direccionDestino: 'Calle Real 100',
    ...over,
  });

  const envioAgencia = (over: any = {}) => ({
    estado: 'EN_AGENCIA',
    transportista: 'SHALOM_PRO',
    agenciaDestino: 'SHALOM CUSCO CENTRO',
    nombreDestinatario: 'ORTEGA ROLDAN, DIEGO JESUS',
    dniDestinatario: '47065472',
    celularDest: '991065217',
    nroOrden: '96378311',
    claveEnvio: '9009',
    nroPaquetes: 1,
    contenidoPaquete: '1 Paquete XS',
    costoEnvio: 0,
    shalomFleteCotizado: 10,
    shalomEntregado: false,
    fechaEstimada: null,
    creadoEn: new Date('2026-10-03T15:00:00.000Z'),
    comprobante: {
      serie: 'B001',
      correlativo: '123',
      mtoImpVenta: 180,
      saldo: 0,
      tipoMoneda: 'PEN',
      sede: { nombre: 'Sede Principal' },
      cliente: { nombre: 'ORTEGA ROLDAN, DIEGO JESUS' },
      detalles: [],
    },
    ...over,
  });

  describe('filtroCourier', () => {
    it('por defecto (y con PROPIOS) sigue siendo el reparto propio exacto', () => {
      expect(filtro(undefined)).toEqual({ transportista: 'PROPIOS' });
      expect(filtro('PROPIOS')).toEqual({ transportista: 'PROPIOS' });
    });

    it('SHALOM cubre SHALOM, SHALOM_PRO y SHALOM_COD con una coincidencia parcial', () => {
      expect(filtro('SHALOM')).toEqual({
        transportista: { contains: 'SHALOM' },
      });
      // Las tres variantes reales que escribe el sistema empiezan por SHALOM.
      for (const t of ['SHALOM', 'SHALOM_PRO', 'SHALOM_COD']) {
        expect(t.includes('SHALOM')).toBe(true);
      }
    });

    it('TODOS excluye las ventas sin despacho (NO_APLICA) y los nulos', () => {
      expect(filtro('TODOS')).toEqual({
        AND: [
          { transportista: { not: null } },
          { transportista: { not: 'NO_APLICA' } },
        ],
      });
    });
  });

  describe('modoReporte', () => {
    it('solo el reparto propio usa la plantilla del motorizado', () => {
      expect(modo(undefined)).toBe('PROPIOS');
      expect(modo('PROPIOS')).toBe('PROPIOS');
      expect(modo('SHALOM')).toBe('AGENCIA');
      expect(modo('OLVA')).toBe('AGENCIA');
      expect(modo('TODOS')).toBe('AGENCIA');
    });
  });

  describe('filaReparto en modo AGENCIA', () => {
    it('un envío Shalom completo no reclama datos de la plantilla del motorizado', () => {
      const f = fila(envioAgencia());
      expect(f.meta.completo).toBe(true);
      expect(f.envio.CARGA).toBe('OK');
    });

    it('un Shalom COD no reclama la forma de pago, que es del motorizado', () => {
      // Bug detectado en QA contra BD real: el COD salía "FALTAN DATOS: forma de
      // pago" aunque el cobro lo hace la agencia y ese campo no se elige aquí.
      const f = fila(
        envioAgencia({
          transportista: 'SHALOM_COD',
          montoCOD: 180,
          formaPagoCobro: null,
        }),
      );
      expect(f.envio.CARGA).toBe('OK');
      expect(f.meta.completo).toBe(true);
    });

    it('en un listado mixto cada fila se valida por su propio courier', () => {
      // Bug detectado en QA contra BD real: en modo TODOS las filas de reparto
      // propio reclamaban "agencia destino" y las de agencia "distrito".
      expect(fila(envioPropio()).meta.completo).toBe(true);
      expect(fila(envioPropio()).courier.CARGA).toBe('OK');
      expect(fila(envioAgencia()).envio.CARGA).toBe('OK');
    });

    it('reclama el DNI, que es lo que exige la guía por agencia', () => {
      const f = fila(envioAgencia({ dniDestinatario: null }));
      expect(f.meta.completo).toBe(false);
      expect(f.envio.CARGA).toContain('DNI');
    });

    it('el destino es la agencia en Shalom y el distrito en reparto propio', () => {
      expect(fila(envioAgencia()).meta.destino).toBe('SHALOM CUSCO CENTRO');
      // Bug detectado en QA contra BD real: en modo TODOS una fila de reparto
      // propio caía a la dirección del cliente ("Calle Real 100") en vez del
      // distrito, porque el destino se decidía por el modo del reporte.
      expect(fila(envioPropio()).meta.destino).toBe('SAN JUAN DE LURIGANCHO');
    });

    it('toma el flete cotizado por Shalom cuando nadie tipeó el costo de envío', () => {
      expect(fila(envioAgencia()).meta.costoEnvio).toBe(10);
      // Un costo tipeado a mano manda sobre la cotización.
      expect(
        fila(envioAgencia({ costoEnvio: 12.5 })).meta.costoEnvio,
      ).toBe(12.5);
    });

    it('en reparto propio el flete de Shalom nunca altera el costo de envío', () => {
      expect(
        fila(envioPropio({ costoEnvio: 0, shalomFleteCotizado: 10 })).meta
          .costoEnvio,
      ).toBe(0);
    });

    it('cuenta como entregado lo que confirmó el rastreo del courier', () => {
      expect(fila(envioAgencia()).meta.entregado).toBe(false);
      expect(
        fila(envioAgencia({ shalomEntregado: true })).meta.entregado,
      ).toBe(true);
      expect(
        fila(envioAgencia({ olvaEntregado: true })).meta.entregado,
      ).toBe(true);
    });

    it('agrupa por mes con el día efectivo del envío', () => {
      // Sin fecha programada manda `creadoEn` leído en hora de Lima.
      expect(fila(envioAgencia()).meta.mes).toBe('2026-10');
      // Con fecha programada manda esa, leída por calendario UTC.
      expect(
        fila(
          envioAgencia({ fechaEstimada: new Date('2026-11-02T12:00:00.000Z') }),
          'AGENCIA',
        ).meta.mes,
      ).toBe('2026-11');
    });

    it('etiqueta el courier para poder comparar Shalom contra Olva', () => {
      expect(fila(envioAgencia()).meta.courier).toBe('Shalom');
      expect(
        fila(envioAgencia({ transportista: 'OLVA' })).meta.courier,
      ).toBe('Olva');
      expect(
        fila(envioAgencia({ transportista: 'PROPIOS' })).meta
          .courier,
      ).toBe('Reparto propio');
    });
  });

  describe('contraentrega por agencia (Shalom COD)', () => {
    it('un Shalom COD cobra en destino aunque no tenga tipoVentaReparto', () => {
      const f = fila(
        envioAgencia({
          transportista: 'SHALOM_COD',
          montoCOD: 180,
          comprobante: { ...envioAgencia().comprobante, saldo: 180 },
        }),
        'AGENCIA',
      );
      expect(f.meta.cobra).toBe(true);
      expect(f.meta.montoCobrar).toBe(180);
    });

    it('un Shalom normal (ya pagado) no manda a cobrar nada', () => {
      const f = fila(envioAgencia());
      expect(f.meta.cobra).toBe(false);
      expect(f.meta.montoCobrar).toBe(0);
    });
  });

  describe('el querystring llega al service (ValidationPipe global)', () => {
    // `whitelist: true` descarta cualquier campo sin decorador en el DTO: si
    // `courier` no estuviera declarado se caería en silencio y el reporte
    // volvería siempre al reparto propio, sin error visible.
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      validationError: { target: false, value: false },
    });
    const pasar = (q: any) =>
      pipe.transform(q, {
        type: 'query',
        metatype: ExportarRepartoQueryDto,
      }) as any;

    it('conserva courier junto al rango de fechas', async () => {
      const out = await pasar({
        fecha: '2026-09-01',
        fechaFin: '2026-10-31',
        courier: 'SHALOM',
      });
      expect(out.courier).toBe('SHALOM');
      expect(out.fecha).toBe('2026-09-01');
      expect(out.fechaFin).toBe('2026-10-31');
    });

    it('acepta los cuatro valores y rechaza cualquier otro', async () => {
      for (const c of ['PROPIOS', 'SHALOM', 'OLVA', 'TODOS']) {
        await expect(pasar({ courier: c })).resolves.toMatchObject({
          courier: c,
        });
      }
      await expect(pasar({ courier: 'DHL' })).rejects.toThrow();
    });

    it('sin courier el reporte sigue siendo el reparto propio', async () => {
      const out = await pasar({ fecha: '2026-10-01' });
      expect(out.courier).toBeUndefined();
      expect(filtro(out.courier)).toEqual({ transportista: 'PROPIOS' });
    });
  });

  describe('agrupar', () => {
    it('ordena por cantidad de envíos: el primero es a donde más se manda', () => {
      const filas = [
        fila(envioAgencia()),
        fila(envioAgencia()),
        fila(envioAgencia({ agenciaDestino: 'SHALOM PIURA' })),
      ];
      const grupos = (service as any).agrupar(filas, 'destino');
      expect(grupos.map((g: any) => [g.nombre, g.pedidos])).toEqual([
        ['SHALOM CUSCO CENTRO', 2],
        ['SHALOM PIURA', 1],
      ]);
    });
  });
});
