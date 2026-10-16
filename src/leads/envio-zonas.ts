/**
 * C1 — a dónde se entrega, cuánto cuesta y qué datos hacen falta.
 *
 * Esto es CONFIGURACIÓN por empresa, no código. Los 37 distritos de Lima y las
 * tarifas de S/ 15 y S/ 10 son de Hierba Sana; el siguiente cliente tendrá
 * otra cobertura y otros precios, y no puede costar una línea de código. Por
 * eso las zonas son datos y aquí solo vive la lógica de clasificar.
 *
 * La clasificación importa más de lo que parece: define la tarifa, la forma de
 * pago y qué datos se le piden al cliente. Equivocarse de zona es cobrarle mal
 * y pedirle los datos que no son.
 */

/** Cómo se despacha una zona. Condiciona qué datos se piden. */
export type TipoZona = 'DOMICILIO' | 'AGENCIA' | 'RECOJO';

export interface LugarZona {
  /** Nombre oficial, el que se registra en el pedido. */
  nombre: string;
  /** Como lo escribe la gente: "SJL", "Vitarte", "Canto Grande". */
  alias?: string[];
}

export interface ZonaEnvio {
  /** Nombre que se le dice al cliente: "Lima", "Provincia". */
  nombre: string;
  tipo: TipoZona;
  /** Costo del envío en soles. */
  tarifa: number;
  /** Lugares que caen en esta zona. Vacío = solo se llega por defecto. */
  lugares?: LugarZona[];
  /** Lo que la IA le dice al cliente sobre cómo se paga en esta zona. */
  notaPago?: string;
  /**
   * Con qué courier sale esta zona: SHALOM_PRO, SHALOM_COD, OLVA, URBANO,
   * CRUZ_SUR, PROPIOS u OTRO.
   *
   * Va en la configuración y no en el código porque cada empresa trabaja con
   * los suyos. Sin esto, el despacho que crea la IA quedaba sin courier y el
   * botón "Coordinar envío" del panel arrancaba en blanco.
   */
  courier?: string;
}

export interface ConfigEnvio {
  zonas: ZonaEnvio[];
  /** Zona que aplica cuando el destino no está en ninguna lista. */
  zonaPorDefecto: string;
}

const lima = (nombre: string, ...alias: string[]): LugarZona => ({
  nombre,
  ...(alias.length ? { alias } : {}),
});

/**
 * La configuración de Hierba Sana, de su prompt (AGENTE_01.txt, bloque 7) y su
 * base de conocimiento. Es el DEFAULT, no una constante del sistema: cada
 * empresa guarda la suya.
 */
/**
 * Sin zonas: la empresa no configuró su reparto.
 *
 * Es el defecto, y es a propósito que no tenga tarifas. Con las de Hierba
 * Sana de relleno, cualquier otra empresa que encendiera la IA le cotizaba a
 * sus clientes "S/ 15 a domicilio en Lima" y "S/ 10 por agencia" con los 37
 * distritos de otro negocio — precios que su dueño nunca fijó.
 *
 * El flujo lo detecta y deriva a una persona en vez de inventar un monto.
 */
export const SIN_CONFIG_ENVIO: ConfigEnvio = { zonas: [], zonaPorDefecto: '' };

/** ¿La empresa tiene su reparto configurado? */
export function tieneEnvioConfigurado(config?: ConfigEnvio | null): boolean {
  return (config?.zonas?.length ?? 0) > 0;
}

export const CONFIG_ENVIO_HIERBA_SANA: ConfigEnvio = {
  zonaPorDefecto: 'Provincia',
  zonas: [
    {
      nombre: 'Lima',
      tipo: 'DOMICILIO',
      tarifa: 15,
      courier: 'PROPIOS',
      notaPago: 'el pago es contraentrega',
      lugares: [
        lima('La Victoria', 'La Viki', 'La Vikis', 'Gamarra'),
        lima('Cercado de Lima', 'Cercado', 'Centro de Lima', 'Lima Cercado'),
        lima('Lince'),
        lima('Jesús María', 'JM'),
        lima('Breña', 'Brena'),
        lima('Pueblo Libre', 'Magdalena Vieja'),
        lima('Magdalena del Mar', 'Magdalena'),
        lima('San Miguel'),
        lima('San Isidro'),
        lima('Miraflores'),
        lima('Surquillo'),
        lima('San Borja'),
        lima('Santiago de Surco', 'Surco', 'Chacarilla', 'Monterrico', 'Higuereta'),
        lima('Barranco'),
        lima('El Agustino', 'Agustino'),
        lima('Santa Anita'),
        lima('San Juan de Lurigancho', 'SJL', 'Canto Grande', 'Zárate', 'San Juan Lurigancho', 'Lurigancho'),
        lima('Ate', 'Ate Vitarte', 'Vitarte'),
        lima('La Molina'),
        lima('Chorrillos'),
        lima('San Juan de Miraflores', 'SJM', 'Pamplona', 'San Juan Miraflores'),
        lima('Villa María del Triunfo', 'VMT', 'Villa María', 'Villa Maria'),
        lima('Villa El Salvador', 'VES'),
        lima('Lurín'),
        lima('Pachacámac'),
        lima('San Martín de Porres', 'SMP', 'San Martin', 'Zona Pro'),
        lima('Independencia', 'Indepe'),
        lima('Los Olivos', 'Olivos'),
        lima('Comas'),
        lima('Carabayllo'),
        lima('Puente Piedra', 'Puente'),
        lima('Callao', 'Provincia Constitucional del Callao'),
        lima('Bellavista'),
        lima('Carmen de la Legua Reynoso', 'Carmen de la Legua'),
        lima('La Perla', 'La Perla Callao'),
        lima('La Punta', 'La Punta Callao'),
        lima('Ventanilla', 'Ventanilla Callao'),
      ],
    },
    {
      nombre: 'Provincia',
      tipo: 'AGENCIA',
      tarifa: 10,
      courier: 'SHALOM_PRO',
      notaPago:
        'pagas el 50% para reservar y el resto cuando tu pedido llegue a la agencia de destino',
      /**
       * No hace falta nombrarlas para que funcionen —lo que no se reconoce
       * cae acá igual— pero sí para que no las confunda un parecido: las de
       * la costa cercana son las que más se parecen a un distrito de Lima.
       * "Barranca" está a una letra de "Barranco".
       */
      lugares: [
        { nombre: 'Barranca' },
        { nombre: 'Huaral' },
        { nombre: 'Huacho' },
        { nombre: 'Chancay' },
        { nombre: 'Cañete', alias: ['San Vicente de Cañete'] },
        { nombre: 'Huaura' },
        { nombre: 'Trujillo' },
        { nombre: 'Arequipa' },
        { nombre: 'Chiclayo' },
        { nombre: 'Piura' },
        { nombre: 'Cusco', alias: ['Cuzco'] },
        { nombre: 'Huancayo' },
        { nombre: 'Tacna' },
        { nombre: 'Iquitos' },
        { nombre: 'Chimbote' },
        { nombre: 'Juliaca' },
        { nombre: 'Pucallpa' },
        { nombre: 'Ayacucho' },
        { nombre: 'Cajamarca' },
        { nombre: 'Huaraz' },
        { nombre: 'Tarapoto' },
        { nombre: 'Moquegua' },
        { nombre: 'Tumbes' },
        { nombre: 'Puno' },
        { nombre: 'Ica' },
        { nombre: 'Pisco' },
        { nombre: 'Chincha' },
        { nombre: 'Nazca', alias: ['Nasca'] },
        { nombre: 'Jaén' },
        { nombre: 'Sullana' },
        { nombre: 'Talara' },
        { nombre: 'Tarma' },
        { nombre: 'Huánuco' },
        { nombre: 'Abancay' },
        { nombre: 'Huancavelica' },
        { nombre: 'Cerro de Pasco', alias: ['Pasco'] },
        { nombre: 'Moyobamba' },
        { nombre: 'Puerto Maldonado' },
        { nombre: 'Ilo' },
        { nombre: 'Yurimaguas' },
      ],
    },
    {
      nombre: 'Recojo en tienda',
      tipo: 'RECOJO',
      tarifa: 0,
      lugares: [
        {
          nombre: 'Recojo en tienda',
          alias: ['recojo', 'recoger', 'paso por la tienda'],
        },
      ],
    },
  ],
};

export interface DestinoResuelto {
  zona: ZonaEnvio;
  /** Nombre oficial del lugar reconocido; null si se cayó a la zona por defecto. */
  lugar: string | null;
  /**
   * El lugar se reconoció corrigiendo cómo venía escrito ("Commas" → "Comas").
   *
   * Importa decirlo: equivocarse de zona cambia la tarifa y la forma de pago,
   * así que una corrección se le confirma al cliente en vez de darla por
   * buena en silencio.
   */
  aproximado?: boolean;
}

/** Sin tildes, sin mayúsculas, sin puntuación: como lo escribe la gente. */
function normalizar(texto: string): string {
  return (texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿Aparece `aguja` como frase completa dentro de `pajar`? */
function contieneFrase(pajar: string, aguja: string): boolean {
  if (!aguja) return false;
  const i = pajar.indexOf(aguja);
  if (i === -1) return false;
  const antes = i === 0 ? ' ' : pajar[i - 1];
  const despues =
    i + aguja.length >= pajar.length ? ' ' : pajar[i + aguja.length];
  return antes === ' ' && despues === ' ';
}

/**
 * Distancia de edición, con tope: cuántos retoques separan dos palabras.
 *
 * Se corta apenas se pasa de `tope` porque no interesa cuán lejos están dos
 * nombres distintos, solo si están lo bastante cerca.
 */
function distancia(a: string, b: string, tope: number): number {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  let previa = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    let mejorDeLaFila = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      fila[j] = Math.min(fila[j - 1] + 1, previa[j] + 1, previa[j - 1] + costo);
      mejorDeLaFila = Math.min(mejorDeLaFila, fila[j]);
    }
    if (mejorDeLaFila > tope) return tope + 1;
    previa = fila;
  }
  return previa[b.length];
}

/**
 * Cuánto error se le perdona a un nombre.
 *
 * Nada por debajo de 6 letras: "SJM" y "SJL" se diferencian en una sola, y
 * confundirlos manda el pedido al otro extremo de Lima. De 6 a 9, un retoque
 * ("Commas" → "Comas"). De 10 para arriba, dos ("crbayllo" → "Carabayllo").
 *
 * El tope se mantiene corto a propósito. Con uno más generoso, "Barranca"
 * —que es provincia— pasaría por "Barranco" y el cliente terminaría pagando
 * S/ 15 de delivery por un envío que sale por agencia.
 */
function toleranciaDe(nombre: string): number {
  // Hasta 4 letras no se corrige nada: ahí viven las siglas (SJM, SJL, VES,
  // VMT, SMP) y "Ate". Entre SJM y SJL hay una sola letra y media ciudad de
  // distancia; adivinar manda el pedido al otro extremo de Lima.
  if (nombre.length <= 4) return 0;
  return nombre.length >= 10 ? 2 : 1;
}

/** Las frases de 1 a `max` palabras que se pueden formar con el texto. */
function fragmentos(texto: string, max: number): string[] {
  const palabras = texto.split(' ').filter(Boolean);
  const salida: string[] = [];
  for (let n = 1; n <= max; n++) {
    for (let i = 0; i + n <= palabras.length; i++) {
      salida.push(palabras.slice(i, i + n).join(' '));
    }
  }
  return salida;
}

/**
 * A qué zona pertenece lo que escribió el cliente.
 *
 * Devuelve `'ambiguo'` cuando el texto encaja en zonas distintas: el flujo del
 * cliente es explícito en que ahí hay que preguntar antes de calcular el
 * envío, no adivinar. Cobrar S/ 15 por algo que va a provincia, o al revés,
 * es un error que se descubre tarde.
 */
export function resolverDestino(
  texto: string,
  config: ConfigEnvio = CONFIG_ENVIO_HIERBA_SANA,
): DestinoResuelto | 'ambiguo' | null {
  const limpio = normalizar(texto);
  if (!limpio) return null;

  // Todas las coincidencias, con su longitud: "San Juan de Lurigancho" tiene
  // que ganarle a "San Juan" si ambos estuvieran.
  const encontrados: { zona: ZonaEnvio; lugar: string; largo: number }[] = [];
  for (const zona of config.zonas) {
    for (const lugar of zona.lugares ?? []) {
      for (const nombre of [lugar.nombre, ...(lugar.alias ?? [])]) {
        const n = normalizar(nombre);
        if (contieneFrase(limpio, n)) {
          encontrados.push({ zona, lugar: lugar.nombre, largo: n.length });
        }
      }
    }
  }

  // Nada exacto: recién ahí se intenta con lo que está mal escrito. En ese
  // orden y no al revés — un nombre que encaja tal cual nunca debe perder
  // contra el parecido de otro.
  //
  // Es el caso que se vio en producción: el modelo guardó "Commas" y el
  // pedido se clasificó como provincia. Al cliente se le dijo que su envío
  // salía por agencia en 2 a 4 días con 50% de adelanto, cuando a Comas se
  // llega con reparto propio y pago contraentrega.
  if (encontrados.length === 0) {
    const aprox: { zona: ZonaEnvio; lugar: string; error: number }[] = [];
    const maxPalabras = Math.max(
      1,
      ...config.zonas.flatMap((z) =>
        (z.lugares ?? []).flatMap((l) =>
          [l.nombre, ...(l.alias ?? [])].map(
            (n) => normalizar(n).split(' ').length,
          ),
        ),
      ),
    );
    const trozos = fragmentos(limpio, maxPalabras);
    for (const zona of config.zonas) {
      for (const lugar of zona.lugares ?? []) {
        for (const nombre of [lugar.nombre, ...(lugar.alias ?? [])]) {
          const n = normalizar(nombre);
          const tope = toleranciaDe(n);
          if (tope === 0) continue;
          for (const trozo of trozos) {
            const d = distancia(trozo, n, tope);
            if (d <= tope) aprox.push({ zona, lugar: lugar.nombre, error: d });
          }
        }
      }
    }

    if (aprox.length > 0) {
      aprox.sort((a, b) => a.error - b.error);
      const mejorAprox = aprox[0];
      const rivales = aprox.filter(
        (e) =>
          e.error === mejorAprox.error &&
          e.zona.nombre !== mejorAprox.zona.nombre,
      );
      // Dos zonas igual de parecidas: preguntar sale mucho más barato que
      // acertar a medias.
      if (rivales.length > 0) return 'ambiguo';
      return {
        zona: mejorAprox.zona,
        lugar: mejorAprox.lugar,
        aproximado: true,
      };
    }

    const porDefecto = config.zonas.find(
      (z) => z.nombre === config.zonaPorDefecto,
    );
    return porDefecto ? { zona: porDefecto, lugar: null } : null;
  }

  encontrados.sort((a, b) => b.largo - a.largo);
  const mejor = encontrados[0];
  // Empate de longitud entre zonas distintas: no se adivina.
  const rivales = encontrados.filter(
    (e) => e.largo === mejor.largo && e.zona.nombre !== mejor.zona.nombre,
  );
  if (rivales.length > 0) return 'ambiguo';

  return { zona: mejor.zona, lugar: mejor.lugar };
}

/** Los datos que hay que pedirle al cliente, en orden, según la zona. */
export function datosQuePedir(tipo: TipoZona): string[] {
  switch (tipo) {
    case 'DOMICILIO':
      return [
        'nombre completo',
        'dirección con calle y número',
        'referencia',
        'horario de entrega',
        'DNI (opcional, no bloquea la venta)',
        'celular de contacto',
      ];
    case 'AGENCIA':
      return [
        'nombre completo',
        'DNI',
        'destino (distrito y región)',
        'sede de la agencia',
        'celular de contacto',
      ];
    case 'RECOJO':
      return ['nombre completo', 'celular de contacto'];
  }
}
