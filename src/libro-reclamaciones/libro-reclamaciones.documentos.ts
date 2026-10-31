import * as XLSX from 'xlsx';
import type { Reclamo } from './libro-reclamaciones.reglas';

/** HTML de la constancia (hoja) y Excel del libro. Funciones puras. */

const ZONA = 'America/Lima';

export function fechaHoraLima(fecha: Date | null | undefined): string {
  if (!fecha) return '';
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: ZONA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(fecha);
}

export function fechaLima(fecha: Date | null | undefined): string {
  if (!fecha) return '';
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: ZONA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(fecha);
}

export function escaparHtml(valor: string | number | null | undefined): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapa y conserva los saltos de línea del consumidor. */
function parrafo(valor: string | number | null | undefined): string {
  return escaparHtml(valor).replace(/\n/g, '<br/>');
}

/** Solo se acepta un logo http(s) o data:image: nada de `javascript:` ni rutas locales. */
function logoSeguro(logo: string | null | undefined): string | null {
  if (!logo) return null;
  return /^(https:\/\/|http:\/\/|data:image\/(png|jpe?g|webp|svg\+xml);base64,)/i.test(
    logo,
  )
    ? logo
    : null;
}

const ETIQUETA_DOCUMENTO: Record<string, string> = {
  DNI: 'DNI',
  CE: 'Carné de extranjería',
  PASAPORTE: 'Pasaporte',
  RUC: 'RUC',
};

export function montoTexto(monto: number | null): string {
  return monto === null ? '—' : `S/ ${monto.toFixed(2)}`;
}

export function htmlConstancia(r: Reclamo, logo?: string | null): string {
  const fila = (etiqueta: string, valor: string | number | null) =>
    `<tr><th>${escaparHtml(etiqueta)}</th><td>${parrafo(valor) || '—'}</td></tr>`;
  const logoUrl = logoSeguro(logo);
  const marcar = (activo: boolean) => (activo ? '&#9746;' : '&#9744;');

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"/>
<title>Hoja de reclamación ${escaparHtml(r.codigo)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; font-size: 11px; margin: 0; padding: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #111827; padding-bottom: 12px; }
  header img { max-height: 56px; max-width: 160px; object-fit: contain; }
  h1 { font-size: 17px; margin: 0 0 4px; letter-spacing: -0.2px; }
  .muted { color: #6b7280; }
  .codigo { text-align: right; }
  .codigo strong { display: block; font-size: 18px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; margin: 18px 0 6px; color: #374151; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { width: 32%; background: #f9fafb; font-weight: 600; color: #374151; }
  .tipo { display: flex; gap: 24px; font-size: 12px; margin-bottom: 4px; }
  .nota { margin-top: 18px; padding: 10px 12px; background: #f3f4f6; border-radius: 6px; font-size: 10px; line-height: 1.5; color: #374151; }
  .estado { display: inline-block; padding: 2px 8px; border-radius: 999px; font-weight: 700; font-size: 10px; background: #e5e7eb; }
</style></head>
<body>
<header>
  <div>
    ${logoUrl ? `<img src="${escaparHtml(logoUrl)}" alt=""/>` : ''}
    <h1>LIBRO DE RECLAMACIONES</h1>
    <div><strong>${escaparHtml(r.proveedor.nombreComercial || r.proveedor.razonSocial)}</strong></div>
    <div class="muted">${escaparHtml(r.proveedor.razonSocial)} · RUC ${escaparHtml(r.proveedor.ruc)}</div>
    <div class="muted">${escaparHtml(r.proveedor.direccion)}</div>
  </div>
  <div class="codigo">
    <span class="muted">Hoja de reclamación N.º</span>
    <strong>${escaparHtml(r.codigo)}</strong>
    <div>Fecha: ${escaparHtml(fechaHoraLima(r.fecha))}</div>
    <div>Responder a más tardar: ${escaparHtml(fechaLima(r.fechaLimite))}</div>
    <div style="margin-top:4px"><span class="estado">${escaparHtml(r.estado)}</span></div>
  </div>
</header>

<h2>1. Identificación del consumidor reclamante</h2>
<table>
  ${fila('Nombre', r.nombres)}
  ${fila(ETIQUETA_DOCUMENTO[r.tipoDocumento] ?? r.tipoDocumento, r.numeroDocumento)}
  ${fila('Domicilio', r.domicilio)}
  ${fila('Teléfono', r.telefono)}
  ${fila('Correo', r.email)}
  ${r.menorDeEdad ? fila('Padre, madre o apoderado', `${r.apoderadoNombre ?? ''} (${r.apoderadoDocumento ?? ''})`) : ''}
</table>

<h2>2. Identificación del bien contratado</h2>
<table>
  ${fila('Tipo', r.bienTipo === 'SERVICIO' ? 'Servicio' : 'Producto')}
  ${fila('Descripción', r.bienDescripcion)}
  ${fila('Monto reclamado', montoTexto(r.montoReclamado))}
  ${r.pedidoCodigo ? fila('Código de pedido', r.pedidoCodigo) : ''}
</table>

<h2>3. Detalle de la reclamación y pedido del consumidor</h2>
<div class="tipo">
  <span>${marcar(r.tipo === 'RECLAMO')} Reclamo</span>
  <span>${marcar(r.tipo === 'QUEJA')} Queja</span>
</div>
<table>
  ${fila('Detalle', r.detalle)}
  ${fila('Pedido', r.pedidoConsumidor)}
</table>

<h2>4. Observaciones y acciones adoptadas por el proveedor</h2>
<table>
  ${fila('Respuesta', r.respuesta ?? 'Pendiente de respuesta.')}
  ${r.fechaRespuesta ? fila('Fecha de respuesta', fechaHoraLima(r.fechaRespuesta)) : ''}
</table>

<div class="nota">
  <strong>RECLAMO:</strong> disconformidad relacionada a los productos o servicios.
  <strong>QUEJA:</strong> disconformidad no relacionada a los productos o servicios; o malestar o descontento respecto a la atención al público.<br/>
  La formulación del reclamo no impide acudir a otras vías de solución de controversias ni es requisito previo para interponer una denuncia ante el INDECOPI.
  El proveedor deberá dar respuesta al reclamo en un plazo no mayor a quince (15) días hábiles.<br/>
  El consumidor declaró que la información consignada es verdadera${r.aceptaDeclaracion ? ' (aceptado)' : ''}.
</div>
</body></html>`;
}

const COLUMNAS: ReadonlyArray<[string, (r: Reclamo) => string | number]> = [
  ['Código', (r) => r.codigo],
  ['Fecha', (r) => fechaHoraLima(r.fecha)],
  ['Tipo', (r) => r.tipo],
  ['Estado', (r) => r.estado],
  ['Fecha límite', (r) => fechaLima(r.fechaLimite)],
  ['Días hábiles restantes', (r) => r.diasHabilesRestantes ?? ''],
  ['Nombre', (r) => r.nombres],
  ['Tipo doc.', (r) => r.tipoDocumento],
  ['N.º doc.', (r) => r.numeroDocumento],
  ['Domicilio', (r) => r.domicilio],
  ['Teléfono', (r) => r.telefono],
  ['Correo', (r) => r.email],
  ['Menor de edad', (r) => (r.menorDeEdad ? 'Sí' : 'No')],
  [
    'Apoderado',
    (r) =>
      r.menorDeEdad
        ? `${r.apoderadoNombre ?? ''} (${r.apoderadoDocumento ?? ''})`
        : '',
  ],
  ['Bien', (r) => r.bienTipo],
  ['Descripción del bien', (r) => r.bienDescripcion],
  ['Monto reclamado', (r) => r.montoReclamado ?? ''],
  ['Código de pedido', (r) => r.pedidoCodigo ?? ''],
  ['Detalle', (r) => r.detalle],
  ['Pedido del consumidor', (r) => r.pedidoConsumidor],
  ['Respuesta', (r) => r.respuesta ?? ''],
  ['Fecha de respuesta', (r) => fechaHoraLima(r.fechaRespuesta)],
  ['Respondido por', (r) => r.respondidoPor?.nombre ?? ''],
];

/** Neutraliza fórmulas: un texto del consumidor que empieza con =, +, - o @ no se ejecuta en Excel. */
function celdaSegura(valor: string | number): string | number {
  if (typeof valor !== 'string') return valor;
  return /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
}

export function excelLibro(reclamos: readonly Reclamo[]): Buffer {
  const filas: (string | number)[][] = [
    COLUMNAS.map(([titulo]) => titulo),
    ...reclamos.map((r) => COLUMNAS.map(([, valor]) => celdaSegura(valor(r)))),
  ];
  const hoja = XLSX.utils.aoa_to_sheet(filas);
  hoja['!cols'] = COLUMNAS.map(([titulo]) => ({
    wch: [
      'Detalle',
      'Pedido del consumidor',
      'Respuesta',
      'Descripción del bien',
    ].includes(titulo)
      ? 50
      : 18,
  }));
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Libro de reclamaciones');
  return XLSX.write(libro, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}
