/**
 * Ficha técnica para rubro de VEHÍCULOS (motos, mototaxis, scooters, autos).
 *
 * A diferencia de cómputo, cada unidad vendida es única: nº de serie/VIN, nº de
 * motor, color y año identifican a ESE vehículo. Por eso el vendedor crea un
 * producto por vehículo y llena su ficha; al emitir el comprobante, estos datos
 * se anexan a la descripción del ítem (estilo tarjeta de propiedad / boleta
 * vehicular) para cumplir con la exigencia registral (SUNARP).
 */

type CampoFichaTecnica = {
  key: string;
  label: string;
  grupo: string;
  tipo: 'texto' | 'numero' | 'booleano' | 'textarea';
  unidad?: string;
  orden: number;
};

type PlantillaFichaTecnica = {
  id: null;
  nombre: string;
  descripcion: string;
  campos: CampoFichaTecnica[];
  destacados: string[];
  activo: true;
  fallback: true;
  familia: string;
};

const CAMPOS_MOTO: CampoFichaTecnica[] = [
  { key: 'marca', label: 'Marca', grupo: 'Identificación', tipo: 'texto', orden: 1 },
  { key: 'modelo', label: 'Modelo', grupo: 'Identificación', tipo: 'texto', orden: 2 },
  { key: 'serieVin', label: 'N° Serie / VIN (chasis)', grupo: 'Identificación', tipo: 'texto', orden: 3 },
  { key: 'numeroMotor', label: 'N° de Motor', grupo: 'Identificación', tipo: 'texto', orden: 4 },
  { key: 'categoria', label: 'Categoría (L3 / L5)', grupo: 'Identificación', tipo: 'texto', orden: 5 },
  { key: 'anioModelo', label: 'Año modelo / fabricación', grupo: 'Identificación', tipo: 'texto', orden: 6 },
  { key: 'color', label: 'Color', grupo: 'Identificación', tipo: 'texto', orden: 7 },
  { key: 'combustible', label: 'Combustible', grupo: 'Motor', tipo: 'texto', orden: 100 },
  { key: 'cilindrada', label: 'Cilindrada', grupo: 'Motor', tipo: 'numero', unidad: 'cc', orden: 101 },
  { key: 'numeroCilindros', label: 'N° de cilindros', grupo: 'Motor', tipo: 'numero', orden: 102 },
  { key: 'potencia', label: 'Potencia', grupo: 'Motor', tipo: 'texto', unidad: 'HP', orden: 103 },
  { key: 'transmision', label: 'Transmisión', grupo: 'Motor', tipo: 'texto', orden: 104 },
  { key: 'numeroRuedas', label: 'N° de ruedas', grupo: 'Chasis', tipo: 'numero', orden: 200 },
  { key: 'numeroPasajeros', label: 'N° de pasajeros', grupo: 'Chasis', tipo: 'numero', orden: 201 },
  { key: 'kilometraje', label: 'Kilometraje', grupo: 'Otros', tipo: 'numero', unidad: 'km', orden: 900 },
  { key: 'observaciones', label: 'Observaciones', grupo: 'Otros', tipo: 'textarea', orden: 901 },
];

const PLANTILLA_MOTOS: Omit<
  PlantillaFichaTecnica,
  'id' | 'activo' | 'fallback' | 'familia'
> = {
  nombre: 'Vehículos - Motos y mototaxis',
  descripcion:
    'Ficha para venta de motos, scooters y mototaxis. Estos datos se imprimen en la descripción del comprobante (estilo tarjeta de propiedad).',
  campos: CAMPOS_MOTO,
  destacados: ['marca', 'modelo', 'serieVin', 'cilindrada', 'anioModelo'],
};

function normalizar(value?: string | null): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function esRubroMotos(nombre?: string | null): boolean {
  const n = normalizar(nombre);
  return (
    n.includes('moto') || // moto, motos, mototaxi, motocicleta, motorizado
    n.includes('scooter') ||
    n.includes('mototaxi') ||
    n.includes('trimoto') ||
    (n.includes('vehiculo') && !n.includes('seguridad')) ||
    (n.includes('automotriz') && !n.includes('repuesto'))
  );
}

export function obtenerPlantillaMotos(): PlantillaFichaTecnica {
  return {
    id: null,
    ...PLANTILLA_MOTOS,
    activo: true,
    fallback: true,
    familia: 'motos',
  };
}

// Etiquetas cortas (estilo boleta vehicular) y orden en pares para la descripción
// del comprobante. Cada fila = [columna izquierda, columna derecha].
const ETIQUETA_CORTA: Record<string, string> = {
  marca: 'MARCA',
  modelo: 'MODELO',
  serieVin: 'SERIE/VIN',
  categoria: 'CATEGORÍA',
  numeroMotor: 'N° MOTOR',
  anioModelo: 'AÑO MOD.',
  color: 'COLOR',
  combustible: 'COMBUS.',
  cilindrada: 'CILINDRADA',
  numeroCilindros: 'CILINDROS',
  potencia: 'POT. (HP)',
  transmision: 'TRANSMISIÓN',
  numeroRuedas: 'N° RUEDAS',
  numeroPasajeros: 'PASAJEROS',
  kilometraje: 'KM',
};

const UNIDAD_CORTA: Record<string, string> = {
  cilindrada: 'cc',
  kilometraje: 'km',
};

const FILAS_DESCRIPCION: Array<[string, string?]> = [
  ['marca', 'modelo'],
  ['serieVin', 'categoria'],
  ['numeroMotor', 'anioModelo'],
  ['color', 'combustible'],
  ['cilindrada', 'numeroCilindros'],
  ['potencia', 'transmision'],
  ['numeroRuedas', 'numeroPasajeros'],
];

// Claves que SOLO existen en fichas de vehículo. Sirven para distinguir de la
// ficha de cómputo (que también usa marca/modelo/color).
const CLAVES_EXCLUSIVAS_VEHICULO = [
  'serieVin',
  'numeroMotor',
  'cilindrada',
  'numeroRuedas',
  'numeroPasajeros',
];

export function esFichaVehiculo(
  atributos?: Record<string, any> | null,
): boolean {
  if (!atributos || typeof atributos !== 'object') return false;
  return CLAVES_EXCLUSIVAS_VEHICULO.some((k) => {
    const v = atributos[k];
    return v != null && String(v).trim() !== '';
  });
}

function celda(atributos: Record<string, any>, key?: string): string | null {
  if (!key) return null;
  const raw = atributos[key];
  if (raw == null || String(raw).trim() === '') return null;
  const valor = String(raw).trim();
  const unidad = UNIDAD_CORTA[key];
  const yaTieneUnidad =
    unidad && valor.toLowerCase().includes(unidad.toLowerCase());
  const texto = unidad && !yaTieneUnidad ? `${valor} ${unidad}` : valor;
  return `${ETIQUETA_CORTA[key] || key.toUpperCase()}: ${texto}`;
}

/**
 * Anexa el bloque de especificaciones del vehículo a la descripción del ítem,
 * en dos columnas (estilo boleta vehicular). El resultado usa saltos de línea:
 * nuestras plantillas de impresión lo muestran tal cual; al enviar a SUNAT los
 * saltos se colapsan en espacios (limpiarTexto), lo cual es válido.
 *
 * @param nombre  Nombre/descripción base del producto (primera línea).
 * @param atributos  atributosTecnicos del producto.
 */
export function construirDescripcionVehiculo(
  nombre: string,
  atributos?: Record<string, any> | null,
): string {
  const base = String(nombre || '').trim();
  if (!esFichaVehiculo(atributos)) return base;
  const attrs = atributos as Record<string, any>;

  const filas: string[] = [];
  const SEP = '  ·  '; // separa las dos columnas del par (misma fuente, sin monoespaciado)

  for (const [izqKey, derKey] of FILAS_DESCRIPCION) {
    const izq = celda(attrs, izqKey);
    const der = celda(attrs, derKey);
    if (!izq && !der) continue;
    if (izq && der) {
      filas.push(`${izq}${SEP}${der}`);
    } else {
      filas.push((izq || der) as string);
    }
  }

  if (filas.length === 0) return base;
  return base ? `${base}\n${filas.join('\n')}` : filas.join('\n');
}
