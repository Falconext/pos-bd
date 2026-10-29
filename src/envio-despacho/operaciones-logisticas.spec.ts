import {
  consolidarProductos,
  distritoEva,
  filaEva,
  filaGeneral,
  filaShalom,
  metodoCobroEva,
  type OperacionEnvio,
} from './operaciones-logisticas';

const envio = (o: Partial<OperacionEnvio> = {}): OperacionEnvio => ({
  comprobanteId: 1,
  referencia: 'NV01-00000450',
  fechaEmision: '',
  fechaEnvio: '29/10/2026',
  estado: 'Preparando',
  courier: 'PROPIOS',
  courierLabel: 'Reparto propio',
  tipoEnvio: 'DOMICILIO',
  nombre: 'GOMEZ CUEVA KATIA BELZABETH',
  dni: '46531103',
  telefono: '907236450',
  agencia: '',
  distrito: 'San Martín de Porres',
  direccion: 'Av. Perú 123',
  coordenadas: '',
  montoCobrar: 318,
  totalVenta: 318,
  formaPago: 'EFECTIVO',
  tipoVenta: 'CONTRAENTREGA',
  empaquetador: '',
  repartidor: '',
  observaciones: '',
  turno: '',
  nroPaquetes: 1,
  tamano: '',
  revisarProducto: false,
  sede: 'Principal',
  faltan: [],
  items: [
    { codigo: '00022', descripcion: 'TRIPODE SMAR TRACK INTELIGENTE', cantidad: 1, unidad: 'NIU', imagenUrl: null },
    { codigo: '00051', descripcion: 'CABLE DE CARGA RAPIDA', cantidad: 2, unidad: 'NIU', imagenUrl: null },
  ],
  ...o,
});

describe('distrito para Eva Courier', () => {
  it('lo deja como lo lista Eva, sin importar tildes ni mayúsculas', () => {
    expect(distritoEva('San Martín de Porres')).toBe('SAN MARTIN DE PORRES');
    expect(distritoEva('breña')).toBe('BREÑA');
    expect(distritoEva('Pachacamac')).toBe('PACHACÁMAC');
  });

  it('entiende los nombres cortos de siempre', () => {
    expect(distritoEva('Surco')).toBe('SANTIAGO DE SURCO');
    expect(distritoEva('SJL')).toBe('SAN JUAN DE LURIGANCHO');
    expect(distritoEva('Lima')).toBe('CERCADO DE LIMA');
  });

  it('sin distrito y por agencia va como provincia del courier', () => {
    expect(distritoEva('', 'SHALOM_PRO')).toBe('PROVINCIA SHALOM');
    expect(distritoEva('', 'OLVA')).toBe('PROVINCIA OLVA');
  });
});

describe('método de cobro para Eva', () => {
  it('sin monto es solo entregar', () => {
    expect(metodoCobroEva({ montoCobrar: 0, formaPago: 'EFECTIVO', tipoVenta: 'CONTRAENTREGA' })).toBe('SOLO ENTREGAR');
  });
  it('Yape y transferencia van juntos, como en su lista', () => {
    expect(metodoCobroEva({ montoCobrar: 10, formaPago: 'YAPE', tipoVenta: '' })).toBe('TRANSFERENCIA / YAPE');
  });
  it('un cambio se marca como cambio aunque cobre', () => {
    expect(metodoCobroEva({ montoCobrar: 10, formaPago: 'EFECTIVO', tipoVenta: 'CONTRAENTREGA_CAMBIO' })).toBe(
      'CAMBIO / CAMBIO CON COBRO',
    );
  });
});

describe('plantillas', () => {
  it('Eva: las 14 columnas en su orden, con el detalle por línea', () => {
    const fila = filaEva(envio());
    expect(Object.keys(fila)).toHaveLength(14);
    expect(Object.keys(fila)[0]).toBe('(opcional) CÓDIGO PEDIDO');
    expect(fila['DISTRITO ENTREGA']).toBe('SAN MARTIN DE PORRES');
    expect(fila['IMPORTE A COBRAR (S/.)']).toBe(318);
    expect(fila['DESCRIPCION DEL PRODUCTO (especifique el nombre de producto a entregar)']).toBe(
      '1 TRIPODE SMAR TRACK INTELIGENTE\n2 CABLE DE CARGA RAPIDA',
    );
  });

  it('Shalom: DNI, agencia de destino y tamaño como "PAQUETE XS"', () => {
    const fila = filaShalom(envio({ agencia: 'TAMBOPATA AV UCAYALI', tamano: 'XS', courier: 'SHALOM_PRO' }), 'PRO');
    expect(Object.keys(fila)).toHaveLength(13);
    expect(fila['DESTINATARIO (DOC)']).toBe('46531103');
    expect(fila.DESTINO).toBe('TAMBOPATA AV UCAYALI');
    expect(fila.MERCADERIA).toBe('PAQUETE XS');
    expect(fila.ORIGEN).toBe('PRO');
  });

  it('general: marca lo que falta para no despachar a ciegas', () => {
    expect(filaGeneral(envio({ faltan: ['teléfono'] }))['✔ DATOS']).toBe('Faltan: teléfono');
    expect(filaGeneral(envio())['UNIDADES']).toBe(3);
  });
});

describe('picking consolidado', () => {
  it('suma el mismo producto de varios pedidos y ordena por lo que más se saca', () => {
    const r = consolidarProductos([
      envio({ referencia: 'NV01-448' }),
      envio({ referencia: 'NV01-449', items: [{ codigo: '00022', descripcion: 'TRIPODE SMAR TRACK INTELIGENTE', cantidad: 2, unidad: 'NIU', imagenUrl: null }] }),
    ]);
    expect(r[0]).toMatchObject({ codigo: '00022', total: 3, pedidos: ['NV01-448', 'NV01-449'] });
    expect(r[1]).toMatchObject({ codigo: '00051', total: 2, pedidos: ['NV01-448'] });
  });
});
