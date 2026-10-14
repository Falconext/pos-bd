/**
 * Las plantillas del PDF del servidor tienen que decir lo mismo que la
 * impresión web.
 *
 * Son DOS implementaciones del mismo documento: `comprobanteImprimir.tsx` para
 * lo que se imprime desde el navegador, y estos .hbs para el PDF que sale por
 * correo, por WhatsApp y por "Ver PDF". Arreglé la primera y la segunda se
 * quedó atrás: seguía con la columna "N°" (un correlativo de línea que no
 * identifica nada), con la cabecera gris que el cliente pidió quitar y con la
 * descripción sin ancho propio.
 *
 * Esta prueba lee los .hbs como texto. No valida cómo se ve —para eso están las
 * medidas hechas en pantalla— sino que las dos plantillas no se vuelvan a
 * quedar atrás sin que nadie se entere.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const PLANTILLAS = ['comprobante.hbs', 'cotizacion.hbs'] as const;
const leer = (nombre: string) =>
  readFileSync(join(__dirname, 'templates', nombre), 'utf8');

describe.each(PLANTILLAS)('plantilla %s', (nombre) => {
  const html = leer(nombre);

  it('imprime el CÓDIGO del producto, no el número de línea', () => {
    expect(html).toContain('CÓDIGO');
    // La celda imprime el código ({{codigo}} o {{this.codigo}} según la
    // plantilla), no {{index}} ni {{inc @index}}, que eran el correlativo.
    expect(html).toMatch(/\{\{(this\.)?codigo\}\}/);
    expect(html).not.toMatch(/<th class="col-n">/);
    expect(html).not.toMatch(/<td class="col-n">/);
  });

  it('la cabecera de la tabla va sin fondo', () => {
    const thead = html.slice(
      html.indexOf('.productos-table thead'),
      html.indexOf('.productos-table thead') + 200,
    );
    expect(thead).not.toMatch(/background/);
  });

  it('la descripción tiene ancho propio en el reparto BASE', () => {
    // Sin ancho se queda con lo que sobre, y con el código al 18% quedaba tan
    // angosta que cada línea se partía en varias.
    //
    // Se mira solo el bloque anterior al `{{#if esA5}}`: la primera versión de
    // esta prueba buscaba `.col-desc { width: … }` en todo el archivo y pasaba
    // en verde gracias a la regla de A5, aunque la base estuviera sin ancho.
    const base = html.slice(0, html.indexOf('{{#if esA5}}'));
    expect(base).toMatch(/\.col-desc\s*\{[^}]*width:/);
  });

  it('A5 trae su propio reparto: los títulos miden lo mismo en hoja angosta', () => {
    // 8% de la tabla A4 alcanza para "MONEDA"; 8% de la A5 no, y se montaba
    // sobre P.UNIT.
    expect(html).toContain('{{#if esA5}}');
  });
});

describe('el PDF no se titula "Cotización" cuando no lo es', () => {
  it('la plantilla de informales toma el nombre del documento', () => {
    // Esta plantilla la usan nota de venta, orden de trabajo, nota de pedido…
    // Con el título fijo, una orden de trabajo se descargaba como "Cotización".
    const html = leer('cotizacion.hbs');
    expect(html).toMatch(/<title>\{\{#if tituloDocumento\}\}/);
  });
});
