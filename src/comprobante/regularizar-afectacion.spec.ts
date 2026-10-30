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
      { descripcion: 'IK. JALAPEÑO 30gr X6und', cantidad: 2, precio: 25, afectacionEmitida: 10, afectacionNota: 20 },
      { descripcion: 'DELIVERY', cantidad: 1, precio: 10, afectacionEmitida: 10, afectacionNota: 30 },
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
});
