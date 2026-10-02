/**
 * Qué afectación de IGV le corresponde por defecto a un producto nuevo.
 *
 * Pedido de FRUTA PURA, que opera bajo la **Ley de Amazonía (Ley 27037)**: sus
 * ventas van exoneradas. El sistema ya respetaba la afectación de cada
 * producto, pero todo producto nuevo nacía en "10 gravado", así que había que
 * acordarse de cambiarlo uno por uno. El olvido no se ve al guardar: se ve en
 * la factura, con el IGV ya cobrado al cliente.
 *
 * Espeja a `frontend/src/utils/afectacionIgv.ts`. Vive acá también porque el
 * import de Excel y las plantillas crean productos sin pasar por el formulario.
 */

export const AFECTACION_GRAVADO = '10';
export const AFECTACION_EXONERADO = '20';

/** Los únicos códigos del Catálogo 07 que acepta el catálogo de productos. */
export const AFECTACIONES_VALIDAS = ['10', '20', '30', '40'];

export interface EmpresaConAfectacion {
  leyAmazonia?: boolean | null;
}

/**
 * Sin empresa, gravado: es el comportamiento de siempre.
 *
 * Equivocarse hacia gravado es un cobro de más que el cliente reclama el mismo
 * día; equivocarse hacia exonerado es un tributo no cobrado que aparece meses
 * después. Por eso el default solo cambia cuando la empresa lo declaró.
 */
export const afectacionPorDefecto = (
  empresa?: EmpresaConAfectacion | null,
): string => (empresa?.leyAmazonia ? AFECTACION_EXONERADO : AFECTACION_GRAVADO);

/**
 * Normaliza lo que viene de una celda de Excel.
 *
 * Una celda vacía, o con basura, cae al default de la empresa — no a gravado
 * fijo: en una empresa amazónica eso convertía cada import en una carga de
 * productos con IGV.
 */
export const afectacionDeCelda = (
  valor: unknown,
  empresa?: EmpresaConAfectacion | null,
): string => {
  const texto = valor == null ? '' : String(valor).trim();
  if (AFECTACIONES_VALIDAS.includes(texto)) return texto;
  const n = parseInt(texto, 10);
  if (AFECTACIONES_VALIDAS.includes(String(n))) return String(n);
  return afectacionPorDefecto(empresa);
};
