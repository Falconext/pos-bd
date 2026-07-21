// Construye el HTML A4 autocontenido del contrato vehicular (multi-vehículo)
// para generar el PDF que se adjunta por correo. Espeja el diseño del print del
// frontend (src/pages/admin/vehiculos/contratoPrint.ts).

export interface ContratoPdfVehiculo {
  placa: string;
  marca?: string | null;
  modelo?: string | null;
  color?: string | null;
  anio?: number | null;
  montoAnual?: number | null;
}

export interface ContratoPdfData {
  numero?: string | number;
  estado?: string;
  servicio?: string | null;
  fechaInicio: string; // ISO
  fechaFin: string; // ISO
  montoTotalAnual?: number | null;
  observaciones?: string | null;
  cliente?: {
    nombre?: string | null;
    nroDoc?: string | null;
    telefono?: string | null;
    email?: string | null;
  } | null;
  vehiculos: ContratoPdfVehiculo[];
  empresa?: {
    razonSocial?: string | null;
    nombreComercial?: string | null;
    ruc?: string | null;
    direccion?: string | null;
  } | null;
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmtFecha = (iso?: string): string => {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
};

const fmtMonto = (m?: number | null): string =>
  m != null ? `S/ ${Number(m).toFixed(2)}` : '—';

export function buildContratoHtml(data: ContratoPdfData): string {
  const { empresa, cliente } = data;
  const empresaNombre =
    empresa?.nombreComercial || empresa?.razonSocial || 'Empresa';
  const vehiculos = data.vehiculos ?? [];
  const hoy = new Date().toISOString();

  const totalCalc = vehiculos.reduce((acc, v) => acc + (v.montoAnual ?? 0), 0);
  const total =
    data.montoTotalAnual != null
      ? data.montoTotalAnual
      : totalCalc > 0
        ? totalCalc
        : null;

  const filasVehiculos = vehiculos.length
    ? vehiculos
        .map(
          (v, i) => `
        <tr>
          <td class="c">${i + 1}</td>
          <td class="placa-cell">${esc(v.placa)}</td>
          <td>${esc(v.marca || '')} ${esc(v.modelo || '')}</td>
          <td>${esc(v.color || '')}</td>
          <td class="c">${v.anio ? esc(v.anio) : '—'}</td>
          <td class="r">${esc(fmtMonto(v.montoAnual))}</td>
        </tr>`,
        )
        .join('')
    : `<tr><td colspan="6" class="empty">Sin vehículos registrados.</td></tr>`;

  const dato = (label: string, value: string) =>
    `<div class="dato"><span class="k">${esc(label)}</span><span class="v">${esc(value || '—')}</span></div>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Contrato vehicular${data.numero ? ' N° ' + esc(data.numero) : ''}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Inter', Arial, Helvetica, sans-serif; color: #111827; font-size: 12px; line-height: 1.45; }
  .page { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 16mm 14mm; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111827; padding-bottom: 10px; }
  .brand { max-width: 60%; }
  .brand .name { font-size: 16px; font-weight: 800; letter-spacing: .2px; }
  .brand .meta { color: #4b5563; font-size: 11px; margin-top: 2px; }
  .title { text-align: right; }
  .title h1 { font-size: 15px; font-weight: 800; margin: 0; text-transform: uppercase; }
  .title .num { display: inline-block; margin-top: 4px; border: 1.5px solid #111827; border-radius: 4px; padding: 2px 10px; font-weight: 700; font-size: 12px; letter-spacing: 1px; }
  .title .fecha { color: #4b5563; font-size: 11px; margin-top: 4px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: #6b7280; margin: 16px 0 6px; border-bottom: 1px solid #e5e7eb; padding-bottom: 3px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 14px; }
  .grid.g3 { grid-template-columns: repeat(3, 1fr); }
  .dato { display: flex; flex-direction: column; }
  .dato .k { font-size: 9.5px; text-transform: uppercase; letter-spacing: .4px; color: #6b7280; }
  .dato .v { font-size: 12.5px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { border: 1px solid #d1d5db; padding: 5px 7px; text-align: left; vertical-align: top; font-size: 11px; }
  th { background: #f3f4f6; text-transform: uppercase; font-size: 9.5px; letter-spacing: .4px; color: #374151; }
  td.c { text-align: center; width: 26px; color: #6b7280; }
  td.r { text-align: right; white-space: nowrap; }
  td.placa-cell { font-family: 'Courier New', monospace; font-weight: 700; letter-spacing: 1.5px; }
  td.empty { text-align: center; color: #6b7280; font-style: italic; }
  tfoot td { font-weight: 700; background: #f9fafb; }
  .obs { border: 1px solid #d1d5db; border-radius: 5px; padding: 8px 10px; min-height: 42px; margin-top: 4px; white-space: pre-wrap; }
  .decl { margin-top: 14px; font-size: 10.5px; color: #4b5563; line-height: 1.5; }
  .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 46px; }
  .firma { text-align: center; }
  .firma .linea { border-top: 1px solid #111827; margin: 0 8px 6px; padding-top: 6px; }
  .firma .rol { font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
  .firma .sub { color: #6b7280; font-size: 10px; margin-top: 2px; }
  .pie { margin-top: 22px; text-align: center; color: #9ca3af; font-size: 9.5px; border-top: 1px solid #e5e7eb; padding-top: 6px; }
  @media print { @page { size: A4; margin: 0; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .page { margin: 0; } }
</style>
</head>
<body>
  <div class="page">
    <div class="top">
      <div class="brand">
        <div class="name">${esc(empresaNombre)}</div>
        <div class="meta">${empresa?.ruc ? 'RUC: ' + esc(empresa.ruc) : ''}${empresa?.ruc && empresa?.direccion ? ' · ' : ''}${esc(empresa?.direccion || '')}</div>
      </div>
      <div class="title">
        <h1>Contrato de servicio vehicular</h1>
        ${data.numero ? `<div class="num">N° ${esc(data.numero)}</div>` : ''}
        <div class="fecha">Emitido: ${esc(fmtFecha(hoy))}</div>
      </div>
    </div>

    <h2>Datos del contrato</h2>
    <div class="grid">
      ${dato('Servicio', data.servicio || '')}
      ${dato('Estado', data.estado || '')}
      ${dato('Fecha de inicio', fmtFecha(data.fechaInicio))}
      ${dato('Fecha de vencimiento', fmtFecha(data.fechaFin))}
    </div>

    <h2>Cliente / Propietario</h2>
    <div class="grid g3">
      ${dato('Nombre / Razón social', cliente?.nombre || '')}
      ${dato('Documento', cliente?.nroDoc || '')}
      ${dato('Teléfono', cliente?.telefono || '')}
    </div>

    <h2>Vehículos incluidos (${vehiculos.length})</h2>
    <table>
      <thead>
        <tr><th>#</th><th>Placa</th><th>Marca / Modelo</th><th>Color</th><th>Año</th><th style="text-align:right">Monto anual</th></tr>
      </thead>
      <tbody>${filasVehiculos}</tbody>
      ${total != null ? `<tfoot><tr><td colspan="5" class="r">Total anual</td><td class="r">${esc(fmtMonto(total))}</td></tr></tfoot>` : ''}
    </table>

    <h2>Observaciones</h2>
    <div class="obs">${esc(data.observaciones || '')}</div>

    <p class="decl">
      Ambas partes declaran su conformidad con los términos del presente contrato de servicio, que ampara a los vehículos
      detallados por el periodo comprendido entre el ${esc(fmtFecha(data.fechaInicio))} y el ${esc(fmtFecha(data.fechaFin))}.
      El servicio se mantendrá activo mientras el contrato se encuentre vigente.
    </p>

    <div class="firmas">
      <div class="firma">
        <div class="linea"></div>
        <div class="rol">Firma del cliente</div>
        <div class="sub">${esc(cliente?.nombre || '')}${cliente?.nroDoc ? ' · ' + esc(cliente.nroDoc) : ''}</div>
      </div>
      <div class="firma">
        <div class="linea"></div>
        <div class="rol">Firma del proveedor</div>
        <div class="sub">${esc(empresaNombre)}</div>
      </div>
    </div>

    <div class="pie">Documento generado el ${esc(fmtFecha(hoy))} · ${esc(empresaNombre)}</div>
  </div>
</body>
</html>`;
}
