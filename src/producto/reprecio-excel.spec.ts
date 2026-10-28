import * as XLSX from 'xlsx';
import {
  aNumero,
  hojaABuffer,
  leerExcelReprecio,
  plantillaReprecio,
  respaldoReprecio,
  tramosAPrecios,
  validarTramos,
} from './reprecio-excel';
import { ReprecioExcelService } from './reprecio-excel.service';

const xls = (filas: unknown[][]) => hojaABuffer(filas, 'Hoja');

describe('reprecio con Excel — lectura', () => {
  it('formato de precios: Código | Precio', () => {
    const r = leerExcelReprecio(
      xls([
        ['Código', 'Precio'],
        ['articulo2', 5],
        ['A-3', '12,50'],
        ['', ''],
      ]),
    );
    expect(r.tipo).toBe('PRECIO');
    expect(r.filas).toEqual([
      { fila: 2, codigo: 'articulo2', precio: 5 },
      { fila: 3, codigo: 'A-3', precio: 12.5 },
    ]);
  });

  it('precio que no es número queda marcado', () => {
    const r = leerExcelReprecio(
      xls([
        ['Codigo', 'Precio'],
        ['X', 'diez'],
      ]),
    );
    expect(r.filas[0]).toMatchObject({ precio: null, precioInvalido: 'diez' });
  });

  it('formato por volumen: tramos repetidos, el vacío no cuenta', () => {
    const r = leerExcelReprecio(
      xls([
        [
          'Código',
          'RangoInicial1',
          'RangoFinal1',
          'Precio1',
          'RangoInicial2',
          'RangoFinal2',
          'Precio2',
        ],
        ['articulo1', 1, 5, 10, 6, '', 9],
        ['articulo2', 12, '', 7, '', '', ''],
      ]),
    );
    expect(r.tipo).toBe('VOLUMEN');
    expect(r.filas[0].tramos).toEqual([
      { desde: 1, hasta: 5, precio: 10 },
      { desde: 6, hasta: null, precio: 9 },
    ]);
    expect(r.filas[1].tramos).toEqual([{ desde: 12, hasta: null, precio: 7 }]);
  });

  it('sin columna Código avisa', () => {
    expect(() =>
      leerExcelReprecio(
        xls([
          ['Producto', 'Precio'],
          ['x', 1],
        ]),
      ),
    ).toThrow('Código');
  });

  it('las plantillas se leen con su propio lector', () => {
    expect(leerExcelReprecio(plantillaReprecio('PRECIO')).filas).toHaveLength(
      2,
    );
    const v = leerExcelReprecio(plantillaReprecio('VOLUMEN'));
    expect(v.filas.every((f) => !f.errorTramos)).toBe(true);
  });
});

describe('reprecio con Excel — tramos', () => {
  it('se pisan → error', () => {
    expect(
      validarTramos([
        { desde: 1, hasta: 10, precio: 5 },
        { desde: 8, hasta: '', precio: 4 },
      ]).error,
    ).toMatch(/Tramo 2/);
  });
  it('rango final vacío en un tramo del medio → error', () => {
    expect(
      validarTramos([
        { desde: 1, hasta: '', precio: 5 },
        { desde: 8, hasta: '', precio: 4 },
      ]).error,
    ).toMatch(/último/);
  });
  it('precio 0 → error', () => {
    expect(validarTramos([{ desde: 1, hasta: 2, precio: 0 }]).error).toMatch(
      /precio/,
    );
  });
  it('el tramo desde 1 es el precio normal y el resto el mayorista', () => {
    expect(
      tramosAPrecios([
        { desde: 1, hasta: 5, precio: 10 },
        { desde: 6, hasta: null, precio: 9 },
      ]),
    ).toEqual({
      precioBase: 10,
      mayorista: [{ cantidadMinima: 6, precio: 9 }],
    });
  });
  it('aNumero acepta coma y S/', () => {
    expect(aNumero('S/ 3,5')).toBe(3.5);
    expect(aNumero('')).toBeNull();
  });
});

describe('reprecio con Excel — respaldo', () => {
  it('el respaldo por volumen se vuelve a leer igual', () => {
    const buf = respaldoReprecio('VOLUMEN', [
      {
        codigo: 'A',
        precio: 10,
        mayorista: [
          { cantidadMinima: 6, precio: 9 },
          { cantidadMinima: 12, precio: 8 },
        ],
      },
    ]);
    const r = leerExcelReprecio(buf);
    const { precioBase, mayorista } = tramosAPrecios(r.filas[0].tramos!);
    expect(precioBase).toBe(10);
    expect(mayorista).toEqual([
      { cantidadMinima: 6, precio: 9 },
      { cantidadMinima: 12, precio: 8 },
    ]);
  });
});

describe('ReprecioExcelService', () => {
  const productos = [
    {
      id: 1,
      codigo: 'articulo2',
      codigoBarras: null,
      descripcion: 'Art 2',
      precioUnitario: 4,
      preciosMayorista: null,
      igvPorcentaje: 18,
      tipoAfectacionIGV: '10',
      stocks: [],
    },
    {
      id: 2,
      codigo: 'B',
      codigoBarras: '775000',
      descripcion: 'B',
      precioUnitario: 5,
      preciosMayorista: [{ cantidadMinima: 6, precio: 4 }],
      igvPorcentaje: 18,
      tipoAfectacionIGV: '20',
      stocks: [{ sedeId: 3 }],
    },
  ];
  let prisma: any;
  let svc: ReprecioExcelService;
  beforeEach(() => {
    prisma = {
      producto: {
        findMany: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              where.id
                ? productos.filter((p) => where.id.in.includes(p.id))
                : productos,
            ),
          ),
        update: jest.fn().mockImplementation((x) => x),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    svc = new ReprecioExcelService(prisma);
  });

  it('el Excel real del cliente: código repetido usa la última fila', async () => {
    const r = await svc.previsualizar(
      1,
      xls([
        ['Código', 'Precio'],
        ['articulo2', 5],
        ['articulo2', 5],
      ]),
    );
    expect(r.filas[0]).toMatchObject({
      estado: 'ERROR',
      mensaje: 'Código repetido: se usa la fila 3',
    });
    expect(r.filas[1]).toMatchObject({
      estado: 'CAMBIA',
      precioActual: 4,
      precioNuevo: 5,
    });
  });

  it('busca por código de barras y avisa precio propio de sede', async () => {
    const r = await svc.previsualizar(
      1,
      xls([
        ['Código', 'Precio'],
        ['775000', 5],
        ['NOEXISTE', 3],
      ]),
    );
    expect(r.filas[0]).toMatchObject({
      productoId: 2,
      estado: 'SIN_CAMBIO',
      sedesConPrecioPropio: 1,
    });
    expect(r.filas[1]).toMatchObject({
      estado: 'ERROR',
      mensaje: 'No hay un producto con ese código',
    });
  });

  it('aplicar: escribe precio y valor sin IGV (exonerado = mismo valor) y devuelve respaldo', async () => {
    const r = await svc.aplicar(
      1,
      xls([
        [
          'Código',
          'RangoInicial1',
          'RangoFinal1',
          'Precio1',
          'RangoInicial2',
          'RangoFinal2',
          'Precio2',
        ],
        ['articulo2', 1, 5, 11.8, 6, '', 10],
        ['B', 1, 11, 6, 12, '', 5],
      ]),
    );
    expect(r.actualizados).toBe(2);
    const updates = prisma.producto.update.mock.calls.map((c: any) => c[0]);
    expect(updates[0].data).toEqual({
      precioUnitario: 11.8,
      valorUnitario: 10,
      preciosMayorista: [{ cantidadMinima: 6, precio: 10 }],
    });
    expect(updates[1].data).toEqual({
      precioUnitario: 6,
      valorUnitario: 6,
      preciosMayorista: [{ cantidadMinima: 12, precio: 5 }],
    });
    const respaldo = XLSX.read(Buffer.from(r.respaldoBase64, 'base64'));
    const filas = XLSX.utils.sheet_to_json<any[]>(
      respaldo.Sheets[respaldo.SheetNames[0]],
      { header: 1 },
    );
    // Fila de B con lo que tenía antes: 1-5 a S/ 5 y desde 6 a S/ 4.
    expect(filas[2]).toEqual(['B', 1, 5, 5, 6, '', 4]);
  });

  it('aplicar sin cambios → error claro', async () => {
    await expect(
      svc.aplicar(
        1,
        xls([
          ['Código', 'Precio'],
          ['articulo2', 4],
        ]),
      ),
    ).rejects.toThrow('No hay precios');
  });
});
