/**
 * Filtro de búsqueda del listado de empresas (/administrador/empresas).
 *
 * Antes era `contains` exacto sobre RUC y razón social: "henko" no encontraba
 * "HENKO IMPORTACIONES S.A.C." y el nombre comercial no se miraba. Ahora no
 * distingue mayúsculas y cada palabra puede caer en cualquiera de los tres
 * campos ("importaciones henko" también la encuentra).
 */
export const filtroBusquedaEmpresa = (search?: string | null): any | null => {
  const palabras = String(search ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (palabras.length === 0) return null;
  return {
    AND: palabras.map((p) => ({
      OR: [
        { ruc: { contains: p } },
        { razonSocial: { contains: p, mode: 'insensitive' } },
        { nombreComercial: { contains: p, mode: 'insensitive' } },
      ],
    })),
  };
};
