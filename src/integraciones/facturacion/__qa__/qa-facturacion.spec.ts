/**
 * QA funcional de la API de facturación, contra Postgres real.
 *
 * Con dobles no sirve. Lo que separa a un integrador de otro no es una línea
 * de TypeScript: es el `WHERE empresa.integradorId = …` de cada consulta, y
 * eso solo se demuestra contra la base. Si falla, un id filtrado o adivinado
 * deja leer el comprobante de otro — y con él el RUC, el nombre y la
 * dirección de su cliente.
 *
 * No se vuelve a probar acá el motor fiscal: `crearFormal` tiene sus propias
 * pruebas y 4,903 comprobantes aceptados en producción. Lo que se prueba es
 * lo que esta API agrega encima.
 *
 *   QA_DB=1 QA_DATABASE_URL=postgresql://…/qa_facturacion \
 *     npx jest src/integraciones/facturacion/__qa__
 */
import { PrismaClient } from '@prisma/client';
import { FacturacionApiService } from '../facturacion.service';
import { EmisoresService } from '../../emisores/emisores.service';
import { nuevoIdPublico } from '../serializador';

const correr = process.env.QA_DB === '1' ? describe : describe.skip;
const URL_QA = process.env.QA_DATABASE_URL ?? '';

correr('API de facturación contra Postgres real', () => {
  jest.setTimeout(90_000);
  let prisma: PrismaClient;
  let servicio: FacturacionApiService;
  let emisores: EmisoresService;

  // Dos integradores, cada uno con su emisor. El escenario que importa.
  const INTEGRADOR_A = 9101;
  const INTEGRADOR_B = 9102;
  const EMISOR_A = 9201;
  const EMISOR_B = 9202;
  const ISS_A = 'iss_qaAAAAAAAAAAAA';
  const ISS_B = 'iss_qaBBBBBBBBBBBB';

  /** El motor fiscal, reemplazado por una inserción equivalente. */
  const comprobantesFalsos = {
    crearFormal: jest.fn(async (dto: any, empresaId: number) => {
      const fila: any = await prisma.$queryRawUnsafe(
        `INSERT INTO "Comprobante"
          ("tipoDoc","serie","correlativo","fechaEmision","formaPagoTipo","formaPagoMoneda",
           "tipoMoneda","mtoOperGravadas","mtoIGV","valorVenta","totalImpuestos","subTotal",
           "mtoImpVenta","clienteId","empresaId","estadoEnvioSunat","tipoOperacionId")
         VALUES ($1,$2,(SELECT coalesce(max("correlativo"),0)+1 FROM "Comprobante" WHERE "empresaId"=$3),
                 now(),$4,$5,$6,1000,180,1000,180,1000,1180,$7,$3,'PENDIENTE',$8)
         RETURNING id`,
        dto.tipoDoc, dto.serie ?? 'F001', empresaId,
        dto.formaPagoTipo, dto.formaPagoMoneda, dto.tipoMoneda,
        dto.clienteId, dto.tipoOperacionId,
      );
      return { id: fila[0].id, empresaId };
    }),
  };
  const sunatFalso = { execute: jest.fn(async () => ({ ok: true })) };

  const emitirEn = (integrador: number, issuer: string, extra: any = {}) =>
    servicio.emitir(integrador, {
      issuer_id: issuer,
      document_type: 'invoice',
      customer: { document_type: 'ruc', document_number: '20601234567', name: 'ANDINA S.A.C.' },
      items: [{ description: 'Consultoría', quantity: 2, unit_value: 500 }],
      ...extra,
    });

  beforeAll(async () => {
    if (!URL_QA) throw new Error('falta QA_DATABASE_URL');
    prisma = new PrismaClient({ datasources: { db: { url: URL_QA } } });
    await prisma.$connect();

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Plan" (id,nombre,precio) VALUES (900,'QA',0) ON CONFLICT (id) DO NOTHING`,
    ).catch(() => prisma.$executeRawUnsafe(`INSERT INTO "Plan" (id,nombre) VALUES (900,'QA') ON CONFLICT (id) DO NOTHING`));

    for (const [id, razon] of [
      [INTEGRADOR_A, 'INTEGRADOR A'], [INTEGRADOR_B, 'INTEGRADOR B'],
      [EMISOR_A, 'EMISOR A'], [EMISOR_B, 'EMISOR B'],
    ] as [number, string][]) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Empresa" (id,ruc,"razonSocial",direccion,"fechaActivacion","fechaExpiracion","planId")
         VALUES ($1,$2,$3,'Av. QA 123',now(),now()+interval '1 year',900)
         ON CONFLICT (id) DO NOTHING`,
        id, String(20600000000 + id), razon,
      );
    }
    // Cada emisor bajo SU integrador.
    await prisma.$executeRawUnsafe(
      `UPDATE "Empresa" SET "integradorId"=$1,"apiPublicId"=$2 WHERE id=$3`, INTEGRADOR_A, ISS_A, EMISOR_A);
    await prisma.$executeRawUnsafe(
      `UPDATE "Empresa" SET "integradorId"=$1,"apiPublicId"=$2 WHERE id=$3`, INTEGRADOR_B, ISS_B, EMISOR_B);

    for (const [id, cod, desc] of [[1,'1','DNI'],[2,'6','RUC'],[3,'4','CE'],[4,'0','OTROS'],[5,'7','PASAPORTE']] as any[]) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "TipoDocumento" (id,codigo,descripcion) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`, id, cod, desc);
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TipoOperacion" (id,codigo,descripcion) VALUES (1,'0101','VENTA INTERNA') ON CONFLICT (id) DO NOTHING`);

    emisores = new EmisoresService(prisma as never);
    servicio = new FacturacionApiService(
      prisma as never, comprobantesFalsos as never, sunatFalso as never, emisores,
    );
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "DetalleComprobante" WHERE "comprobanteId" IN (SELECT id FROM "Comprobante" WHERE "empresaId">=9200)`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Comprobante" WHERE "empresaId" >= 9200`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Cliente" WHERE "empresaId" >= 9200`);
    await prisma.$executeRawUnsafe(`UPDATE "Empresa" SET "integradorId"=NULL WHERE id>=9100`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Empresa" WHERE id >= 9100`);
    await prisma.$disconnect();
  });

  describe('un integrador no ve lo del otro', () => {
    it('no puede leer un comprobante ajeno ni sabiendo su id', () => {
      // El escenario real: el id se filtró en un log, en una URL o por un
      // empleado que pasó de un integrador a otro.
      return (async () => {
        const deA: any = await emitirEn(INTEGRADOR_A, ISS_A);
        expect(deA.id).toMatch(/^inv_/);
        await expect(servicio.obtener(INTEGRADOR_B, deA.id)).rejects.toThrow();
        // Y el dueño sí lo lee.
        await expect(servicio.obtener(INTEGRADOR_A, deA.id)).resolves.toMatchObject({ id: deA.id });
      })();
    });

    it('no puede emitir con el emisor del otro', async () => {
      // Sin esto, conocer un issuer_id ajeno bastaría para firmar
      // comprobantes ante SUNAT a nombre de otra empresa.
      await expect(emitirEn(INTEGRADOR_B, ISS_A)).rejects.toThrow();
    });

    it('un emisor inexistente da el MISMO error que uno ajeno', async () => {
      // Si se distinguieran, se podría averiguar qué issuer_id son válidos
      // probando y mirando el mensaje.
      const ajeno = await emitirEn(INTEGRADOR_B, ISS_A).catch((e) => e.getResponse());
      const inexistente = await emitirEn(INTEGRADOR_B, 'iss_noExisteJamas').catch((e) => e.getResponse());
      expect((ajeno as any).code).toBe((inexistente as any).code);
    });

    it('el listado de cada uno trae solo lo suyo', async () => {
      await emitirEn(INTEGRADOR_A, ISS_A);
      await emitirEn(INTEGRADOR_B, ISS_B);
      const a = await servicio.listar(INTEGRADOR_A);
      const b = await servicio.listar(INTEGRADOR_B);
      const idsA = a.data.map((x: any) => x.id);
      const idsB = b.data.map((x: any) => x.id);
      expect(idsA.length).toBeGreaterThan(0);
      expect(idsB.length).toBeGreaterThan(0);
      expect(idsA.filter((x) => idsB.includes(x))).toEqual([]);
      expect(a.data.every((x: any) => x.issuer_id === ISS_A)).toBe(true);
    });
  });

  describe('el cliente se busca antes de crearse', () => {
    it('dos emisiones al mismo RUC no duplican el cliente', async () => {
      // Sin esto, la cartera del empresario se llena de copias del mismo
      // cliente, una por cada venta que hizo el integrador.
      const antes = await prisma.cliente.count({ where: { empresaId: EMISOR_A, nroDoc: '20601234567' } });
      await emitirEn(INTEGRADOR_A, ISS_A);
      await emitirEn(INTEGRADOR_A, ISS_A);
      const despues = await prisma.cliente.count({ where: { empresaId: EMISOR_A, nroDoc: '20601234567' } });
      expect(despues).toBe(Math.max(antes, 1));
    });

    it('el mismo RUC en otro emisor es otro cliente', async () => {
      // Dos emisores tienen carteras distintas aunque el cliente final sea
      // el mismo: la de uno no es asunto del otro.
      await emitirEn(INTEGRADOR_B, ISS_B);
      const enA = await prisma.cliente.findFirst({ where: { empresaId: EMISOR_A, nroDoc: '20601234567' } });
      const enB = await prisma.cliente.findFirst({ where: { empresaId: EMISOR_B, nroDoc: '20601234567' } });
      expect(enA).toBeTruthy();
      expect(enB).toBeTruthy();
      expect(enA!.id).not.toBe(enB!.id);
    });

    it('completa lo que falta pero no pisa lo que el empresario ya cargó', async () => {
      const cli = await prisma.cliente.findFirst({ where: { empresaId: EMISOR_A, nroDoc: '20601234567' } });
      await prisma.cliente.update({ where: { id: cli!.id }, data: { email: 'elquecargo@empresa.pe', direccion: null } });
      await emitirEn(INTEGRADOR_A, ISS_A, {
        customer: { document_type: 'ruc', document_number: '20601234567', name: 'ANDINA S.A.C.',
                    email: 'otro@integrador.pe', address: 'Av. Nueva 456' },
      });
      const despues = await prisma.cliente.findUnique({ where: { id: cli!.id } });
      expect(despues!.email).toBe('elquecargo@empresa.pe'); // intacto
      expect(despues!.direccion).toBe('Av. Nueva 456');     // estaba vacío: se completa
    });
  });

  describe('el id público', () => {
    it('es único a nivel de base, no solo de proceso', async () => {
      // El índice único es la última defensa: si dos procesos generaran el
      // mismo id, la base lo impide en vez de dejar dos comprobantes
      // respondiendo a la misma consulta.
      const uno: any = await emitirEn(INTEGRADOR_A, ISS_A);
      await expect(
        prisma.$executeRawUnsafe(`UPDATE "Comprobante" SET "apiPublicId"=$1 WHERE id=(SELECT min(id) FROM "Comprobante" WHERE "empresaId"=$2)`, uno.id, EMISOR_A),
      ).rejects.toThrow();
    });

    it('los comprobantes que no nacieron por la API no aparecen en el listado', async () => {
      // Son del panel del empresario: el integrador no tiene por qué verlos.
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Comprobante" ("tipoDoc",serie,correlativo,"fechaEmision","formaPagoTipo","formaPagoMoneda","tipoMoneda","mtoOperGravadas","mtoIGV","valorVenta","totalImpuestos","subTotal","mtoImpVenta","clienteId","empresaId","estadoEnvioSunat","tipoOperacionId")
         SELECT '01','F999',1,now(),'Contado','PEN','PEN',1,0.18,1,0.18,1,1.18,c.id,$1,'EMITIDO',1 FROM "Cliente" c WHERE c."empresaId"=$1 LIMIT 1`, EMISOR_A);
      const l = await servicio.listar(INTEGRADOR_A, { limite: 100 });
      expect(l.data.every((x: any) => x.id?.startsWith('inv_'))).toBe(true);
      expect(l.data.some((x: any) => x.series === 'F999')).toBe(false);
    });
  });

  describe('la paginación no saltea comprobantes', () => {
    it('una emisión nueva no corre las filas de la página siguiente', async () => {
      // Con `offset` pasaría: el integrador que recorre su historial se
      // saltearía comprobantes sin notarlo. Por eso se pagina por cursor.
      for (let i = 0; i < 5; i++) await emitirEn(INTEGRADOR_A, ISS_A);
      const p1 = await servicio.listar(INTEGRADOR_A, { limite: 3 });
      expect(p1.has_more).toBe(true);
      await emitirEn(INTEGRADOR_A, ISS_A); // llega uno nuevo en el medio
      const p2 = await servicio.listar(INTEGRADOR_A, { limite: 3, cursor: p1.next_cursor! });
      const repetidos = p2.data.filter((x: any) => p1.data.some((y: any) => y.id === x.id));
      expect(repetidos).toEqual([]);
    });

    it('el límite se acota: pedir 10000 no baja la base entera', async () => {
      const l = await servicio.listar(INTEGRADOR_A, { limite: 10000 });
      expect(l.data.length).toBeLessThanOrEqual(100);
    });
  });

  describe('lo que se devuelve', () => {
    it('un comprobante recién emitido queda pending y no promete CDR', async () => {
      const r: any = await emitirEn(INTEGRADOR_A, ISS_A);
      expect(r.status).toBe('pending');
      expect(r.sunat.cdr_available).toBe(false);
      expect(r.full_number).toMatch(/^F001-\d{8}$/);
    });

    it('no filtra el id interno ni el de la empresa', async () => {
      const r: any = await emitirEn(INTEGRADOR_A, ISS_A);
      const texto = JSON.stringify(r);
      expect(texto).not.toContain(String(EMISOR_A));
      expect(r.issuer_id).toBe(ISS_A);
    });

    it('el envío a SUNAT se dispara pero no se espera', async () => {
      sunatFalso.execute.mockClear();
      await emitirEn(INTEGRADOR_A, ISS_A);
      expect(sunatFalso.execute).toHaveBeenCalled();
    });

    it('si el disparo a SUNAT falla, el comprobante igual queda guardado', async () => {
      // El scheduler lo recoge después. Perder el comprobante porque el
      // envío falló sería mucho peor: el correlativo ya se consumió.
      sunatFalso.execute.mockRejectedValueOnce(new Error('QPSE caído'));
      const r: any = await emitirEn(INTEGRADOR_A, ISS_A);
      expect(r.status).toBe('pending');
      await expect(servicio.obtener(INTEGRADOR_A, r.id)).resolves.toBeTruthy();
    });
  });

  describe('la validación corre antes de tocar la base', () => {
    it('una factura a DNI no crea cliente ni comprobante', async () => {
      const antes = await prisma.comprobante.count({ where: { empresaId: EMISOR_A } });
      await expect(
        emitirEn(INTEGRADOR_A, ISS_A, {
          customer: { document_type: 'dni', document_number: '44556677', name: 'Ana Quispe' },
        }),
      ).rejects.toThrow();
      expect(await prisma.comprobante.count({ where: { empresaId: EMISOR_A } })).toBe(antes);
      expect(await prisma.cliente.count({ where: { empresaId: EMISOR_A, nroDoc: '44556677' } })).toBe(0);
    });

    it('un crédito sin vencimiento tampoco', async () => {
      const antes = await prisma.comprobante.count({ where: { empresaId: EMISOR_A } });
      await expect(
        emitirEn(INTEGRADOR_A, ISS_A, { payment_terms: { type: 'credit' } }),
      ).rejects.toThrow();
      expect(await prisma.comprobante.count({ where: { empresaId: EMISOR_A } })).toBe(antes);
    });
  });

  it('el id público no colisiona en 20,000 generaciones', () => {
    expect(new Set(Array.from({ length: 20_000 }, () => nuevoIdPublico())).size).toBe(20_000);
  });
});
