import { DocumentoInvalido, conceptoKardex, leerDocumento, loteObligatorioPara, numeroVisible } from './reglas';
import { motivoDelConcepto, esPerdida } from '../producto/motivo-ajuste-stock';

const base = { tipo: 'ENTRADA', motivo: 'INVENTARIO_INICIAL', items: [{ productoId: 1, cantidad: 5 }] };

const problemasDe = (body: any) => {
  try {
    leerDocumento(body);
  } catch (e) {
    if (e instanceof DocumentoInvalido) return { mensaje: e.message, problemas: e.problemas };
    throw e;
  }
  throw new Error('se esperaba un error');
};

describe('leerDocumento', () => {
  it('lee una entrada simple', () => {
    const d = leerDocumento(base);
    expect(d.tipo).toBe('ENTRADA');
    expect(d.lineas).toEqual([{ productoId: 1, cantidad: 5, costoUnitario: undefined, lote: undefined, vence: undefined }]);
  });

  it('acepta minúsculas en tipo y motivo', () => {
    expect(leerDocumento({ ...base, tipo: 'salida', motivo: 'merma' }).motivo).toBe('MERMA');
  });

  it('no mezcla motivos: merma no es de entrada', () => {
    expect(problemasDe({ ...base, motivo: 'MERMA' }).mensaje).toMatch(/no es un motivo de entrada/);
  });

  it('"Otro motivo" exige el detalle', () => {
    expect(problemasDe({ ...base, motivo: 'OTRO' }).mensaje).toMatch(/detalle/);
    expect(leerDocumento({ ...base, motivo: 'OTRO', detalle: 'feria' }).detalle).toBe('feria');
  });

  it('sin productos no hay documento', () => {
    expect(problemasDe({ ...base, items: [] }).mensaje).toMatch(/al menos un producto/);
  });

  it('junta los problemas de todas las filas', () => {
    const r = problemasDe({
      ...base,
      items: [
        { productoId: 1, cantidad: 0 },
        { productoId: 2, cantidad: 1.2345 },
        { productoId: 3, cantidad: 1 },
        { productoId: 3, cantidad: 2 },
      ],
    });
    expect(r.mensaje).toBe('Hay 3 filas por corregir.');
    expect(r.problemas.map((p) => p.linea)).toEqual([1, 2, 4]);
    expect(r.problemas[2].mensaje).toMatch(/suma las cantidades/);
  });

  it('el mismo producto en dos lotes distintos sí se permite', () => {
    const d = leerDocumento({
      ...base,
      items: [
        { productoId: 1, cantidad: 1, lote: 'l1', vence: '2027-01-31' },
        { productoId: 1, cantidad: 1, lote: 'L2', vence: '2027-02-28' },
      ],
    });
    expect(d.lineas.map((l) => l.lote)).toEqual(['L1', 'L2']);
  });

  it('una salida ignora el costo escrito: se valoriza al costo del producto', () => {
    const d = leerDocumento({ tipo: 'SALIDA', motivo: 'MERMA', items: [{ productoId: 1, cantidad: 1, costoUnitario: 999 }] });
    expect(d.lineas[0].costoUnitario).toBeUndefined();
  });

  it('valida costo y fecha', () => {
    const r = problemasDe({ ...base, items: [{ productoId: 1, cantidad: 1, costoUnitario: -1, vence: '31/01/2027' }] });
    expect(r.problemas.map((p) => p.mensaje)).toEqual(['El costo no puede ser negativo.', 'La fecha de vencimiento no es válida.']);
  });
});

describe('número y concepto', () => {
  it('numera NE/NS con seis dígitos', () => {
    expect(numeroVisible('ENTRADA', 1)).toBe('NE-000001');
    expect(numeroVisible('SALIDA', 1234)).toBe('NS-001234');
  });

  it('una salida por merma cuenta en el reporte de Mermas', () => {
    const c = conceptoKardex('SALIDA', 'MERMA', 3);
    expect(c).toBe('Merma (producto roto o dañado) · Salida NS-000003');
    expect(motivoDelConcepto(c)?.codigo).toBe('MERMA');
    expect(esPerdida(c)).toBe(true);
  });

  it('los motivos nuevos tienen su etiqueta y no cuentan como pérdida', () => {
    const c = conceptoKardex('SALIDA', 'MUESTRA', 1);
    expect(motivoDelConcepto(c)?.codigo).toBe('MUESTRA');
    expect(esPerdida(c)).toBe(false);
    expect(conceptoKardex('ENTRADA', 'INVENTARIO_INICIAL', 1)).toBe('Inventario inicial · Entrada NE-000001');
  });
});

describe('lotes por rubro', () => {
  it.each([
    ['Farmacia', true],
    ['Botica', true],
    ['Droguería y Distribuidora Farmacéutica', true],
    ['Fabricación', false],
    ['Bodega', false],
  ])('%s → obligatorio %s', (rubro, esperado) => {
    expect(loteObligatorioPara(rubro)).toBe(esperado);
  });
});
