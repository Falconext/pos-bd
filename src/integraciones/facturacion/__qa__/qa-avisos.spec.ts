/**
 * QA funcional de los avisos por webhook, contra Postgres real.
 *
 * Lo que se prueba es la promesa que le hacemos al integrador: **te avisamos
 * una vez por cada cambio y no te avisamos de más**. Las dos mitades duelen
 * distinto. Si falta un aviso, el integrador nunca se entera de que SUNAT
 * aceptó y su venta queda colgada. Si sobra, cada 30 segundos le llega el
 * mismo evento y su sistema procesa la misma factura para siempre.
 *
 * Va contra la base porque lo que decide es el estado guardado y la
 * comparación con el último avisado, no la lógica en memoria.
 *
 *   QA_DB=1 QA_DATABASE_URL=… npx jest src/integraciones/facturacion/__qa__
 */
import { PrismaClient } from '@prisma/client';
import { AvisosFacturacionService } from '../avisos.service';

const correr = process.env.QA_DB === '1' ? describe : describe.skip;
const URL_QA = process.env.QA_DATABASE_URL ?? '';

correr('avisos por webhook, contra Postgres real', () => {
  jest.setTimeout(90_000);
  let prisma: PrismaClient;
  let avisos: AvisosFacturacionService;

  const INTEGRADOR = 9301;
  const EMISOR = 9302;
  const entregados: Array<{ empresaId: number; evento: string; producto: string; cuerpo: any }> = [];
  const webhooksFalsos = {
    dispatchEvent: jest.fn(async (empresaId: number, evento: string, cuerpo: any, producto: string) => {
      entregados.push({ empresaId, evento, cuerpo, producto });
      return { entregados: 1, total: 1 };
    }),
  };

  /** Crea un comprobante en el estado pedido y devuelve su id interno. */
  const comprobante = async (estado: string, apiPublicId: string | null, cdr?: string) => {
    const cli: any = await prisma.$queryRawUnsafe(
      `INSERT INTO "Cliente" (nombre,"nroDoc","empresaId","tipoDocumentoId") VALUES ('CLIENTE QA','20600000001',$1,2) RETURNING id`, EMISOR);
    const r: any = await prisma.$queryRawUnsafe(
      `INSERT INTO "Comprobante"
        ("tipoDoc",serie,correlativo,"fechaEmision","formaPagoTipo","formaPagoMoneda","tipoMoneda",
         "mtoOperGravadas","mtoIGV","valorVenta","totalImpuestos","subTotal","mtoImpVenta",
         "clienteId","empresaId","estadoEnvioSunat","tipoOperacionId","apiPublicId","sunatCdrResponse")
       VALUES ('01','F001',(SELECT coalesce(max(correlativo),0)+1 FROM "Comprobante" WHERE "empresaId"=$1),
               now(),'Contado','PEN','PEN',1000,180,1000,180,1000,1180,$2,$1,$3::"EstadoSunat",1,$4,$5)
       RETURNING id`, EMISOR, cli[0].id, estado, apiPublicId, cdr ?? null);
    return r[0].id as number;
  };

  const mover = (id: number, estado: string) =>
    prisma.$executeRawUnsafe(`UPDATE "Comprobante" SET "estadoEnvioSunat"=$1::"EstadoSunat" WHERE id=$2`, estado, id);

  beforeAll(async () => {
    if (!URL_QA) throw new Error('falta QA_DATABASE_URL');
    prisma = new PrismaClient({ datasources: { db: { url: URL_QA } } });
    await prisma.$connect();
    await prisma.$executeRawUnsafe(`INSERT INTO "Plan" (id,nombre) VALUES (900,'QA') ON CONFLICT (id) DO NOTHING`);
    for (const [id, razon] of [[INTEGRADOR, 'INTEGRADOR AVISOS'], [EMISOR, 'EMISOR AVISOS']] as [number, string][]) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Empresa" (id,ruc,"razonSocial",direccion,"fechaActivacion","fechaExpiracion","planId")
         VALUES ($1,$2,$3,'Av. QA',now(),now()+interval '1 year',900) ON CONFLICT (id) DO NOTHING`,
        id, String(20600000000 + id), razon);
    }
    await prisma.$executeRawUnsafe(`INSERT INTO "TipoDocumento" (id,codigo,descripcion) VALUES (2,'6','RUC') ON CONFLICT (id) DO NOTHING`);
    await prisma.$executeRawUnsafe(`INSERT INTO "TipoOperacion" (id,codigo,descripcion) VALUES (1,'0101','VENTA INTERNA') ON CONFLICT (id) DO NOTHING`);
    await prisma.$executeRawUnsafe(`UPDATE "Empresa" SET "integradorId"=$1,"apiPublicId"='iss_qaAvisos',"usuarioPse"='QA01',"apiEmisorEstado"='activo' WHERE id=$2`, INTEGRADOR, EMISOR);
    avisos = new AvisosFacturacionService(prisma as never, webhooksFalsos as never);
  });

  beforeEach(async () => {
    entregados.length = 0;
    webhooksFalsos.dispatchEvent.mockClear();
    await prisma.$executeRawUnsafe(`DELETE FROM "Comprobante" WHERE "empresaId"=$1`, EMISOR);
    await prisma.$executeRawUnsafe(`DELETE FROM "Cliente" WHERE "empresaId"=$1`, EMISOR);
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "Comprobante" WHERE "empresaId">=9300`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Cliente" WHERE "empresaId">=9300`);
    await prisma.$executeRawUnsafe(`UPDATE "Empresa" SET "integradorId"=NULL WHERE id>=9300`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Empresa" WHERE id>=9300`);
    await prisma.$disconnect();
  });

  describe('avisa una vez y no más', () => {
    it('cuando SUNAT acepta, manda invoice.accepted', async () => {
      const id = await comprobante('PENDIENTE', 'inv_qa001');
      await avisos.avisarPendientes();          // nace pending: no se avisa
      expect(entregados).toHaveLength(0);

      await mover(id, 'EMITIDO');
      await avisos.avisarPendientes();
      expect(entregados.map((e) => e.evento)).toEqual(['invoice.accepted']);
    });

    it('un segundo barrido NO reenvía el mismo evento', async () => {
      // Sin esto, cada 30 segundos le llega la misma factura al integrador y
      // su sistema la procesa para siempre.
      const id = await comprobante('EMITIDO', 'inv_qa002');
      await avisos.avisarPendientes();
      expect(entregados).toHaveLength(1);
      await avisos.avisarPendientes();
      await avisos.avisarPendientes();
      expect(entregados).toHaveLength(1);
    });

    it('si el estado vuelve a cambiar, avisa de nuevo', async () => {
      const id = await comprobante('EMITIDO', 'inv_qa003');
      await avisos.avisarPendientes();
      await mover(id, 'ANULADO');
      await avisos.avisarPendientes();
      expect(entregados.map((e) => e.evento)).toEqual(['invoice.accepted', 'invoice.voided']);
    });

    it('un estado final deja de mirarse: no vuelve a entrar en la consulta', async () => {
      await comprobante('EMITIDO', 'inv_qa004');
      await avisos.avisarPendientes();
      const c = await prisma.comprobante.findFirst({ where: { apiPublicId: 'inv_qa004' } });
      expect(c!.apiEstadoNotificado).toBe('accepted');
      expect(AvisosFacturacionService.finales).toContain('accepted');
    });
  });

  describe('a quién le llega', () => {
    it('al integrador, no al emisor', async () => {
      // El emisor es el dueño del RUC; el que registró el endpoint y tiene
      // que reaccionar es el integrador.
      await comprobante('EMITIDO', 'inv_qa005');
      await avisos.avisarPendientes();
      expect(entregados[0].empresaId).toBe(INTEGRADOR);
      expect(entregados[0].empresaId).not.toBe(EMISOR);
    });

    it('va marcado como producto facturacion', async () => {
      // Si fuera sin marcar, lo recibiría quien registró un endpoint para
      // seguir sus envíos — con el RUC y el nombre del cliente adentro.
      await comprobante('EMITIDO', 'inv_qa006');
      await avisos.avisarPendientes();
      expect(entregados[0].producto).toBe('facturacion');
    });

    it('el cuerpo es el comprobante público, sin datos internos', async () => {
      await comprobante('EMITIDO', 'inv_qa007');
      await avisos.avisarPendientes();
      const cuerpo = entregados[0].cuerpo;
      expect(cuerpo.id).toBe('inv_qa007');
      expect(cuerpo.issuer_id).toBe('iss_qaAvisos');
      expect(JSON.stringify(cuerpo)).not.toContain(String(EMISOR));
    });
  });

  describe('lo que no se avisa', () => {
    it('un comprobante del panel nunca dispara un webhook', async () => {
      // No nació por la API: el integrador no tiene por qué enterarse de las
      // ventas que el empresario hizo por su cuenta.
      await comprobante('EMITIDO', null);
      await avisos.avisarPendientes();
      expect(entregados).toHaveLength(0);
    });

    it('una nota de venta tampoco', async () => {
      await comprobante('NO_APLICA', 'inv_qa008');
      await avisos.avisarPendientes();
      expect(entregados).toHaveLength(0);
    });

    it('pending no se avisa pero se marca, para no volver a mirarlo', async () => {
      await comprobante('PENDIENTE', 'inv_qa009');
      await avisos.avisarPendientes();
      expect(entregados).toHaveLength(0);
      const c = await prisma.comprobante.findFirst({ where: { apiPublicId: 'inv_qa009' } });
      expect(c!.apiEstadoNotificado).toBe('pending');
    });
  });

  describe('el caso M&T', () => {
    it('reconciling se avisa, y una sola vez aunque no sea final', async () => {
      // No es final: el comprobante sigue entrando en la consulta cada 30
      // segundos. Que no se reavise depende de la comparación, no de que
      // haya salido del conjunto de candidatos.
      const id = await comprobante('PENDIENTE_CONCILIACION', 'inv_qa010', JSON.stringify({ code: '1033' }));
      await avisos.avisarPendientes();
      await avisos.avisarPendientes();
      await avisos.avisarPendientes();
      expect(entregados.map((e) => e.evento)).toEqual(['invoice.reconciling']);
    });

    it('y cuando se resuelve, avisa el estado definitivo', async () => {
      const id = await comprobante('PENDIENTE_CONCILIACION', 'inv_qa011', JSON.stringify({ code: '1033' }));
      await avisos.avisarPendientes();
      await mover(id, 'EMITIDO');
      await avisos.avisarPendientes();
      expect(entregados.map((e) => e.evento)).toEqual(['invoice.reconciling', 'invoice.accepted']);
    });
  });

  describe('robustez del barrido', () => {
    it('procesa varios comprobantes en una pasada', async () => {
      for (let i = 0; i < 5; i++) await comprobante('EMITIDO', `inv_qaLote${i}`);
      const n = await avisos.avisarPendientes();
      expect(n).toBe(5);
      expect(entregados).toHaveLength(5);
    });

    it('respeta el límite para no barrer la base entera de una vez', async () => {
      for (let i = 0; i < 8; i++) await comprobante('EMITIDO', `inv_qaTope${i}`);
      expect(await avisos.avisarPendientes(3)).toBe(3);
    });

    it('el conjunto de candidatos se vacía: un barrido en reposo no hace nada', async () => {
      // Es la propiedad en la que se apoya todo el diseño. Si no drenara, la
      // consulta crecería con el histórico y —ordenada por id— se quedaría
      // releyendo los comprobantes más viejos sin llegar nunca a los nuevos.
      for (let i = 0; i < 4; i++) await comprobante('EMITIDO', `inv_qaDrena${i}`);
      await comprobante('ANULADO', 'inv_qaDrenaAnul');
      expect(await avisos.avisarPendientes()).toBe(5);
      expect(await avisos.avisarPendientes()).toBe(0);
      expect(await avisos.avisarPendientes()).toBe(0);
    });

    it('un anulado que ya estaba avisado como accepted vuelve a entrar UNA vez', async () => {
      // El caso exacto que la QA destapó: para anular hay que haber sido
      // aceptado, así que el comprobante ya había salido del conjunto.
      const id = await comprobante('EMITIDO', 'inv_qaBaja');
      await avisos.avisarPendientes();
      expect(entregados.map((e) => e.evento)).toEqual(['invoice.accepted']);
      await mover(id, 'ANULADO');
      expect(await avisos.avisarPendientes()).toBe(1);
      expect(await avisos.avisarPendientes()).toBe(0); // y no se repite
      expect(entregados.map((e) => e.evento)).toEqual(['invoice.accepted', 'invoice.voided']);
    });

    it('la lista de eventos posibles coincide con los estados del contrato', () => {
      expect(AvisosFacturacionService.eventosPosibles()).toEqual([
        'invoice.sent', 'invoice.accepted', 'invoice.observed',
        'invoice.rejected', 'invoice.reconciling', 'invoice.voided',
      ]);
    });
  });
});
