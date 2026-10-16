/**
 * Cómo escribe la gente su distrito, y cómo lo escribe el modelo.
 *
 * El caso que destapó esto: el modelo guardó el destino como "Commas", con
 * dos emes. Como la zona se buscaba por texto exacto, no encontró nada y el
 * pedido cayó a la zona por defecto —provincia—. Al cliente se le dijo que su
 * envío salía por agencia en 2 a 4 días con 50% de adelanto, cuando a Comas
 * se llega con reparto propio y pago contraentrega. El dueño lo leyó y
 * concluyó "no lee el prompt completo"; el prompt estaba bien, lo que fallaba
 * era una comparación de cadenas.
 *
 * Equivocarse de zona no es un detalle: cambia la tarifa, cambia la forma de
 * pago y cambia qué datos se le piden. Y se descubre tarde, con el repartidor
 * ya en la calle o con la plata del adelanto ya cobrada.
 *
 * Por eso esta suite es larga. Cubre cuatro frentes:
 *   1. lo que ya andaba, para que siga andando;
 *   2. las abreviaturas y la jerga de Lima;
 *   3. los errores de tipeo, incluidos los del propio modelo;
 *   4. y —lo que más importa— lo que NO debe reconocerse, porque un falso
 *      positivo acá le cobra mal a un cliente real.
 */
import {
  resolverDestino,
  CONFIG_ENVIO_HIERBA_SANA,
  type DestinoResuelto,
} from './envio-zonas';

const resolver = (texto: string) =>
  resolverDestino(texto, CONFIG_ENVIO_HIERBA_SANA);

/** El lugar reconocido, o una etiqueta de lo que pasó. */
const lugarDe = (texto: string): string => {
  const r = resolver(texto);
  if (r === 'ambiguo') return 'AMBIGUO';
  if (!r) return 'NADA';
  return r.lugar ?? `POR-DEFECTO:${r.zona.nombre}`;
};

const zonaDe = (texto: string): string => {
  const r = resolver(texto);
  return r === 'ambiguo' || !r ? 'AMBIGUO' : r.zona.nombre;
};

describe('lo que ya funcionaba sigue funcionando', () => {
  const exactos: [string, string][] = [
    ['Comas', 'Comas'],
    ['comas', 'Comas'],
    ['COMAS', 'Comas'],
    ['estoy en Comas', 'Comas'],
    ['San Juan de Lurigancho', 'San Juan de Lurigancho'],
    ['SJL', 'San Juan de Lurigancho'],
    ['SJM', 'San Juan de Miraflores'],
    ['Los Olivos', 'Los Olivos'],
    ['Carabayllo', 'Carabayllo'],
    ['Puente Piedra', 'Puente Piedra'],
    ['Villa El Salvador', 'Villa El Salvador'],
    ['Callao', 'Callao'],
    ['Surco', 'Santiago de Surco'],
    ['Vitarte', 'Ate'],
  ];
  it.each(exactos)('%s → %s', (texto, esperado) => {
    expect(lugarDe(texto)).toBe(esperado);
    expect(resolver(texto)).not.toHaveProperty('aproximado', true);
  });
});

describe('abreviaturas y jerga', () => {
  // Las que nombró el dueño: "a veces el cliente indica la victoria, la viki,
  // SJM, SJL, crbayllo, etc".
  const jerga: [string, string][] = [
    ['la viki', 'La Victoria'],
    ['La Vikis', 'La Victoria'],
    ['estoy por gamarra', 'La Victoria'],
    ['indepe', 'Independencia'],
    ['olivos', 'Los Olivos'],
    ['vivo en el agustino', 'El Agustino'],
    ['villa maria', 'Villa María del Triunfo'],
    ['canto grande', 'San Juan de Lurigancho'],
    ['pamplona', 'San Juan de Miraflores'],
    ['chacarilla', 'Santiago de Surco'],
    ['centro de lima', 'Cercado de Lima'],
    ['magdalena', 'Magdalena del Mar'],
  ];
  it.each(jerga)('%s → %s', (texto, esperado) => {
    expect(lugarDe(texto)).toBe(esperado);
  });
});

describe('errores de tipeo', () => {
  // El primero es el que ocurrió de verdad en producción.
  const typos: [string, string][] = [
    ['Commas', 'Comas'],
    ['comass', 'Comas'],
    ['komas', 'Comas'],
    ['crbayllo', 'Carabayllo'],
    ['carabaillo', 'Carabayllo'],
    ['carabayo', 'Carabayllo'],
    ['miraflorez', 'Miraflores'],
    ['chorillos', 'Chorrillos'],
    ['ventanila', 'Ventanilla'],
    ['independencía', 'Independencia'],
    ['puente piedra', 'Puente Piedra'],
    ['pueblo libre', 'Pueblo Libre'],
    ['santa anita', 'Santa Anita'],
    ['jesus maria', 'Jesús María'],
    ['brena', 'Breña'],
  ];
  it.each(typos)('%s → %s', (texto, esperado) => {
    expect(lugarDe(texto)).toBe(esperado);
  });

  it('avisa cuando tuvo que corregir, para que se le confirme al cliente', () => {
    const r = resolver('Commas') as DestinoResuelto;
    expect(r.lugar).toBe('Comas');
    expect(r.aproximado).toBe(true);
  });

  it('lo que vino bien escrito NO se marca como corregido', () => {
    const r = resolver('Comas') as DestinoResuelto;
    expect(r.aproximado).toBeUndefined();
  });

  it('un typo dentro de una frase también se reconoce', () => {
    expect(lugarDe('hola, estoy por commas me lo traen?')).toBe('Comas');
  });
});

describe('lo que NO debe reconocerse', () => {
  /**
   * El frente peligroso. Un falso positivo acá le cobra S/ 15 de delivery a
   * alguien de provincia, o le pide 50% de adelanto a alguien de Lima.
   */
  const provincias = [
    'Barranca',   // a una letra de Barranco, y es provincia
    'Trujillo',
    'Arequipa',
    'Chiclayo',
    'Piura',
    'Cusco',
    'Huancayo',
    'Tacna',
    'Iquitos',
    'Chimbote',
    'Juliaca',
    'Pucallpa',
    'Ayacucho',
    'Cajamarca',
    'Huaraz',
    'Tarapoto',
    'Moquegua',
    'Tumbes',
    'Puno',
    'Ica',
  ];
  // Lo que importa es la ZONA —define tarifa, forma de pago y qué datos se
  // piden—, no si la ciudad está nombrada en la configuración. Nombrarlas es
  // lo que evita que un parecido se las lleve a Lima.
  it.each(provincias)('%s cae en Provincia, no en Lima', (ciudad) => {
    expect(zonaDe(ciudad)).toBe('Provincia');
  });

  it('una ciudad que nadie nombró igual cae en Provincia', () => {
    expect(lugarDe('Bagua Grande')).toBe('POR-DEFECTO:Provincia');
    expect(zonaDe('Bagua Grande')).toBe('Provincia');
  });

  it('Barranca no se confunde con Barranco aunque esté a una letra', () => {
    expect(zonaDe('Barranca')).toBe('Provincia');
    expect(lugarDe('Barranco')).toBe('Barranco');
  });

  /**
   * Las siglas cortas NO se corrigen. "SJM" y "SJL" se diferencian en una
   * sola letra y están en extremos opuestos de Lima: adivinar entre las dos
   * manda el pedido al otro lado de la ciudad.
   */
  const siglas: [string, string][] = [
    ['SJM', 'San Juan de Miraflores'],
    ['SJL', 'San Juan de Lurigancho'],
    ['VES', 'Villa El Salvador'],
    ['VMT', 'Villa María del Triunfo'],
    ['SMP', 'San Martín de Porres'],
  ];
  it.each(siglas)('%s se lee tal cual: %s', (texto, esperado) => {
    expect(lugarDe(texto)).toBe(esperado);
  });

  it('una sigla mal escrita NO se adivina: cae a la zona por defecto', () => {
    // "SJN" no es nada. Antes de inventar entre SJM y SJL, que vaya al
    // camino por defecto y el agente pregunte.
    expect(lugarDe('SJN')).toBe('POR-DEFECTO:Provincia');
  });

  it('texto vacío o basura no inventa un destino', () => {
    expect(resolver('')).toBeNull();
    expect(resolver('   ')).toBeNull();
    expect(lugarDe('asdkjhaskjdh')).toBe('POR-DEFECTO:Provincia');
  });
});

describe('la zona manda sobre la tarifa y la forma de pago', () => {
  it('Comas es reparto propio con contraentrega, no agencia', () => {
    const r = resolver('Comas') as DestinoResuelto;
    expect(r.zona.nombre).toBe('Lima');
    expect(r.zona.tipo).toBe('DOMICILIO');
    expect(r.zona.tarifa).toBe(15);
    expect(r.zona.notaPago ?? '').not.toMatch(/50%/);
  });

  it('y escrito mal, lo mismo: es el error que se vio en producción', () => {
    const r = resolver('Commas') as DestinoResuelto;
    expect(r.zona.nombre).toBe('Lima');
    expect(r.zona.tarifa).toBe(15);
  });

  it('una ciudad de provincia sí sale por agencia con 50%', () => {
    const r = resolver('Trujillo') as DestinoResuelto;
    expect(r.zona.nombre).toBe('Provincia');
    expect(r.zona.tipo).toBe('AGENCIA');
    expect(r.zona.notaPago).toMatch(/50%/);
  });

  it('recoger en tienda no cobra envío', () => {
    const r = resolver('paso por la tienda') as DestinoResuelto;
    expect(r.zona.tipo).toBe('RECOJO');
    expect(r.zona.tarifa).toBe(0);
  });
});

describe('los 37 distritos de la cobertura responden Lima', () => {
  const todos = CONFIG_ENVIO_HIERBA_SANA.zonas
    .find((z) => z.nombre === 'Lima')!
    .lugares!.map((l) => l.nombre);

  it('son los que el negocio configuró', () => {
    expect(todos.length).toBeGreaterThanOrEqual(35);
  });

  it.each(todos)('%s → Lima', (distrito) => {
    expect(zonaDe(distrito)).toBe('Lima');
  });

  it.each(todos)('%s en minúsculas y sin tildes → Lima', (distrito) => {
    const plano = distrito
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
    expect(zonaDe(plano)).toBe('Lima');
  });

  it.each(todos)('%s dentro de una frase → Lima', (distrito) => {
    expect(zonaDe(`hola, me lo mandan a ${distrito} por favor?`)).toBe('Lima');
  });
});
