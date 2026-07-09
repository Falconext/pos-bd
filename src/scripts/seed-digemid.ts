/**
 * Seed DIGEMID — importa el catálogo de productos farmacéuticos de DIGEMID/MINSA.
 *
 * Cómo obtener el archivo:
 *   1. Descargar el catálogo desde DIGEMID:
 *      https://www.digemid.minsa.gob.pe/WebDigemid/WebContentPub/PF_Consulta_Medicamentos.aspx
 *      O búscalo en: https://www.datosabiertos.gob.pe buscando "digemid"
 *   2. Guardarlo como: backend/data/digemid_medicamentos.xlsx
 *   3. Ejecutar: cd backend && pnpm run seed:digemid
 */

import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

const prisma = new PrismaClient();

// Columnas del formato oficial DIGEMID (Catálogo de Productos Farmacéuticos)
// Cada campo acepta múltiples nombres de columna para compatibilidad entre versiones
const COLUMN_ALIASES: Record<string, string[]> = {
  nombreComercial: [
    'Nom_Prod',
    'NOM_PROD',
    'NOMBRE_PRODUCTO',
    'NOMBRE PRODUCTO',
    'NOMBRE COMERCIAL',
    'NOMBRE_COMERCIAL',
    'Nombre del Producto',
    'NOMBRE',
  ],
  principioActivo: [
    'Nom_IFA',
    'NOM_IFA',
    'NOMBRE_DCI',
    'DCI',
    'PRINCIPIO_ACTIVO',
    'PRINCIPIO ACTIVO',
    'Denominación Común Internacional',
    'INGREDIENTE ACTIVO',
    'NOMBRE DCI',
    'IFA',
  ],
  formaFarmaceutica: [
    'Nom_Form_Farm',
    'NOM_FORM_FARM',
    'FORMA_FARMACEUTICA',
    'FORMA FARMACEUTICA',
    'FORMA FARMACÉUTICA',
    'Forma Farmacéutica',
    'FORMA_FARM',
  ],
  concentracion: [
    'Concent',
    'CONCENT',
    'CONCENTRACION',
    'CONCENTRACIÓN',
    'Concentración',
    'STRENGTH',
  ],
  presentacion: [
    'Presentac',
    'PRESENTAC',
    'PRESENTACION',
    'PRESENTACIÓN',
    'Presentación',
    'ENVASE',
  ],
  laboratorio: [
    'Nom_Titular',
    'NOM_TITULAR',
    'Nom_Fabricante',
    'NOM_FABRICANTE',
    'TITULAR_REGISTRO',
    'TITULAR REGISTRO',
    'LABORATORIO',
    'FABRICANTE',
    'Titular del Registro',
    'EMPRESA',
    'TITULAR',
  ],
  registroSanitario: [
    'Num_RegSan',
    'NUM_REGSAN',
    'NUMERO_RS',
    'NUMERO RS',
    'REGISTRO_SANITARIO',
    'REGISTRO SANITARIO',
    'RS',
    'N_RS',
    'NRO_RS',
  ],
  condicionVenta: [
    'CONDICION_VENTA',
    'CONDICIÓN DE VENTA',
    'CONDICION DE VENTA',
    'Condición de Venta',
    'VENTA',
    'RECETA',
  ],
  estado: [
    'Situación',
    'SITUACION',
    'SITUACIÓN',
    'ESTADO',
    'ESTADO_REGISTRO',
    'Estado del Registro',
    'STATUS',
    'VIGENCIA',
  ],
  codigoBarras: [
    'CODIGO_BARRAS',
    'CÓDIGO DE BARRAS',
    'EAN',
    'BARCODE',
    'GTIN',
    'EAN13',
  ],
};

function resolveColumn(headers: string[], aliases: string[]): string | null {
  const norm = (s: string) =>
    s?.toString().trim().toUpperCase().replace(/\s+/g, ' ');
  const normHeaders = headers.map(norm);
  for (const alias of aliases) {
    const idx = normHeaders.indexOf(norm(alias));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

function buildColumnMap(headers: string[]) {
  const map: Record<string, string | null> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    map[field] = resolveColumn(headers, aliases);
  }
  return map;
}

function getValue(row: Record<string, any>, col: string | null): string | null {
  if (!col) return null;
  const val = row[col];
  if (val === null || val === undefined || val === '') return null;
  return String(val).trim() || null;
}

function normalizeEstado(val: string | null): string {
  if (!val) return 'VIGENTE';
  const upper = val.toUpperCase();
  // DIGEMID usa: ACT = activo/vigente, INA/CANCEL = inactivo/cancelado
  if (upper === 'ACT' || upper.includes('ACTIV') || upper.includes('VIGENT'))
    return 'VIGENTE';
  if (
    upper.includes('CANCEL') ||
    upper.includes('BAJA') ||
    upper.includes('INA')
  )
    return 'CANCELADO';
  return 'VIGENTE';
}

/**
 * Detecta automáticamente la fila que contiene los headers del DIGEMID.
 * El archivo tiene filas de metadata al principio (logo, descripción, fecha).
 * Buscamos la fila que contenga "Nom_Prod" o "NOMBRE" en alguna celda.
 */
function detectHeaderRow(workbook: XLSX.WorkBook, sheetName: string): number {
  const sheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:Z100');

  const headerKeywords = [
    'NOM_PROD',
    'NOMBRE_PRODUCTO',
    'NOMBRE PRODUCTO',
    'NOMBRE COMERCIAL',
    'NOM_IFA',
    'NOMBRE_DCI',
    'COD_PROD',
  ];

  for (let r = range.s.r; r <= Math.min(range.e.r, 20); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[cellAddr];
      if (!cell) continue;
      const val = String(cell.v || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ');
      if (headerKeywords.some((kw) => val.includes(kw))) {
        console.log(`   → Headers detectados en fila ${r + 1}`);
        return r;
      }
    }
  }

  console.log('   → No se detectó fila de headers específica, usando fila 1');
  return 0; // Default: primera fila
}

async function main() {
  const dataDir = path.join(__dirname, '../../data');
  const candidates = [
    'digemid_medicamentos.xlsx',
    'digemid_medicamentos.xls',
    'digemid_medicamentos.csv',
    'Catálogo.xlsx',
    'Catalogo.xlsx',
  ];

  let filePath: string | null = null;
  for (const name of candidates) {
    const candidate = path.join(dataDir, name);
    if (fs.existsSync(candidate)) {
      filePath = candidate;
      break;
    }
  }

  // También buscar cualquier .xlsx en la carpeta data/
  if (!filePath) {
    const files = fs
      .readdirSync(dataDir)
      .filter((f) => f.endsWith('.xlsx') || f.endsWith('.xls'));
    if (files.length > 0) {
      filePath = path.join(dataDir, files[0]);
      console.log(`   Usando primer archivo encontrado: ${files[0]}`);
    }
  }

  if (!filePath) {
    console.error('\n❌ Archivo no encontrado en backend/data/');
    console.error('   Guarda el archivo Excel de DIGEMID como:');
    console.error(`   ${path.join(dataDir, 'digemid_medicamentos.xlsx')}\n`);
    process.exit(1);
  }

  console.log(`\n📂 Leyendo: ${path.basename(filePath)}`);
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  console.log(`   Hoja: "${sheetName}"`);

  // Detectar la fila de headers (el archivo DIGEMID tiene metadata en las primeras filas)
  const headerRowIndex = detectHeaderRow(workbook, sheetName);

  const sheet = workbook.Sheets[sheetName];
  const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    range: headerRowIndex, // Empezar desde la fila detectada
  });

  if (rows.length === 0) {
    console.error(
      '❌ El archivo está vacío o no tiene datos después de los headers.',
    );
    process.exit(1);
  }

  const headers = Object.keys(rows[0]);
  console.log(`\n📋 ${headers.length} columnas detectadas:`);
  console.log(
    `   ${headers.slice(0, 10).join(' | ')}${headers.length > 10 ? ' | ...' : ''}`,
  );

  const colMap = buildColumnMap(headers);
  console.log('\n🗺️  Mapeo de columnas DIGEMID → Sistema:');
  for (const [field, col] of Object.entries(colMap)) {
    console.log(`   ${field.padEnd(20)} ← ${col ?? '(no encontrado)'}`);
  }

  if (!colMap.nombreComercial) {
    console.error('\n❌ No se encontró la columna de nombre del producto.');
    console.error('   Columnas disponibles:', headers.join(', '));
    process.exit(1);
  }

  console.log(`\n🗑️  Limpiando registros anteriores de DIGEMID...`);
  const deleted = await prisma.digemidProducto.deleteMany({});
  console.log(`   ${deleted.count} registros eliminados`);

  console.log(`\n📥 Procesando ${rows.length.toLocaleString()} filas...`);

  const BATCH = 500;
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const data = batch
      .map((row) => {
        const nombre = getValue(row, colMap.nombreComercial);
        if (!nombre || nombre.length < 2) return null;
        return {
          nombreComercial: nombre,
          principioActivo: getValue(row, colMap.principioActivo),
          formaFarmaceutica: getValue(row, colMap.formaFarmaceutica),
          concentracion: getValue(row, colMap.concentracion),
          presentacion: getValue(row, colMap.presentacion),
          laboratorio: getValue(row, colMap.laboratorio),
          registroSanitario: getValue(row, colMap.registroSanitario),
          condicionVenta: getValue(row, colMap.condicionVenta),
          estado: normalizeEstado(getValue(row, colMap.estado)),
          codigoBarras: getValue(row, colMap.codigoBarras),
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    skipped += batch.length - data.length;

    if (data.length > 0) {
      await prisma.digemidProducto.createMany({ data, skipDuplicates: true });
      imported += data.length;
    }

    process.stdout.write(
      `\r   ${imported.toLocaleString()} importados, ${skipped} omitidos...`,
    );
  }

  const total = await prisma.digemidProducto.count();
  const vigentes = await prisma.digemidProducto.count({
    where: { estado: 'VIGENTE' },
  });

  console.log('\n');
  console.log('✅ Importación completada:');
  console.log(`   Total en DB  : ${total.toLocaleString()}`);
  console.log(`   Vigentes     : ${vigentes.toLocaleString()}`);
  console.log(`   Cancelados   : ${(total - vigentes).toLocaleString()}`);
  console.log(
    `   Omitidos     : ${skipped.toLocaleString()} (sin nombre válido)`,
  );
  console.log('\n🔍 Prueba: pnpm run seed:digemid completado exitosamente\n');
}

main()
  .catch((e) => {
    console.error('\n❌ Error:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
