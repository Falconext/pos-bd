/**
 * Convierte un número a su representación en letras (español)
 */
export function numeroALetras(num: number): string {
  const unidades = [
    '',
    'UNO',
    'DOS',
    'TRES',
    'CUATRO',
    'CINCO',
    'SEIS',
    'SIETE',
    'OCHO',
    'NUEVE',
  ];
  const decenas = [
    '',
    'DIEZ',
    'VEINTE',
    'TREINTA',
    'CUARENTA',
    'CINCUENTA',
    'SESENTA',
    'SETENTA',
    'OCHENTA',
    'NOVENTA',
  ];
  const especiales = [
    'DIEZ',
    'ONCE',
    'DOCE',
    'TRECE',
    'CATORCE',
    'QUINCE',
    'DIECISÉIS',
    'DIECISIETE',
    'DIECIOCHO',
    'DIECINUEVE',
  ];
  const centenas = [
    '',
    'CIENTO',
    'DOSCIENTOS',
    'TRESCIENTOS',
    'CUATROCIENTOS',
    'QUINIENTOS',
    'SEISCIENTOS',
    'SETECIENTOS',
    'OCHOCIENTOS',
    'NOVECIENTOS',
  ];

  if (num === 0) return 'CERO';
  if (num === 100) return 'CIEN';

  const convertirGrupo = (n: number): string => {
    if (n === 0) return '';
    if (n < 10) return unidades[n];
    if (n >= 10 && n < 20) return especiales[n - 10];
    if (n >= 20 && n < 100) {
      const dec = Math.floor(n / 10);
      const uni = n % 10;
      if (uni === 0) return decenas[dec];
      if (dec === 2) return 'VEINTI' + unidades[uni];
      return decenas[dec] + ' Y ' + unidades[uni];
    }
    if (n >= 100 && n < 1000) {
      const cen = Math.floor(n / 100);
      const resto = n % 100;
      if (n === 100) return 'CIEN';
      return centenas[cen] + (resto > 0 ? ' ' + convertirGrupo(resto) : '');
    }
    return '';
  };

  let entero = Math.floor(num);
  const decimales = Math.round((num - entero) * 100);

  let resultado = '';

  if (entero >= 1000000) {
    const millones = Math.floor(entero / 1000000);
    resultado +=
      millones === 1 ? 'UN MILLÓN' : convertirGrupo(millones) + ' MILLONES';
    entero %= 1000000;
    if (entero > 0) resultado += ' ';
  }

  if (entero >= 1000) {
    const miles = Math.floor(entero / 1000);
    if (miles === 1) {
      resultado += 'MIL';
    } else {
      resultado += convertirGrupo(miles) + ' MIL';
    }
    entero %= 1000;
    if (entero > 0) resultado += ' ';
  }

  if (entero > 0) {
    resultado += convertirGrupo(entero);
  }

  resultado += ' Y ' + decimales.toString().padStart(2, '0') + '/100';

  return resultado.trim();
}
