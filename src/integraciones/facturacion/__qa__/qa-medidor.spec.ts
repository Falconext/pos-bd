/**
 * QA funcional del medidor y el cierre mensual, contra Postgres real.
 *
 * Es la parte del sistema que le cobra plata a un cliente. Lo que se prueba
 * acá no es si suma: es que **no cobre dos veces** y que **no pierda nada**.
 * Las dos fallas son silenciosas —nadie revisa una factura que parece normal—
 * y las dos solo se pueden demostrar contra la base, porque lo que las evita
 * es la marca por comprobante y el índice único del período.
 *
 *   QA_DB=1 QA_DATABASE_URL=… npx jest src/integraciones/facturacion/__qa__/qa-medidor
 */
import { PrismaClient } from '@prisma/client';
import { MedidorApiService } from '../medidor.service';
import { limpiar, sembrarCatalogos, sembrarEmpresa } from '../../__qa__/sembrar';

const correr = process.env.QA_DB === '1' ? describe : describe.skip;
const URL_QA = process.env.QA_DATABASE_URL ?? '';

correr('medidor y cierre mensual, contra Postgres real', () => {
  jest.setTimeout(90_000);
  let prisma: PrismaClient;
  let medidor: MedidorApiService;

  const INT_A = 9401;
  const INT_B = 9402;
  const EMISOR_A1 = 9411;
  const EMISOR_A2 = 9412;
  const EMISOR_B1 = 9421;
  const PERIODO = '2026-09';
  let clienteA1 = 0, clienteA2 = 0, clienteB1 = 0;

  const CDR_OK = JSON.stringify({ code: '0', message: 'aceptada' });

  /** Un comprobante de la API, en el estado y la fecha pedidos. */
  const emitido = async (
    empresaId: number, clienteId: number, estado: string,
    opts: { dia?: number; mes?: number; anio?: number; cdr?: string; publicId?: string } = {},
  ) => {
    const { dia = 15, mes = 9, anio = 2026 } = opts;
    const r: any = await prisma.$queryRawUnsafe(
      `INSERT INTO "Comprobante"
        ("tipoDoc",serie,correlativo,"fechaEmision","formaPagoTipo","formaPagoMoneda","tipoMoneda",
         "mtoOperGravadas","mtoIGV","valorVenta","totalImpuestos","subTotal","mtoImpVenta",
         "clienteId","empresaId","estadoEnvioSunat","tipoOperacionId","apiPublicId","sunatCdrResponse")
       VALUES ('01','F001',(SELECT coalesce(max(correlativo),0)+1 FROM "Comprobante" WHERE "empresaId"=$1),
               make_timestamp($2::int,$3::int,$4::int,10,0,0::double precision),'Contado','PEN','PEN',
               1000,180,1000,180,1000,1180,$5,$1,$6::"EstadoSunat",1,$7,$8)
       RETURNING id`,
      empresaId, anio, mes, dia, clienteId, estado,
      opts.publicId ?? `inv_qa${Math.random().toString(36).slice(2, 12)}`,
      opts.cdr ?? (estado === 'EMITIDO' ? CDR_OK : null),
    );
    return r[0].id as number;
  };

  const cliente = async (empresaId: number) => {
    const r: any = await prisma.$queryRawUnsafe(
      `INSERT INTO "Cliente" (nombre,"nroDoc","empresaId","tipoDocumentoId")
       VALUES ('CLIENTE QA','20600000001',$1,2) RETURNING id`, empresaId);
    return r[0].id as number;
  };

  beforeAll(async () => {
    if (!URL_QA) throw new Error('falta QA_DATABASE_URL');
    prisma = new PrismaClient({ datasources: { db: { url: URL_QA } } });
    await prisma.$connect();
    await sembrarCatalogos(prisma);
    for (const [id, n] of [[INT_A,'INTEGRADOR A'],[INT_B,'INTEGRADOR B'],
                            [EMISOR_A1,'EMISOR A1'],[EMISOR_A2,'EMISOR A2'],[EMISOR_B1,'EMISOR B1']] as [number,string][]) {
      await sembrarEmpresa(prisma, id, n);
    }
    await prisma.$executeRawUnsafe(`UPDATE "Empresa" SET "integradorId"=$1,"apiPublicId"='iss_qaA1' WHERE id=$2`, INT_A, EMISOR_A1);
    await prisma.$executeRawUnsafe(`UPDATE "Empresa" SET "integradorId"=$1,"apiPublicId"='iss_qaA2' WHERE id=$2`, INT_A, EMISOR_A2);
    await prisma.$executeRawUnsafe(`UPDATE "Empresa" SET "integradorId"=$1,"apiPublicId"='iss_qaB1' WHERE id=$2`, INT_B, EMISOR_B1);
    clienteA1 = await cliente(EMISOR_A1);
    clienteA2 = await cliente(EMISOR_A2);
    clienteB1 = await cliente(EMISOR_B1);
    medidor = new MedidorApiService(prisma as never);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "Comprobante" WHERE "empresaId" >= 9410`);
    await prisma.$executeRawUnsafe(`DELETE FROM "ConsumoApiMes" WHERE "integradorId" >= 9400`);
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "ConsumoApiMes" WHERE "integradorId" >= 9400`);
    await limpiar(prisma, 9400);
    await prisma.$disconnect();
  });

  describe('qué entra en la cuenta', () => {
    it('cuenta lo que SUNAT aceptó y nada más', async () => {
      await emitido(EMISOR_A1, clienteA1, 'EMITIDO');
      await emitido(EMISOR_A1, clienteA1, 'EMITIDO');
      await emitido(EMISOR_A1, clienteA1, 'RECHAZADO');          // no se cobra
      await emitido(EMISOR_A1, clienteA1, 'PENDIENTE');          // todavía no
      await emitido(EMISOR_A1, clienteA1, 'PENDIENTE_CONCILIACION', { cdr: JSON.stringify({ code: '1033' }) });
      const c: any = await medidor.consumo(INT_A, PERIODO);
      expect(c.billable_count).toBe(2);
    });

    it('un anulado SÍ se cobra: existió y gastó la firma', async () => {
      await emitido(EMISOR_A1, clienteA1, 'ANULADO', { cdr: CDR_OK });
      expect((await medidor.consumo(INT_A, PERIODO) as any).billable_count).toBe(1);
    });

    it('una nota de venta no se cobra: nunca fue a SUNAT', async () => {
      await emitido(EMISOR_A1, clienteA1, 'NO_APLICA');
      expect((await medidor.consumo(INT_A, PERIODO) as any).billable_count).toBe(0);
    });

    it('un comprobante del panel no se le cobra al integrador', async () => {
      // No nació por la API: es una venta que el empresario hizo por su cuenta.
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Comprobante" ("tipoDoc",serie,correlativo,"fechaEmision","formaPagoTipo","formaPagoMoneda","tipoMoneda","mtoOperGravadas","mtoIGV","valorVenta","totalImpuestos","subTotal","mtoImpVenta","clienteId","empresaId","estadoEnvioSunat","tipoOperacionId","sunatCdrResponse")
         VALUES ('01','F500',1,make_timestamp(2026,9,15,10,0,0),'Contado','PEN','PEN',1,0.18,1,0.18,1,1.18,$1,$2,'EMITIDO',1,$3)`,
        clienteA1, EMISOR_A1, CDR_OK);
      expect((await medidor.consumo(INT_A, PERIODO) as any).billable_count).toBe(0);
    });

    it('lo de otro mes no entra en este período', async () => {
      await emitido(EMISOR_A1, clienteA1, 'EMITIDO', { mes: 8 });
      await emitido(EMISOR_A1, clienteA1, 'EMITIDO', { mes: 10 });
      await emitido(EMISOR_A1, clienteA1, 'EMITIDO', { mes: 9 });
      expect((await medidor.consumo(INT_A, PERIODO) as any).billable_count).toBe(1);
    });

    it('el último día del mes a las 23:xx entra en su mes, no en el siguiente', async () => {
      // Con UTC este caería en octubre y el integrador lo vería en la factura
      // equivocada.
      await prisma.$executeRawUnsafe(
        `UPDATE "Comprobante" SET "fechaEmision"=make_timestamp(2026,9,30,23,50,0) WHERE id=$1`,
        await emitido(EMISOR_A1, clienteA1, 'EMITIDO'));
      expect((await medidor.consumo(INT_A, PERIODO) as any).billable_count).toBe(1);
    });
  });

  describe('cada integrador paga lo suyo', () => {
    it('la cuenta de uno no incluye los comprobantes del otro', async () => {
      await emitido(EMISOR_A1, clienteA1, 'EMITIDO');
      await emitido(EMISOR_B1, clienteB1, 'EMITIDO');
      await emitido(EMISOR_B1, clienteB1, 'EMITIDO');
      expect((await medidor.consumo(INT_A, PERIODO) as any).billable_count).toBe(1);
      expect((await medidor.consumo(INT_B, PERIODO) as any).billable_count).toBe(2);
    });

    it('suma los emisores del integrador y los detalla por separado', async () => {
      await emitido(EMISOR_A1, clienteA1, 'EMITIDO');
      await emitido(EMISOR_A1, clienteA1, 'EMITIDO');
      await emitido(EMISOR_A2, clienteA2, 'EMITIDO');
      const c: any = await medidor.consumo(INT_A, PERIODO);
      expect(c.billable_count).toBe(3);
      expect(c.by_issuer).toEqual([
        { issuer_id: 'iss_qaA1', name: 'EMISOR A1', ruc: expect.any(String), count: 2 },
        { issuer_id: 'iss_qaA2', name: 'EMISOR A2', ruc: expect.any(String), count: 1 },
      ]);
    });
  });

  describe('el cobro', () => {
    it('aplica el mínimo mensual cuando el consumo queda debajo', async () => {
      await emitido(EMISOR_A1, clienteA1, 'EMITIDO');
      const c: any = await medidor.consumo(INT_A, PERIODO);
      expect(c.subtotal).toBe(30);
      expect(c.minimum_applied).toBe(true);
      expect(c.total).toBe(35.4);
    });

    it('un mes sin un solo comprobante igual paga el mínimo', async () => {
      const c: any = await medidor.consumo(INT_A, PERIODO);
      expect(c.billable_count).toBe(0);
      expect(c.total).toBe(35.4);
    });
  });

  describe('cerrar el período NO puede cobrar dos veces', () => {
    it('cerrar dos veces deja un solo cobro', async () => {
      // Es la falla que nadie revisaría: la factura del mes se ve normal.
      for (let i = 0; i < 3; i++) await emitido(EMISOR_A1, clienteA1, 'EMITIDO');
      const p = await medidor.cerrarPeriodo(INT_A, PERIODO);
      expect(p.yaEstaba).toBe(false);
      expect(p.cantidad).toBe(3);

      const s = await medidor.cerrarPeriodo(INT_A, PERIODO);
      expect(s.yaEstaba).toBe(true);
      expect(await prisma.consumoApiMes.count({ where: { integradorId: INT_A, periodo: PERIODO } })).toBe(1);
    });

    it('la base lo impide incluso si dos procesos cierran a la vez', async () => {
      // El índice único es la defensa que sobrevive a dos instancias.
      await emitido(EMISOR_A1, clienteA1, 'EMITIDO');
      const [a, b] = await Promise.all([
        medidor.cerrarPeriodo(INT_A, PERIODO),
        medidor.cerrarPeriodo(INT_A, PERIODO),
      ]);
      expect(await prisma.consumoApiMes.count({ where: { integradorId: INT_A, periodo: PERIODO } })).toBe(1);
      expect([a.yaEstaba, b.yaEstaba].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    });

    it('marca cada comprobante con el período en que se cobró', async () => {
      await emitido(EMISOR_A1, clienteA1, 'EMITIDO');
      await emitido(EMISOR_A1, clienteA1, 'RECHAZADO');
      await medidor.cerrarPeriodo(INT_A, PERIODO);
      const marcados = await prisma.comprobante.count({
        where: { empresaId: EMISOR_A1, apiPeriodoFacturado: PERIODO } });
      // Solo el cobrable queda marcado: el rechazado sigue libre.
      expect(marcados).toBe(1);
    });
  });

  describe('no se pierde lo que SUNAT acepta tarde', () => {
    it('un comprobante aceptado después del cierre cae en el próximo', async () => {
      // El caso real: se emitió el 30 y SUNAT recién lo aceptó cuando el mes
      // ya estaba cerrado. Perderlo seria regalarle el comprobante.
      const tarde = await emitido(EMISOR_A1, clienteA1, 'PENDIENTE', { dia: 30 });
      await emitido(EMISOR_A1, clienteA1, 'EMITIDO');
      const primero = await medidor.cerrarPeriodo(INT_A, PERIODO);
      expect(primero.cantidad).toBe(1); // el pendiente no se cobró

      // SUNAT responde después del cierre.
      await prisma.$executeRawUnsafe(
        `UPDATE "Comprobante" SET "estadoEnvioSunat"='EMITIDO',"sunatCdrResponse"=$1 WHERE id=$2`, CDR_OK, tarde);

      // Sigue sin marca, así que el próximo cierre lo toma.
      const sinMarcar = await prisma.comprobante.count({
        where: { id: tarde, apiPeriodoFacturado: null } });
      expect(sinMarcar).toBe(1);

      await prisma.$executeRawUnsafe(`DELETE FROM "ConsumoApiMes" WHERE "integradorId"=$1`, INT_A);
      const segundo = await medidor.cerrarPeriodo(INT_A, PERIODO);
      expect(segundo.cantidad).toBe(1); // el que faltaba
    });
  });

  describe('un período cerrado no se mueve más', () => {
    it('devuelve lo congelado y no un recálculo', async () => {
      // Es lo que dice la factura que el integrador ya tiene en la mano.
      await emitido(EMISOR_A1, clienteA1, 'EMITIDO');
      await medidor.cerrarPeriodo(INT_A, PERIODO);
      const cerrado: any = await medidor.consumo(INT_A, PERIODO);
      expect(cerrado.status).toBe('closed');
      expect(cerrado.closed_at).toBeTruthy();

      // Llegan dos comprobantes más al mismo período, ya cerrado.
      await emitido(EMISOR_A1, clienteA1, 'EMITIDO');
      await emitido(EMISOR_A1, clienteA1, 'EMITIDO');
      const otraVez: any = await medidor.consumo(INT_A, PERIODO);
      expect(otraVez.billable_count).toBe(cerrado.billable_count);
      expect(otraVez.total).toBe(cerrado.total);
    });

    it('el mes en curso se informa abierto', async () => {
      const c: any = await medidor.consumo(INT_A, PERIODO);
      expect(c.status).toBe('open');
      expect(c.closed_at).toBeUndefined();
    });
  });

  describe('el cierre masivo', () => {
    it('cierra a todos los integradores que tienen emisores', async () => {
      await emitido(EMISOR_A1, clienteA1, 'EMITIDO');
      await emitido(EMISOR_B1, clienteB1, 'EMITIDO');
      const r = await medidor.cerrarMesAnterior();
      const mios = r.filter((x) => x.integradorId === INT_A || x.integradorId === INT_B);
      expect(mios.length).toBe(2);
    });

    it('una empresa sin emisores no genera cobro', async () => {
      // No es integrador: es un cliente común del ERP.
      const r = await medidor.cerrarMesAnterior();
      expect(r.some((x) => x.integradorId === EMISOR_A1)).toBe(false);
    });
  });
});
