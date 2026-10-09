/**
 * C1 — clasificar el destino.
 *
 * Equivocarse de zona es cobrarle mal al cliente y pedirle los datos que no
 * son. Los casos vienen del prompt del cliente y del banco maestro, que tiene
 * un bloque entero preguntando "¿llegan a X?".
 */
import {
  CONFIG_ENVIO_HIERBA_SANA,
  ConfigEnvio,
  datosQuePedir,
  resolverDestino,
} from './envio-zonas';

const zonaDe = (texto: string) => {
  const r = resolverDestino(texto);
  return r === 'ambiguo' || r === null ? r : r.zona.nombre;
};
const lugarDe = (texto: string) => {
  const r = resolverDestino(texto);
  return r === 'ambiguo' || r === null ? null : r.lugar;
};

describe('Lima contra provincia', () => {
  it.each([
    'Miraflores',
    'vivo en San Borja',
    'para Los Olivos por favor',
    'Callao',
    'La Punta',
  ])('"%s" es Lima', (texto) => {
    expect(zonaDe(texto)).toBe('Lima');
  });

  it.each([
    // De la lista del cliente: estos son de la región Lima pero NO de su
    // cobertura, así que van como provincia.
    'Huacho',
    'Cañete',
    'Chosica',
    'Arequipa',
    'para Trujillo',
  ])('"%s" es provincia', (texto) => {
    expect(zonaDe(texto)).toBe('Provincia');
  });

  it('lo que no reconoce cae en provincia, no se inventa cobertura', () => {
    expect(zonaDe('un pueblo que no existe')).toBe('Provincia');
    expect(lugarDe('un pueblo que no existe')).toBeNull();
  });
});

describe('cómo lo escribe la gente de verdad', () => {
  it.each([
    ['SJL', 'San Juan de Lurigancho'],
    ['sjl', 'San Juan de Lurigancho'],
    ['Canto Grande', 'San Juan de Lurigancho'],
    ['Vitarte', 'Ate'],
    ['Ate Vitarte', 'Ate'],
    ['SMP', 'San Martín de Porres'],
    ['VES', 'Villa El Salvador'],
    ['Surco', 'Santiago de Surco'],
    ['Chacarilla', 'Santiago de Surco'],
    ['Magdalena', 'Magdalena del Mar'],
    ['Magdalena Vieja', 'Pueblo Libre'],
    ['Cercado', 'Cercado de Lima'],
  ])('"%s" se registra como %s', (escrito, oficial) => {
    expect(lugarDe(escrito)).toBe(oficial);
  });

  it('entiende sin tildes y en minúsculas', () => {
    expect(lugarDe('jesus maria')).toBe('Jesús María');
    expect(lugarDe('LURIN')).toBe('Lurín');
  });

  it('lo encuentra dentro de una frase', () => {
    expect(lugarDe('hola, la entrega sería para Breña ¿llegan?')).toBe('Breña');
  });

  it('prefiere el nombre más largo, no el primero que encaja', () => {
    // "San Juan de Miraflores" no puede resolverse como "Miraflores".
    expect(lugarDe('San Juan de Miraflores')).toBe('San Juan de Miraflores');
  });
});

describe('tarifas y forma de pago', () => {
  it('Lima cobra S/ 15 contraentrega', () => {
    const r = resolverDestino('Miraflores');
    expect(r).not.toBe('ambiguo');
    if (r === 'ambiguo' || !r) throw new Error('no resolvió');
    expect(r.zona.tarifa).toBe(15);
    expect(r.zona.tipo).toBe('DOMICILIO');
    expect(r.zona.notaPago).toContain('contraentrega');
  });

  it('provincia cobra S/ 10 y adelanta el 50%', () => {
    const r = resolverDestino('Cusco');
    if (r === 'ambiguo' || !r) throw new Error('no resolvió');
    expect(r.zona.tarifa).toBe(10);
    expect(r.zona.tipo).toBe('AGENCIA');
    expect(r.zona.notaPago).toContain('50%');
  });

  it('el recojo en tienda no cobra envío', () => {
    const r = resolverDestino('mejor paso por la tienda');
    if (r === 'ambiguo' || !r) throw new Error('no resolvió');
    expect(r.zona.tarifa).toBe(0);
    expect(r.zona.tipo).toBe('RECOJO');
  });
});

describe('cuando hay duda, se pregunta', () => {
  it('no adivina entre dos zonas que encajan igual', () => {
    // El flujo del cliente lo dice: si una zona puede ser de dos distritos,
    // confirmar antes de calcular el envío.
    const ambigua: ConfigEnvio = {
      zonaPorDefecto: 'Provincia',
      zonas: [
        {
          nombre: 'Lima',
          tipo: 'DOMICILIO',
          tarifa: 15,
          lugares: [{ nombre: 'San Juan' }],
        },
        {
          nombre: 'Norte',
          tipo: 'AGENCIA',
          tarifa: 10,
          lugares: [{ nombre: 'San Juan' }],
        },
        { nombre: 'Provincia', tipo: 'AGENCIA', tarifa: 10 },
      ],
    };
    expect(resolverDestino('San Juan', ambigua)).toBe('ambiguo');
  });

  it('un texto vacío no resuelve nada', () => {
    expect(resolverDestino('')).toBeNull();
    expect(resolverDestino('   ')).toBeNull();
  });
});

describe('las zonas son configuración, no código', () => {
  it('otra empresa define su propia cobertura y tarifas', () => {
    const otra: ConfigEnvio = {
      zonaPorDefecto: 'Resto del país',
      zonas: [
        {
          nombre: 'Arequipa ciudad',
          tipo: 'DOMICILIO',
          tarifa: 8,
          lugares: [{ nombre: 'Cayma' }, { nombre: 'Yanahuara' }],
        },
        { nombre: 'Resto del país', tipo: 'AGENCIA', tarifa: 12 },
      ],
    };
    const r = resolverDestino('Cayma', otra);
    if (r === 'ambiguo' || !r) throw new Error('no resolvió');
    expect(r.zona.nombre).toBe('Arequipa ciudad');
    expect(r.zona.tarifa).toBe(8);
    // Y Miraflores, que para Hierba Sana es Lima, aquí es resto del país.
    const m = resolverDestino('Miraflores', otra);
    if (m === 'ambiguo' || !m) throw new Error('no resolvió');
    expect(m.zona.nombre).toBe('Resto del país');
  });

  it('Hierba Sana trae los 37 distritos de su cobertura', () => {
    const lima = CONFIG_ENVIO_HIERBA_SANA.zonas.find(
      (z) => z.nombre === 'Lima',
    );
    expect(lima?.lugares).toHaveLength(37);
  });
});

describe('datosQuePedir', () => {
  it('a domicilio pide dirección; a agencia, no', () => {
    expect(datosQuePedir('DOMICILIO')).toContain(
      'dirección con calle y número',
    );
    expect(datosQuePedir('AGENCIA')).not.toContain(
      'dirección con calle y número',
    );
  });

  it('a provincia el DNI es obligatorio; en Lima, opcional', () => {
    expect(datosQuePedir('AGENCIA')).toContain('DNI');
    expect(datosQuePedir('DOMICILIO')).toContain(
      'DNI (opcional, no bloquea la venta)',
    );
  });

  it('el recojo solo pide nombre y celular', () => {
    expect(datosQuePedir('RECOJO')).toHaveLength(2);
  });
});
