import { ProductoService } from './producto.service';

/**
 * Presentación (paquete) sin código de barras.
 *
 * Reportado desde el panel como "no me deja guardar si no le pongo un código
 * de barras adicional". En realidad el producto SÍ se guardaba y respondía OK:
 * lo que pasaba es que la fila del paquete se descartaba en silencio, así que
 * al volver a abrir la ficha el paquete ya no estaba.
 *
 * El modelo exige `codigo` porque es la identidad de la presentación y por
 * donde se escanea en el POS. La salida no es exigírselo al empresario, sino
 * derivarlo del SKU cuando no lo tiene.
 */
describe('Presentación de paquete sin código de barras', () => {
  // `normalizarCodigosExtra` es privado: se accede por índice, como hacen los
  // demás specs del módulo, para no exponerlo solo por el test.
  const normalizar = (
    codigos: any[],
    principal?: string | null,
    codigoProducto?: string | null,
  ) =>
    (ProductoService.prototype as any).normalizarCodigosExtra.call(
      {},
      codigos,
      principal,
      codigoProducto,
    );

  it('deriva el código del SKU cuando el paquete no trae ninguno', () => {
    const r = normalizar(
      [{ codigo: '', unidadesPorPaquete: 6, precioPaquete: 45 }],
      null,
      'PR493',
    );
    expect(r).toHaveLength(1);
    expect(r[0].codigo).toBe('PR493-X6');
    expect(r[0].unidadesPorPaquete).toBe(6);
    expect(r[0].precioPaquete).toBe(45);
  });

  it('respeta el código de barras real si lo pusieron', () => {
    const r = normalizar(
      [{ codigo: '7501234567890', unidadesPorPaquete: 6 }],
      null,
      'PR493',
    );
    expect(r[0].codigo).toBe('7501234567890');
  });

  it('usa el código interno antes que uno derivado', () => {
    const r = normalizar(
      [{ codigo: '', codigoInterno: 'CAJA-12', unidadesPorPaquete: 12 }],
      null,
      'PR493',
    );
    expect(r[0].codigo).toBe('CAJA-12');
  });

  it('una fila con precio propio pero sin paquete también es una presentación', () => {
    const r = normalizar(
      [{ codigo: '', unidadesPorPaquete: 1, precioPaquete: 30 }],
      null,
      'PR493',
    );
    expect(r).toHaveLength(1);
    expect(r[0].codigo).toBe('PR493-X1');
  });

  it('una fila vacía de verdad se sigue descartando', () => {
    // Un renglón que el usuario agregó y no llenó no debe crear nada.
    const r = normalizar([{ codigo: '', unidadesPorPaquete: 1 }], null, 'PR493');
    expect(r).toHaveLength(0);
  });

  it('no duplica el código de barras principal del producto', () => {
    const r = normalizar(
      [{ codigo: '7501234567890', unidadesPorPaquete: 1 }],
      '7501234567890',
      'PR493',
    );
    expect(r).toHaveLength(0);
  });

  it('sin SKU cae a un prefijo genérico en vez de descartar la presentación', () => {
    const r = normalizar([{ codigo: '', unidadesPorPaquete: 6 }], null, null);
    expect(r[0].codigo).toBe('PAQ-X6');
  });

  it('normaliza el SKU a mayúsculas y sin espacios', () => {
    const r = normalizar([{ codigo: '', unidadesPorPaquete: 4 }], null, 'ab 12');
    expect(r[0].codigo).toBe('AB-12-X4');
  });
});
