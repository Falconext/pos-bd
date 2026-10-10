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
export const CONFIG_ENVIO_HIERBA_SANA: ConfigEnvio = {
  zonaPorDefecto: 'Provincia',
  zonas: [
    {
      nombre: 'Lima',
      tipo: 'DOMICILIO',
      tarifa: 15,
      notaPago: 'el pago es contraentrega',
      lugares: [
        lima('La Victoria'),
        lima('Cercado de Lima', 'Cercado', 'Centro de Lima', 'Lima Cercado'),
        lima('Lince'),
        lima('Jesús María', 'JM'),
        lima('Breña'),
        lima('Pueblo Libre', 'Magdalena Vieja'),
        lima('Magdalena del Mar', 'Magdalena'),
        lima('San Miguel'),
        lima('San Isidro'),
        lima('Miraflores'),
        lima('Surquillo'),
        lima('San Borja'),
        lima('Santiago de Surco', 'Surco', 'Chacarilla', 'Monterrico'),
        lima('Barranco'),
        lima('El Agustino'),
        lima('Santa Anita'),
        lima('San Juan de Lurigancho', 'SJL', 'Canto Grande', 'Zárate'),
        lima('Ate', 'Ate Vitarte', 'Vitarte'),
        lima('La Molina'),
        lima('Chorrillos'),
        lima('San Juan de Miraflores', 'SJM', 'Pamplona'),
        lima('Villa María del Triunfo', 'VMT'),
        lima('Villa El Salvador', 'VES'),
        lima('Lurín'),
        lima('Pachacámac'),
        lima('San Martín de Porres', 'SMP'),
        lima('Independencia'),
        lima('Los Olivos'),
        lima('Comas'),
        lima('Carabayllo'),
        lima('Puente Piedra'),
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
      notaPago:
        'pagas el 50% para reservar y el resto cuando tu pedido llegue a la agencia de destino',
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

  if (encontrados.length === 0) {
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
