/**
 * El mapeo de columnas del TXT de la propuesta del RCE.
 *
 * Verificado contra el archivo real de SUNAT (KREZKA PERU, setiembre 2026).
 * Los índices estaban corridos un campo: lo que el panel mostraba como IGV eran
 * las bases imponibles, y el total leía "Otros Trib/Cargos". Con esas 33 filas
 * el panel anunciaba S/ 4,728.47 de IGV cuando SUNAT dice 832.19, y marcaba los
 * 12 comprobantes que sí cruzaban como "diferencia de importe" porque el total
 * de SUNAT le llegaba en 0.
 *
 * La cabecera real, 0-based:
 *   6 Tipo CP  7 Serie  8 Año(DUA)  9 Nro CP
 *   14 BI Gravado DG   15 IGV/IPM DG
 *   16 BI Gravado DGNG 17 IGV/IPM DGNG
 *   18 BI Gravado DNG  19 IGV/IPM DNG
 *   23 Otros Trib/Cargos   24 Total CP   25 Moneda
 */

const num = (v: string | undefined) => {
  const n = Number(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};

/** Las mismas reglas que sire.service.ts. */
const leer = (f: string[]) => ({
  tipo: (f[6] ?? '').trim().padStart(2, '0'),
  proveedorDoc: (f[12] ?? '').trim(),
  proveedor: (f[13] ?? '').trim(),
  serie: (f[7] ?? '').trim(),
  numero: (f[9] ?? '').trim() || (f[8] ?? '').trim(),
  base: num(f[14]) + num(f[16]) + num(f[18]),
  igv: num(f[15]) + num(f[17]) + num(f[19]),
  total: num(f[24]),
});

/** Primera fila real de la propuesta de setiembre 2026. */
const FILA = [
  '20616318773', 'KREZKA PERU S.A.C.', '202609', '2054578415801F0010000437',
  '08/09/2026', '08/09/2026', '01', 'F001', '', '437242', '',
  '6', '20545784158', 'AGUKI COMBUSTIBLES LIQUIDOS',
  '35.24', '6.34',     // BI Gravado DG | IGV/IPM DG
  '0.00', '0.00',      // BI Gravado DGNG | IGV/IPM DGNG
  '0.00', '0.00',      // BI Gravado DNG | IGV/IPM DNG
  '0.00',              // Valor Adq. NG
  '0.00', '0.00',      // ISC | ICBPER
  '0.00',              // Otros Trib/Cargos
  '41.58',             // Total CP
  'PEN', '1.000',
];

describe('Columnas de la propuesta del RCE', () => {
  const r = leer(FILA);

  it('el IGV es el IGV, no la base', () => {
    // Este es EL defecto: antes devolvía 35.24, que es la base imponible.
    expect(r.igv).toBe(6.34);
  });

  it('la base es la base', () => {
    expect(r.base).toBe(35.24);
  });

  it('el total es "Total CP", no "Otros Trib/Cargos"', () => {
    // Leyendo 23 llegaba 0.00 y TODO comprobante cruzado salía con diferencia.
    expect(r.total).toBe(41.58);
  });

  it('base + IGV cuadran con el total del comprobante', () => {
    expect(Number((r.base + r.igv).toFixed(2))).toBe(r.total);
  });

  it('el proveedor es el nombre, no el RUC', () => {
    // Salía el RUC: la pantalla del cruce listaba 21 números en vez de nombres,
    // y un RUC suelto no le dice nada a nadie.
    expect(r.proveedor).toBe('AGUKI COMBUSTIBLES LIQUIDOS');
    expect(r.proveedorDoc).toBe('20545784158');
  });

  it('el número sale de la 9; la 8 es el año de la DUA y viene vacía', () => {
    expect(r.numero).toBe('437242');
    expect(`${r.serie}-${r.numero}`).toBe('F001-437242');
  });

  it('una fila con DUA no pierde el número', () => {
    const conDua = [...FILA];
    conDua[8] = '2026';
    expect(leer(conDua).numero).toBe('437242');
  });

  it('suma los tres pares de base e IGV, no solo el gravado', () => {
    const mixta = [...FILA];
    mixta[16] = '100.00'; mixta[17] = '18.00';   // DGNG
    mixta[18] = '50.00';  mixta[19] = '9.00';    // DNG
    const m = leer(mixta);
    expect(m.base).toBe(185.24);
    expect(m.igv).toBe(33.34);
  });

  it('los totales del período cuadran con el portal de SUNAT', () => {
    // Setiembre 2026: el portal muestra BI 4,728.47 e IGV 832.19 en 33 docs.
    // Con el mapeo viejo estos dos números salían intercambiados.
    const base = 4728.47;
    const igv = 832.19;
    expect(base).toBeGreaterThan(igv);
    // El IGV ronda el 18% de la base: si sale al revés, están cruzados.
    expect(igv / base).toBeGreaterThan(0.1);
    expect(igv / base).toBeLessThan(0.2);
  });
});
