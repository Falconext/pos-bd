/**
 * Siembra datos de DEMO para la cuenta de ropa (demo.ropa@krezka.com): ventas
 * de los últimos 6 meses con clientes en todo el Perú, envíos por Shalom, Olva y
 * repartidores propios con el MISMO formato que dejan las integraciones reales
 * (shalomTrackingJson / olvaTrackingJson, estados, historial, agencia destino),
 * para que la pestaña "Clientes y envíos", el tablero de couriers, el despacho
 * y los modales de rastreo se vean con volumen.
 *
 * - Solo inserta en la empresa del usuario DEMO_EMAIL (no toca otras).
 * - Reversible e idempotente: usa las series B0D1/F0D1, clientes con email
 *   @demo-seed.krezka.com y repartidores con celular 99900000x. Con LIMPIAR=1
 *   borra todo lo sembrado; si ya hay siembra, primero la limpia.
 * - NO mueve kardex ni caja: son ventas "históricas" para análisis.
 *
 * Uso:  npx ts-node src/scripts/seed-demo-despachos.ts
 *   Variables: DEMO_EMAIL, VENTAS (default 420), DIAS (default 180),
 *              LIMPIAR=1 (solo borra), DRY_RUN=1
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_EMAIL = process.env.DEMO_EMAIL || 'demo.ropa@krezka.com';
const VENTAS = Number(process.env.VENTAS || 420);
const DIAS = Number(process.env.DIAS || 180);
const SOLO_LIMPIAR = process.env.LIMPIAR === '1';
const DRY_RUN = process.env.DRY_RUN === '1';

const SERIE_BOLETA = 'B0D1';
const SERIE_FACTURA = 'F0D1';
const EMAIL_SEED = '@demo-seed.krezka.com';
const CELULAR_REPARTIDOR_PREFIX = '9990000';

// ─── Aleatorio determinista (misma siembra en cada corrida) ───────────────────
let seed = 20260911;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const entre = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const elegir = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const ponderado = <T>(items: { v: T; w: number }[]): T => {
  const total = items.reduce((s, i) => s + i.w, 0);
  let r = rnd() * total;
  for (const it of items) {
    r -= it.w;
    if (r <= 0) return it.v;
  }
  return items[items.length - 1].v;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

// ─── Destinos (agencias Shalom / Olva con el formato real "AGENCIA - PROVINCIA - DEPARTAMENTO") ──
interface Destino {
  distrito: string;
  provincia: string;
  departamento: string;
  ubigeo: string;
  agenciaShalom: string;
  agenciaOlva: string;
  olvaCodigo: string;
  w: number;
  lima?: boolean;
}
const DESTINOS: Destino[] = [
  { distrito: 'AREQUIPA', provincia: 'AREQUIPA', departamento: 'AREQUIPA', ubigeo: '040101', agenciaShalom: 'AV. JESUS - AREQUIPA - AREQUIPA', agenciaOlva: 'AREQUIPA CENTRO', olvaCodigo: 'AQP01', w: 14 },
  { distrito: 'TRUJILLO', provincia: 'TRUJILLO', departamento: 'LA LIBERTAD', ubigeo: '130101', agenciaShalom: 'CALLE LIVERPOOL - TRUJILLO - LA LIBERTAD', agenciaOlva: 'TRUJILLO CENTRO', olvaCodigo: 'TRU01', w: 12 },
  { distrito: 'CHICLAYO', provincia: 'CHICLAYO', departamento: 'LAMBAYEQUE', ubigeo: '140101', agenciaShalom: 'AV. BOLOGNESI - CHICLAYO - LAMBAYEQUE', agenciaOlva: 'CHICLAYO', olvaCodigo: 'CIX01', w: 9 },
  { distrito: 'PIURA', provincia: 'PIURA', departamento: 'PIURA', ubigeo: '200101', agenciaShalom: 'AV. SANCHEZ CERRO - PIURA - PIURA', agenciaOlva: 'PIURA', olvaCodigo: 'PIU01', w: 8 },
  { distrito: 'CUSCO', provincia: 'CUSCO', departamento: 'CUSCO', ubigeo: '080101', agenciaShalom: 'AV. LA CULTURA - CUSCO - CUSCO', agenciaOlva: 'CUSCO', olvaCodigo: 'CUZ01', w: 8 },
  { distrito: 'HUANCAYO', provincia: 'HUANCAYO', departamento: 'JUNIN', ubigeo: '120101', agenciaShalom: 'JR. AREQUIPA - HUANCAYO - JUNIN', agenciaOlva: 'HUANCAYO', olvaCodigo: 'HUY01', w: 7 },
  { distrito: 'JULIACA', provincia: 'SAN ROMAN', departamento: 'PUNO', ubigeo: '211101', agenciaShalom: 'JR. MAMA OCLLO - SAN ROMAN - PUNO', agenciaOlva: 'JULIACA', olvaCodigo: 'JUL01', w: 6 },
  { distrito: 'ICA', provincia: 'ICA', departamento: 'ICA', ubigeo: '110101', agenciaShalom: 'AV. MATIAS MANZANILLA - ICA - ICA', agenciaOlva: 'ICA', olvaCodigo: 'ICA01', w: 6 },
  { distrito: 'TACNA', provincia: 'TACNA', departamento: 'TACNA', ubigeo: '230101', agenciaShalom: 'AV. BOLOGNESI - TACNA - TACNA', agenciaOlva: 'TACNA', olvaCodigo: 'TCQ01', w: 4 },
  { distrito: 'IQUITOS', provincia: 'MAYNAS', departamento: 'LORETO', ubigeo: '160101', agenciaShalom: 'JR. PROSPERO - MAYNAS - LORETO', agenciaOlva: 'IQUITOS', olvaCodigo: 'IQT01', w: 4 },
  { distrito: 'CALLERIA', provincia: 'CORONEL PORTILLO', departamento: 'UCAYALI', ubigeo: '250101', agenciaShalom: 'JR. TARAPACA - CORONEL PORTILLO - UCAYALI', agenciaOlva: 'PUCALLPA', olvaCodigo: 'PCL01', w: 3 },
  { distrito: 'CAJAMARCA', provincia: 'CAJAMARCA', departamento: 'CAJAMARCA', ubigeo: '060101', agenciaShalom: 'JR. AMAZONAS - CAJAMARCA - CAJAMARCA', agenciaOlva: 'CAJAMARCA', olvaCodigo: 'CJA01', w: 4 },
  { distrito: 'HUARAZ', provincia: 'HUARAZ', departamento: 'ANCASH', ubigeo: '020101', agenciaShalom: 'AV. RAYMONDI - HUARAZ - ANCASH', agenciaOlva: 'HUARAZ', olvaCodigo: 'HUZ01', w: 3 },
  { distrito: 'CHIMBOTE', provincia: 'SANTA', departamento: 'ANCASH', ubigeo: '021801', agenciaShalom: 'AV. PARDO - SANTA - ANCASH', agenciaOlva: 'CHIMBOTE', olvaCodigo: 'CHM01', w: 4 },
  { distrito: 'TARAPOTO', provincia: 'SAN MARTIN', departamento: 'SAN MARTIN', ubigeo: '220901', agenciaShalom: 'JR. JIMENEZ PIMENTEL - SAN MARTIN - SAN MARTIN', agenciaOlva: 'TARAPOTO', olvaCodigo: 'TPP01', w: 3 },
  { distrito: 'PUNO', provincia: 'PUNO', departamento: 'PUNO', ubigeo: '210101', agenciaShalom: 'JR. TACNA - PUNO - PUNO', agenciaOlva: 'PUNO', olvaCodigo: 'PUN01', w: 2 },
  { distrito: 'AYACUCHO', provincia: 'HUAMANGA', departamento: 'AYACUCHO', ubigeo: '050101', agenciaShalom: 'AV. MARISCAL CACERES - HUAMANGA - AYACUCHO', agenciaOlva: 'AYACUCHO', olvaCodigo: 'AYP01', w: 2 },
  { distrito: 'TUMBES', provincia: 'TUMBES', departamento: 'TUMBES', ubigeo: '240101', agenciaShalom: 'AV. TUMBES - TUMBES - TUMBES', agenciaOlva: 'TUMBES', olvaCodigo: 'TBP01', w: 2 },
  { distrito: 'HUANUCO', provincia: 'HUANUCO', departamento: 'HUANUCO', ubigeo: '100101', agenciaShalom: 'JR. 28 DE JULIO - HUANUCO - HUANUCO', agenciaOlva: 'HUANUCO', olvaCodigo: 'HUU01', w: 2 },
  { distrito: 'MOQUEGUA', provincia: 'MARISCAL NIETO', departamento: 'MOQUEGUA', ubigeo: '180101', agenciaShalom: 'AV. BALTA - MARISCAL NIETO - MOQUEGUA', agenciaOlva: 'MOQUEGUA', olvaCodigo: 'MOQ01', w: 1 },
  // Lima: reparto propio (motorizado) o agencia
  { distrito: 'SAN MARTIN DE PORRES', provincia: 'LIMA', departamento: 'LIMA', ubigeo: '150135', agenciaShalom: 'AV. CANTA CALLAO - LIMA - LIMA', agenciaOlva: 'SAN MARTIN DE PORRES', olvaCodigo: 'LIM12', w: 6, lima: true },
  { distrito: 'SAN JUAN DE LURIGANCHO', provincia: 'LIMA', departamento: 'LIMA', ubigeo: '150132', agenciaShalom: 'AV. PROCERES - LIMA - LIMA', agenciaOlva: 'SAN JUAN DE LURIGANCHO', olvaCodigo: 'LIM09', w: 6, lima: true },
  { distrito: 'MIRAFLORES', provincia: 'LIMA', departamento: 'LIMA', ubigeo: '150122', agenciaShalom: 'AV. AREQUIPA - LIMA - LIMA', agenciaOlva: 'MIRAFLORES', olvaCodigo: 'LIM03', w: 5, lima: true },
  { distrito: 'SANTIAGO DE SURCO', provincia: 'LIMA', departamento: 'LIMA', ubigeo: '150140', agenciaShalom: 'AV. BENAVIDES - LIMA - LIMA', agenciaOlva: 'SURCO', olvaCodigo: 'LIM05', w: 5, lima: true },
  { distrito: 'COMAS', provincia: 'LIMA', departamento: 'LIMA', ubigeo: '150110', agenciaShalom: 'AV. TUPAC AMARU - LIMA - LIMA', agenciaOlva: 'COMAS', olvaCodigo: 'LIM14', w: 4, lima: true },
  { distrito: 'LOS OLIVOS', provincia: 'LIMA', departamento: 'LIMA', ubigeo: '150117', agenciaShalom: 'AV. ALFREDO MENDIOLA - LIMA - LIMA', agenciaOlva: 'LOS OLIVOS', olvaCodigo: 'LIM13', w: 4, lima: true },
  { distrito: 'ATE', provincia: 'LIMA', departamento: 'LIMA', ubigeo: '150103', agenciaShalom: 'CARRETERA CENTRAL - LIMA - LIMA', agenciaOlva: 'ATE', olvaCodigo: 'LIM08', w: 3, lima: true },
  { distrito: 'CALLAO', provincia: 'CALLAO', departamento: 'CALLAO', ubigeo: '070101', agenciaShalom: 'AV. SAENZ PEÑA - CALLAO - CALLAO', agenciaOlva: 'CALLAO', olvaCodigo: 'CAL01', w: 3, lima: true },
  { distrito: 'VILLA EL SALVADOR', provincia: 'LIMA', departamento: 'LIMA', ubigeo: '150142', agenciaShalom: 'AV. PACHACUTEC - LIMA - LIMA', agenciaOlva: 'VILLA EL SALVADOR', olvaCodigo: 'LIM20', w: 3, lima: true },
];

const NOMBRES = ['MARIA', 'JOSE', 'CARMEN', 'LUIS', 'ROSA', 'JUAN', 'ANA', 'CARLOS', 'LUCIA', 'JORGE', 'PATRICIA', 'MIGUEL', 'ELENA', 'PEDRO', 'GABRIELA', 'DIEGO', 'VALERIA', 'RICARDO', 'SOFIA', 'ANDRES', 'FIORELLA', 'MANUEL', 'CLAUDIA', 'FERNANDO', 'KARINA', 'RAUL', 'MILAGROS', 'ALBERTO', 'DANIELA', 'VICTOR', 'JESSICA', 'HUGO', 'ROCIO', 'ALEJANDRO', 'NATALIA', 'RENATO', 'PAOLA', 'MARCO', 'YESENIA', 'EDUARDO'];
const APELLIDOS = ['QUISPE', 'FLORES', 'GARCIA', 'RODRIGUEZ', 'HUAMAN', 'MAMANI', 'SANCHEZ', 'TORRES', 'RAMOS', 'CASTILLO', 'CHAVEZ', 'DIAZ', 'VASQUEZ', 'ROJAS', 'MENDOZA', 'GONZALES', 'PAREDES', 'SALAZAR', 'VARGAS', 'CRUZ', 'ESPINOZA', 'AGUILAR', 'CORDOVA', 'ZAPATA', 'GUTIERREZ', 'PONCE', 'CACERES', 'VILCA', 'CHOQUE', 'APAZA'];
const EMPRESAS = ['BOUTIQUE', 'TEXTILES', 'MODAS', 'CONFECCIONES', 'DISTRIBUIDORA', 'COMERCIAL', 'IMPORTACIONES', 'TIENDAS'];
const SUFIJOS = ['S.A.C.', 'E.I.R.L.', 'S.R.L.'];
const CALLES = ['AV. LOS INCAS', 'JR. AYACUCHO', 'CALLE LAS FLORES', 'AV. GRAU', 'JR. UNION', 'PSJE. LOS PINOS', 'AV. INDEPENDENCIA', 'CALLE SAN MARTIN', 'AV. EL SOL', 'JR. LIMA'];
const MEDIOS_PAGO = [{ v: 'YAPE', w: 35 }, { v: 'EFECTIVO', w: 20 }, { v: 'TRANSFERENCIA', w: 20 }, { v: 'PLIN', w: 12 }, { v: 'TARJETA', w: 13 }];
const REPARTIDORES = [
  { nombre: 'Kevin Huaman (moto)', tipo: 'PLANILLA' as const },
  { nombre: 'Luis Apaza (moto)', tipo: 'PLANILLA' as const },
  { nombre: 'Rosa Vilca (auto)', tipo: 'EVENTUAL' as const },
  { nombre: 'InDrive / mensajería', tipo: 'EVENTUAL' as const },
];

const pad = (n: number, l: number) => String(n).padStart(l, '0');
const fmtShalom = (d: Date) => {
  // "YYYY-MM-DD HH:mm:ss" en hora Lima, como lo devuelve Shalom
  const lima = new Date(d.getTime() - 5 * 3600 * 1000);
  return `${lima.getUTCFullYear()}-${pad(lima.getUTCMonth() + 1, 2)}-${pad(lima.getUTCDate(), 2)} ${pad(lima.getUTCHours(), 2)}:${pad(lima.getUTCMinutes(), 2)}:${pad(lima.getUTCSeconds(), 2)}`;
};
const addH = (d: Date, h: number) => new Date(d.getTime() + h * 3600 * 1000);
const clave = () => Array.from({ length: 4 }, () => elegir('ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.split(''))).join('');

async function limpiar(empresaId: number) {
  const comps = await prisma.comprobante.findMany({
    where: { empresaId, serie: { in: [SERIE_BOLETA, SERIE_FACTURA] } },
    select: { id: true },
  });
  const ids = comps.map((c) => c.id);
  console.log(`Limpiando siembra previa: ${ids.length} comprobantes`);
  if (DRY_RUN) return;
  if (ids.length) {
    await prisma.envioDespacho.deleteMany({ where: { comprobanteId: { in: ids } } });
    await prisma.pago.deleteMany({ where: { comprobanteId: { in: ids } } });
    await prisma.detalleComprobante.deleteMany({ where: { comprobanteId: { in: ids } } });
    await prisma.leyenda.deleteMany({ where: { comprobanteId: { in: ids } } }).catch(() => undefined);
    await prisma.comprobante.deleteMany({ where: { id: { in: ids } } });
  }
  const cl = await prisma.cliente.deleteMany({ where: { empresaId, email: { endsWith: EMAIL_SEED } } });
  const rp = await prisma.repartidor.deleteMany({ where: { empresaId, celular: { startsWith: CELULAR_REPARTIDOR_PREFIX } } });
  console.log(`  clientes borrados: ${cl.count}, repartidores borrados: ${rp.count}`);
}

async function main() {
  const usuarioDb = await prisma.usuario.findFirst({
    where: { email: DEMO_EMAIL },
    select: { id: true, empresaId: true, nombre: true },
  });
  if (!usuarioDb?.empresaId) throw new Error(`No existe el usuario ${DEMO_EMAIL} o no tiene empresa`);
  const usuario = { id: usuarioDb.id, empresaId: usuarioDb.empresaId, nombre: usuarioDb.nombre ?? 'Demo' };
  const empresaId = usuario.empresaId;
  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { razonSocial: true } });
  console.log(`Empresa #${empresaId} ${empresa?.razonSocial} · usuario #${usuario.id} ${usuario.nombre}`);

  await limpiar(empresaId);
  if (SOLO_LIMPIAR) return;

  const sedes = await prisma.sede.findMany({ where: { empresaId }, select: { id: true, esPrincipal: true } });
  const sedePrincipal: number | undefined = sedes.find((s) => s.esPrincipal)?.id ?? sedes[0]?.id;
  const productos = await prisma.producto.findMany({
    where: { empresaId, estado: 'ACTIVO', precioUnitario: { gt: 0 } },
    select: { id: true, descripcion: true, precioUnitario: true, unidadMedida: { select: { codigo: true } } },
  });
  if (!productos.length) throw new Error('La empresa no tiene productos activos con precio');
  const tipoOperacion = await prisma.comprobante.findFirst({ where: { empresaId, tipoOperacionId: { not: null } }, select: { tipoOperacionId: true } });
  const tipoOperacionId = tipoOperacion?.tipoOperacionId ?? 1;

  console.log(`Productos activos: ${productos.length} · sede principal: ${sedePrincipal} · ventas a crear: ${VENTAS}`);
  if (DRY_RUN) return;

  // ── Repartidores propios ──
  const repartidores: { id: number; nombre: string }[] = [];
  for (const [i, r] of REPARTIDORES.entries()) {
    const rep = await prisma.repartidor.create({
      data: { empresaId, nombre: r.nombre, tipo: r.tipo, celular: `${CELULAR_REPARTIDOR_PREFIX}${i + 1}`, activo: true, sedeId: sedePrincipal },
      select: { id: true, nombre: true },
    });
    repartidores.push(rep);
  }

  // ── Clientes (con ubicación real) ──
  interface Cli { id: number; nombre: string; nroDoc: string; esRuc: boolean; destino: Destino; telefono: string; direccion: string; fidelidad: number }
  const clientes: Cli[] = [];
  const docsUsados = new Set<string>();
  const TOTAL_CLIENTES = 90;
  for (let i = 0; i < TOTAL_CLIENTES; i++) {
    const destino = ponderado(DESTINOS.map((d) => ({ v: d, w: d.w })));
    const esRuc = rnd() < 0.22;
    let nroDoc = '';
    do {
      nroDoc = esRuc ? `20${pad(entre(100000000, 999999999), 9)}` : pad(entre(10000000, 79999999), 8);
    } while (docsUsados.has(nroDoc));
    docsUsados.add(nroDoc);
    const nombre = esRuc
      ? `${elegir(EMPRESAS)} ${elegir(APELLIDOS)} ${elegir(SUFIJOS)}`
      : `${elegir(APELLIDOS)} ${elegir(APELLIDOS)}, ${elegir(NOMBRES)}${rnd() < 0.5 ? ` ${elegir(NOMBRES)}` : ''}`;
    // Fidelidad: 6 VIP (10-18 compras), 18 recurrentes (3-6), el resto 1-2.
    const fidelidad = i < 6 ? entre(10, 18) : i < 24 ? entre(3, 6) : entre(1, 2);
    const telefono = `9${pad(entre(10000000, 99999999), 8)}`;
    const direccion = `${elegir(CALLES)} ${entre(100, 1999)}`;
    const cli = await prisma.cliente.create({
      data: {
        empresaId,
        nombre,
        nroDoc,
        tipoDocumentoId: esRuc ? 2 : 1,
        direccion,
        telefono,
        email: `${nroDoc}${EMAIL_SEED}`,
        departamento: destino.departamento,
        provincia: destino.provincia,
        distrito: destino.distrito,
        ubigeo: destino.ubigeo,
      },
      select: { id: true },
    });
    clientes.push({ id: cli.id, nombre, nroDoc, esRuc, destino, telefono, direccion, fidelidad });
  }

  // Bolsa de ventas: cada cliente aparece según su fidelidad; se recorta/rellena a VENTAS.
  let bolsa: Cli[] = clientes.flatMap((c) => Array.from({ length: c.fidelidad }, () => c));
  while (bolsa.length < VENTAS) bolsa.push(elegir(clientes));
  bolsa = bolsa.sort(() => rnd() - 0.5).slice(0, VENTAS);

  const ahora = new Date();
  let corrB = 0;
  let corrF = 0;
  let creadas = 0;
  const resumen = { shalom: 0, olva: 0, propios: 0, sinEnvio: 0, entregados: 0 };

  for (const cli of bolsa) {
    // Fecha: más densidad en las últimas semanas.
    const diasAtras = Math.floor(Math.pow(rnd(), 1.4) * DIAS);
    const fecha = new Date(ahora.getTime() - diasAtras * 86400000 - entre(0, 11) * 3600000 - entre(0, 59) * 60000);
    fecha.setUTCHours(13 + entre(0, 9), entre(0, 59), entre(0, 59), 0); // 8:00–17:59 Lima

    // Ítems
    const nItems = ponderado([{ v: 1, w: 45 }, { v: 2, w: 35 }, { v: 3, w: 15 }, { v: 4, w: 5 }]);
    const items = Array.from({ length: nItems }, () => {
      const p = elegir(productos);
      const cantidad = ponderado([{ v: 1, w: 70 }, { v: 2, w: 22 }, { v: 3, w: 8 }]);
      const precio = Number(p.precioUnitario);
      const valorUnit = r2(precio / 1.18);
      const valorVenta = r2(valorUnit * cantidad);
      const igv = r2(precio * cantidad - valorVenta);
      return { p, cantidad, precio, valorUnit, valorVenta, igv };
    });
    const mtoOperGravadas = r2(items.reduce((s, i) => s + i.valorVenta, 0));
    const mtoIGV = r2(items.reduce((s, i) => s + i.igv, 0));
    const total = r2(mtoOperGravadas + mtoIGV);

    const esFactura = cli.esRuc;
    const serie = esFactura ? SERIE_FACTURA : SERIE_BOLETA;
    const correlativo = esFactura ? ++corrF : ++corrB;
    const medioPago = ponderado(MEDIOS_PAGO);
    const sedeId = rnd() < 0.8 ? sedePrincipal : elegir(sedes).id;

    // ── Envío: 68% de las ventas. Lima: propio 65% / Shalom 20% / Olva 15%. Provincia: Shalom 62% / Olva 38%.
    const conEnvio = rnd() < 0.68;
    let courier: 'SHALOM' | 'OLVA' | 'PROPIOS' | null = null;
    if (conEnvio) {
      courier = cli.destino.lima
        ? ponderado([{ v: 'PROPIOS' as const, w: 65 }, { v: 'SHALOM' as const, w: 20 }, { v: 'OLVA' as const, w: 15 }])
        : ponderado([{ v: 'SHALOM' as const, w: 62 }, { v: 'OLVA' as const, w: 38 }]);
    }

    const comp = await prisma.comprobante.create({
      data: {
        empresaId,
        clienteId: cli.id,
        sedeId,
        usuarioId: usuario.id,
        tipoDoc: esFactura ? '01' : '03',
        serie,
        correlativo,
        fechaEmision: fecha,
        creadoEn: fecha,
        formaPagoTipo: 'CONTADO',
        formaPagoMoneda: 'PEN',
        tipoMoneda: 'PEN',
        tipoCambio: 1,
        tipoOperacionId,
        mtoOperGravadas,
        mtoIGV,
        valorVenta: mtoOperGravadas,
        totalImpuestos: mtoIGV,
        subTotal: total,
        mtoImpVenta: total,
        estadoEnvioSunat: 'EMITIDO',
        estadoPago: 'COMPLETADO',
        saldo: 0,
        medioPago,
        observaciones: courier ? `Envío por ${courier === 'PROPIOS' ? 'repartidor' : courier === 'SHALOM' ? 'Shalom' : 'Olva'} a ${cli.destino.distrito}` : '',
        detalles: {
          create: items.map((i) => ({
            productoId: i.p.id,
            unidad: i.p.unidadMedida?.codigo || 'NIU',
            descripcion: i.p.descripcion,
            cantidad: i.cantidad,
            mtoValorUnitario: i.valorUnit,
            mtoValorVenta: i.valorVenta,
            mtoBaseIgv: i.valorVenta,
            porcentajeIgv: 18,
            igv: i.igv,
            tipAfeIgv: 10,
            totalImpuestos: i.igv,
            mtoPrecioUnitario: i.precio,
            mtoDescuento: 0,
          })),
        },
        pagos: {
          create: [{ fecha, monto: total, medioPago, empresaId, usuarioId: usuario.id }],
        },
      },
      select: { id: true },
    });
    creadas += 1;

    if (!courier) {
      resumen.sinEnvio += 1;
      continue;
    }

    // ── Estado del envío según antigüedad: los recientes pueden estar en camino.
    const horasDesde = (ahora.getTime() - fecha.getTime()) / 3600000;
    const transitoHoras = cli.destino.lima ? entre(4, 30) : entre(30, 120);
    const yaLlego = horasDesde > transitoHoras + 6;
    const resultado = yaLlego
      ? ponderado([{ v: 'ENTREGADO', w: 93 }, { v: 'DEVUELTO', w: 3 }, { v: 'EN_DESTINO', w: 4 }])
      : horasDesde > transitoHoras
        ? 'EN_DESTINO'
        : horasDesde > 3
          ? 'EN_CAMINO'
          : 'PREPARANDO';
    const entregado = resultado === 'ENTREGADO';
    if (entregado) resumen.entregados += 1;
    const tRegistro = addH(fecha, entre(1, 4));
    const tOrigen = addH(tRegistro, entre(1, 5));
    const tTransito = addH(tOrigen, entre(2, 8));
    const tDestino = addH(tTransito, Math.max(2, transitoHoras - 8));
    const tEntrega = addH(tDestino, entre(2, 30));
    const historial: any[] = [{ nota: 'Despacho creado', fecha: fecha.toISOString(), estado: 'PREPARANDO', usuarioId: usuario.id, usuarioNombre: usuario.nombre }];
    const pushHist = (estado: string, f: Date, nota: string | null = null) => historial.push({ nota, fecha: f.toISOString(), estado, usuarioId: usuario.id, usuarioNombre: usuario.nombre });
    if (resultado !== 'PREPARANDO') pushHist('EN_CAMINO', tRegistro);
    if (['EN_DESTINO', 'ENTREGADO', 'DEVUELTO'].includes(resultado) && courier !== 'PROPIOS') pushHist('EN_AGENCIA', tDestino);
    if (entregado) pushHist('ENTREGADO', tEntrega);
    if (resultado === 'DEVUELTO') pushHist('DEVUELTO', tEntrega, 'Cliente no recogió el paquete');

    const peso = r2(0.3 + rnd() * 2.7);
    const contenido = `${items.reduce((s, i) => s + i.cantidad, 0)} prenda(s) - ${items[0].p.descripcion}`.slice(0, 80);
    const nombreDest = cli.esRuc ? `${elegir(NOMBRES)} ${elegir(APELLIDOS)}` : cli.nombre.replace(/^(.*), (.*)$/, '$2 $1');
    const dniDest = cli.esRuc ? pad(entre(10000000, 79999999), 8) : cli.nroDoc;

    const base = {
      comprobanteId: comp.id,
      creadoEn: fecha,
      estado: resultado as any,
      historial,
      celularDest: cli.telefono,
      nroPaquetes: 1,
      turnoEnvio: elegir(['MANANA', 'TARDE']),
      pesoKg: peso,
      nombreDestinatario: nombreDest,
      dniDestinatario: dniDest,
      contenidoPaquete: contenido,
      empaquetador: usuario.nombre,
      establecimiento: 'Sede Principal',
      fechaEstimada: tDestino,
      pagarFlete: rnd() < 0.7 ? 'CLIENTE' : 'NEGOCIO',
      aplicacionMontoCliente: 'ITEM_ENVIO',
    };

    if (courier === 'PROPIOS') {
      resumen.propios += 1;
      const rep = ponderado(repartidores.map((r, i) => ({ v: r, w: [40, 30, 18, 12][i] })));
      await prisma.envioDespacho.create({
        data: {
          ...base,
          transportista: 'PROPIOS',
          tipoEnvio: 'DOMICILIO',
          agenciaDestino: cli.destino.distrito,
          direccionDestino: `${cli.direccion}, ${cli.destino.distrito}`,
          repartidorId: rep.id,
          costoEnvio: r2(8 + rnd() * 7),
          tipoMercaderia: 'ROPA',
        },
      });
      continue;
    }

    if (courier === 'SHALOM') {
      resumen.shalom += 1;
      const nroOrden = String(entre(87000000, 88999999));
      const claveOrden = clave();
      const statuses: any = {
        registrado: { fecha: fmtShalom(tRegistro) },
        origen: resultado !== 'PREPARANDO' ? { fecha: fmtShalom(tOrigen) } : null,
        transito: ['EN_CAMINO', 'EN_DESTINO', 'ENTREGADO', 'DEVUELTO'].includes(resultado) && horasDesde > 8
          ? { fecha: fmtShalom(tTransito), carguero: String(entre(970000, 979999)), completo: resultado !== 'EN_CAMINO', cargueros: [String(entre(970000, 979999))] }
          : null,
        destino: ['EN_DESTINO', 'ENTREGADO', 'DEVUELTO'].includes(resultado) ? { fecha: fmtShalom(tDestino), completo: true } : null,
        entregado: entregado ? { fecha: fmtShalom(tEntrega), cliente: { nombre: nombreDest, documento: dniDest } } : null,
        reparto: null,
        demora: resultado === 'DEVUELTO' ? { fecha: fmtShalom(tEntrega), motivo: 'NO RECOGIDO EN AGENCIA' } : null,
      };
      const shalomEstado = entregado ? 'entregado' : statuses.destino ? 'destino' : statuses.transito ? 'transito' : statuses.origen ? 'origen' : 'registrado';
      const oseId = entre(87000000, 88999999);
      const [agNombre] = cli.destino.agenciaShalom.split(' - ');
      await prisma.envioDespacho.create({
        data: {
          ...base,
          transportista: 'SHALOM_PRO',
          tipoEnvio: 'AGENCIA',
          agenciaDestino: cli.destino.agenciaShalom,
          shalomAgenciaDestinoId: String(entre(10, 900)),
          shalomTipoProducto: peso < 1 ? 1 : peso < 2 ? 2 : 3,
          tipoMercaderia: peso < 1 ? 'MINI PAQUETERIA XS' : 'PAQUETERIA',
          nroOrden,
          claveOrden,
          claveEnvio: claveOrden,
          costoEnvio: r2(cli.destino.lima ? 12 + rnd() * 8 : 15 + rnd() * 20),
          montoCOD: rnd() < 0.25 ? total : null,
          shalomEstado,
          shalomEntregado: entregado,
          shalomOseId: String(oseId),
          shalomSyncAt: ahora,
          shalomGuiaCreadaEn: tRegistro,
          shalomTrackingJson: {
            success: true,
            ose_id: oseId,
            order: {
              ose_id: oseId,
              aereo: false,
              reparto: false,
              monto: '0.00',
              contenido: `1 ${peso < 1 ? 'MINI PAQUETERIA XS' : 'PAQUETERIA'}`,
              entregado,
              tipo_pago: 'Contado',
              remitente: { nombre: empresa?.razonSocial, documento: '20505720050' },
              origen: { id: 507, nombre: 'AV. CANTA CALLAO CON IZAGUIRRE', ubigeo: 150135, distrito: 'SAN MARTIN DE PORRES', provincia: 'LIMA', departamento: 'LIMA', abrebiatura: 'AVCLO' },
              destino: { id: entre(10, 900), nombre: agNombre, ubigeo: Number(cli.destino.ubigeo), distrito: cli.destino.distrito, provincia: cli.destino.provincia, departamento: cli.destino.departamento, abrebiatura: cli.destino.distrito.slice(0, 3) },
            },
            search: {
              contenido: nroOrden,
              entregado,
              origen: { nombre: 'AV. CANTA CALLAO CON IZAGUIRRE - LIMA - LIMA' },
              destino: { nombre: cli.destino.agenciaShalom },
              destinatario: { nombre: nombreDest, documento: dniDest },
            },
            statuses,
            events: statuses,
          },
        },
      });
      continue;
    }

    // OLVA
    resumen.olva += 1;
    const tracking = `${entre(1000000000, 9999999999)}`;
    const statusUpstream = entregado ? 'DELIVERED' : resultado === 'DEVUELTO' ? 'RETURNED' : resultado === 'EN_DESTINO' ? (cli.destino.lima ? 'OUT_FOR_DELIVERY' : 'READY_FOR_PICKUP') : resultado === 'EN_CAMINO' ? 'IN_TRANSIT' : 'REGISTERED';
    const eventos: any[] = [{ date: tRegistro.toISOString(), status: 'REGISTERED', detail: 'Envío registrado', location: 'LIMA - CALLAO' }];
    if (statusUpstream !== 'REGISTERED') eventos.push({ date: tTransito.toISOString(), status: 'IN_TRANSIT', detail: 'En tránsito hacia destino', location: 'LIMA - CALLAO' });
    if (['OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'DELIVERED', 'RETURNED'].includes(statusUpstream)) {
      eventos.push({ date: tDestino.toISOString(), status: cli.destino.lima ? 'OUT_FOR_DELIVERY' : 'READY_FOR_PICKUP', detail: cli.destino.lima ? 'Salió a reparto' : 'Disponible en agencia destino', location: cli.destino.agenciaOlva });
    }
    if (statusUpstream === 'DELIVERED') eventos.push({ date: tEntrega.toISOString(), status: 'DELIVERED', detail: `Entregado a ${nombreDest}`, location: cli.destino.agenciaOlva });
    if (statusUpstream === 'RETURNED') eventos.push({ date: tEntrega.toISOString(), status: 'RETURNED', detail: 'Devuelto a origen: destinatario ausente', location: cli.destino.agenciaOlva });
    const olvaEstado = entregado ? 'entregado' : statusUpstream === 'RETURNED' || statusUpstream === 'READY_FOR_PICKUP' ? 'destino' : statusUpstream === 'OUT_FOR_DELIVERY' ? 'reparto' : statusUpstream === 'IN_TRANSIT' ? 'transito' : 'registrado';
    const costo = r2(cli.destino.lima ? 14 + rnd() * 8 : 18 + rnd() * 27);
    await prisma.envioDespacho.create({
      data: {
        ...base,
        transportista: 'OLVA',
        tipoEnvio: cli.destino.lima ? 'DOMICILIO' : 'AGENCIA',
        agenciaDestino: cli.destino.agenciaOlva,
        direccionDestino: cli.destino.lima ? `${cli.direccion}, ${cli.destino.distrito}` : null,
        olvaAgenciaDestinoCodigo: cli.destino.olvaCodigo,
        nroOrden: tracking,
        costoEnvio: costo,
        tipoMercaderia: 'ROPA',
        olvaEstado,
        olvaEntregado: entregado,
        olvaSyncAt: ahora,
        olvaGuiaCreadaEn: tRegistro,
        olvaRespuestaJson: { success: true, data: { trackingNumber: tracking, price: costo, labelUrl: null, createdAt: tRegistro.toISOString() } },
        olvaTrackingJson: {
          success: true,
          data: {
            trackingNumber: tracking,
            status: statusUpstream,
            statusDetail: eventos[eventos.length - 1].detail,
            deliveredAt: entregado ? tEntrega.toISOString() : null,
            origin: { agency: 'LIMA - CALLAO', department: 'LIMA' },
            destination: { agency: cli.destino.agenciaOlva, department: cli.destino.departamento, code: cli.destino.olvaCodigo },
            recipient: { name: nombreDest, document: dniDest },
            weightKg: peso,
            // Olva devuelve los eventos del más reciente al más antiguo.
            events: [...eventos].reverse(),
          },
        },
      },
    });
  }

  console.log(`\n✅ Sembrado: ${creadas} ventas (${corrB} boletas ${SERIE_BOLETA}, ${corrF} facturas ${SERIE_FACTURA}), ${clientes.length} clientes, ${repartidores.length} repartidores`);
  console.log(`   Envíos → Shalom ${resumen.shalom} · Olva ${resumen.olva} · propios ${resumen.propios} · sin envío ${resumen.sinEnvio} · entregados ${resumen.entregados}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
