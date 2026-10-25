/**
 * ¿Es un RUC que SUNAT puede aceptar? Prefijo válido y dígito verificador
 * (módulo 11, pesos 5-4-3-2-7-6-5-4-3-2).
 *
 * Prueba como integrador (24-10): la API aceptaba "20123456789". En una venta
 * real la factura se emitía, gastaba su número y SUNAT la rechazaba después.
 * Un RUC tipeado mal casi siempre falla el verificador: se avisa antes.
 */
const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function rucValido(ruc: string | null | undefined): boolean {
  const r = String(ruc ?? '');
  if (!/^(10|15|17|20)\d{9}$/.test(r)) return false;
  const suma = PESOS.reduce((s, p, i) => s + p * Number(r[i]), 0);
  const resto = 11 - (suma % 11);
  const verificador = resto === 10 ? 0 : resto === 11 ? 1 : resto;
  return verificador === Number(r[10]);
}

export const MENSAJE_RUC_INVALIDO =
  'El RUC no es válido: tiene que tener 11 dígitos, empezar con 10, 15, 17 o 20, y su último dígito (verificador) no cuadra. Revisa que esté bien escrito.';
