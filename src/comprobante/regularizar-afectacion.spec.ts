import { lineasConAfectacionErrada } from './regularizar-afectacion.service';

describe('líneas emitidas con la afectación equivocada', () => {
  const nota = [
    { productoId: 1, descripcion: 'IK. JALAPEÑO 30gr X6und', tipAfeIgv: 20 },
    { productoId: 2, descripcion: 'OC. HABAS X8und', tipAfeIgv: 10 },
    { productoId: null, descripcion: 'DELIVERY', tipAfeIgv: 30 },
  ];

  it('detecta exonerado o inafecto en la nota que salió gravado', () => {
    const r = lineasConAfectacionErrada(
      [
        { productoId: 1, descripcion: 'IK. JALAPEÑO 30gr X6und', cantidad: 2, mtoPrecioUnitario: 25, tipAfeIgv: 10 },
        { productoId: null, descripcion: 'DELIVERY', cantidad: 1, mtoPrecioUnitario: 10, tipAfeIgv: 10 },
      ],
      nota,
    );
    expect(r).toEqual([
      { descripcion: 'IK. JALAPEÑO 30gr X6und', cantidad: 2, precio: 25, afectacionEmitida: 10, afectacionNota: 20, segun: 'nota' },
      { descripcion: 'DELIVERY', cantidad: 1, precio: 10, afectacionEmitida: 10, afectacionNota: 30, segun: 'nota' },
    ]);
  });

  it('no toca lo que en la nota también era gravado ni lo ya exonerado', () => {
    expect(
      lineasConAfectacionErrada(
        [
          { productoId: 2, descripcion: 'OC. HABAS X8und', cantidad: 1, mtoPrecioUnitario: 12, tipAfeIgv: 10 },
          { productoId: 1, descripcion: 'IK. JALAPEÑO 30gr X6und', cantidad: 1, mtoPrecioUnitario: 25, tipAfeIgv: 20 },
        ],
        nota,
      ),
    ).toEqual([]);
  });

  // FRUTA PURA 31-10: editar la nota antes de pos-web #98 la dejó gravada; la
  // boleta coincidía con la nota y no aparecía. Con Ley de Amazonía vale el producto.
  const notaEditada = [
    { productoId: 29754, descripcion: 'TK. TAKIS FUEGO 56gr X6und', tipAfeIgv: 10 },
    { productoId: 31977, descripcion: 'SD. PAQ. ROSQUITAS AJONJOLI. 100gr X6und', tipAfeIgv: 20 },
  ];
  const boletaB001_12077 = [
    { productoId: 29754, descripcion: 'TK. TAKIS FUEGO 56gr X6und', cantidad: 1, mtoPrecioUnitario: 45, tipAfeIgv: 10 },
    { productoId: 31977, descripcion: 'SD. PAQ. ROSQUITAS AJONJOLI. 100gr X6und', cantidad: 1, mtoPrecioUnitario: 10, tipAfeIgv: 20 },
  ];

  it('nota y boleta gravadas, producto exonerado con Ley de Amazonía → se regulariza según el producto', () => {
    expect(lineasConAfectacionErrada(boletaB001_12077, notaEditada, new Map([[29754, 20], [31977, 20]]))).toEqual([
      { descripcion: 'TK. TAKIS FUEGO 56gr X6und', cantidad: 1, precio: 45, afectacionEmitida: 10, afectacionNota: 20, segun: 'producto' },
    ]);
  });

  it('sin Ley de Amazonía (sin mapa de productos) no se toca: la nota manda', () => {
    expect(lineasConAfectacionErrada(boletaB001_12077, notaEditada)).toEqual([]);
  });

  it('producto gravado de verdad sigue gravado aunque la empresa tenga Ley de Amazonía', () => {
    expect(lineasConAfectacionErrada(boletaB001_12077, notaEditada, new Map([[29754, 10]]))).toEqual([]);
  });
});
