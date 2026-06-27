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

const GENERAL: CampoFichaTecnica[] = [
  { key: 'fabricante', label: 'Fabricante', grupo: 'Características principales', tipo: 'texto', orden: 1 },
  { key: 'marca', label: 'Marca', grupo: 'Características principales', tipo: 'texto', orden: 2 },
  { key: 'linea', label: 'Línea', grupo: 'Características principales', tipo: 'texto', orden: 3 },
  { key: 'modelo', label: 'Modelo', grupo: 'Características principales', tipo: 'texto', orden: 4 },
  { key: 'modeloAlfanumerico', label: 'Modelo alfanumérico', grupo: 'Características principales', tipo: 'texto', orden: 5 },
  { key: 'color', label: 'Color', grupo: 'Características principales', tipo: 'texto', orden: 6 },
  { key: 'garantiaMeses', label: 'Garantía', grupo: 'Garantía', tipo: 'numero', unidad: 'meses', orden: 900 },
  { key: 'accesoriosIncluidos', label: 'Accesorios incluidos', grupo: 'Otros', tipo: 'textarea', orden: 910 },
];

const DIMENSIONES: CampoFichaTecnica[] = [
  { key: 'largo', label: 'Largo', grupo: 'Peso y dimensiones', tipo: 'numero', unidad: 'cm', orden: 800 },
  { key: 'ancho', label: 'Ancho', grupo: 'Peso y dimensiones', tipo: 'numero', unidad: 'cm', orden: 801 },
  { key: 'altura', label: 'Altura', grupo: 'Peso y dimensiones', tipo: 'numero', unidad: 'cm', orden: 802 },
  { key: 'peso', label: 'Peso', grupo: 'Peso y dimensiones', tipo: 'numero', unidad: 'g', orden: 803 },
];

const PLANTILLAS_COMPUTO: Record<string, Omit<PlantillaFichaTecnica, 'id' | 'activo' | 'fallback' | 'familia'>> = {
  audifonos: {
    nombre: 'Cómputo - Audífonos, headset y parlantes',
    descripcion: 'Ficha para audífonos, headsets, parlantes, micrófonos y accesorios de audio.',
    campos: [
      ...GENERAL,
      { key: 'formatoAuricular', label: 'Formato del auricular', grupo: 'Especificaciones', tipo: 'texto', orden: 100 },
      { key: 'esMonoaural', label: 'Es monoaural', grupo: 'Especificaciones', tipo: 'booleano', orden: 101 },
      { key: 'conLuzLed', label: 'Con luz LED', grupo: 'Especificaciones', tipo: 'booleano', orden: 102 },
      { key: 'esInalambrico', label: 'Es inalámbrico', grupo: 'Conectividad', tipo: 'booleano', orden: 200 },
      { key: 'bluetooth', label: 'Con Bluetooth', grupo: 'Conectividad', tipo: 'booleano', orden: 201 },
      { key: 'versionBluetooth', label: 'Versión de Bluetooth', grupo: 'Conectividad', tipo: 'texto', orden: 202 },
      { key: 'alcanceInalambrico', label: 'Alcance inalámbrico', grupo: 'Conectividad', tipo: 'numero', unidad: 'm', orden: 203 },
      { key: 'tecnologiaTws', label: 'Con tecnología TWS', grupo: 'Conectividad', tipo: 'booleano', orden: 204 },
      { key: 'tiposConectores', label: 'Tipos de conectores', grupo: 'Conectividad', tipo: 'textarea', orden: 205 },
      { key: 'conMicrofono', label: 'Con micrófono', grupo: 'Micrófono', tipo: 'booleano', orden: 300 },
      { key: 'modoManosLibres', label: 'Con modo manos libres', grupo: 'Micrófono', tipo: 'booleano', orden: 301 },
      { key: 'microfonoDesmontable', label: 'Con micrófono desmontable', grupo: 'Micrófono', tipo: 'booleano', orden: 302 },
      { key: 'microfonoFlexible', label: 'Con micrófono flexible', grupo: 'Micrófono', tipo: 'booleano', orden: 303 },
      { key: 'orientacionMicrofono', label: 'Orientación del micrófono', grupo: 'Micrófono', tipo: 'texto', orden: 304 },
      { key: 'unidadDiafragma', label: 'Unidad de diafragma', grupo: 'Sonido', tipo: 'numero', unidad: 'mm', orden: 400 },
      { key: 'respuestaFrecuencia', label: 'Respuesta en frecuencia', grupo: 'Sonido', tipo: 'texto', orden: 401 },
      { key: 'sensibilidad', label: 'Sensibilidad', grupo: 'Sonido', tipo: 'texto', orden: 402 },
      { key: 'cancelacionRuido', label: 'Con cancelación de ruido', grupo: 'Sonido', tipo: 'booleano', orden: 403 },
      { key: 'duracionBateria', label: 'Duración máxima de la batería', grupo: 'Batería', tipo: 'numero', unidad: 'h', orden: 500 },
      { key: 'capacidadBateriaAuricular', label: 'Capacidad de batería del auricular', grupo: 'Batería', tipo: 'numero', unidad: 'mAh', orden: 501 },
      { key: 'capacidadBateriaEstuche', label: 'Capacidad de batería del estuche de carga', grupo: 'Batería', tipo: 'numero', unidad: 'mAh', orden: 502 },
      { key: 'incluyeEstucheCarga', label: 'Incluye estuche de carga', grupo: 'Batería', tipo: 'booleano', orden: 503 },
      { key: 'cargaInalambrica', label: 'Con carga inalámbrica', grupo: 'Batería', tipo: 'booleano', orden: 504 },
      { key: 'resistenteAgua', label: 'Es resistente al agua', grupo: 'Resistencia', tipo: 'booleano', orden: 600 },
      { key: 'pruebaAgua', label: 'Es a prueba de agua', grupo: 'Resistencia', tipo: 'booleano', orden: 601 },
      { key: 'resistentePolvo', label: 'Es resistente al polvo', grupo: 'Resistencia', tipo: 'booleano', orden: 602 },
      { key: 'clasificacionIp', label: 'Clasificación IP', grupo: 'Resistencia', tipo: 'texto', orden: 603 },
      { key: 'largoCable', label: 'Largo del cable', grupo: 'Otros', tipo: 'numero', unidad: 'm', orden: 912 },
      { key: 'cableDesmontable', label: 'Con cable desmontable', grupo: 'Otros', tipo: 'booleano', orden: 913 },
      { key: 'usosAptos', label: 'Usos aptos', grupo: 'Otros', tipo: 'textarea', orden: 914 },
      ...DIMENSIONES,
    ],
    destacados: ['esInalambrico', 'cancelacionRuido', 'conMicrofono', 'duracionBateria', 'resistenteAgua', 'conLuzLed'],
  },
  mouse: {
    nombre: 'Cómputo - Mouse',
    descripcion: 'Ficha para mouse gamer, oficina, bluetooth e inalámbricos.',
    campos: [
      ...GENERAL,
      { key: 'tipoMouse', label: 'Tipo de mouse', grupo: 'Especificaciones', tipo: 'texto', orden: 100 },
      { key: 'orientacionMano', label: 'Orientación de la mano', grupo: 'Especificaciones', tipo: 'texto', orden: 101 },
      { key: 'cantidadBotones', label: 'Cantidad de botones', grupo: 'Especificaciones', tipo: 'numero', orden: 102 },
      { key: 'esInalambrico', label: 'Es inalámbrico', grupo: 'Conectividad', tipo: 'booleano', orden: 200 },
      { key: 'bluetooth', label: 'Con Bluetooth', grupo: 'Conectividad', tipo: 'booleano', orden: 201 },
      { key: 'conCable', label: 'Con cable', grupo: 'Conectividad', tipo: 'booleano', orden: 202 },
      { key: 'tipoSensor', label: 'Tipo de sensor', grupo: 'Sensor', tipo: 'texto', orden: 300 },
      { key: 'tecnologiaSensor', label: 'Tecnología del sensor', grupo: 'Sensor', tipo: 'texto', orden: 301 },
      { key: 'resolucionSensor', label: 'Resolución del sensor', grupo: 'Sensor', tipo: 'numero', unidad: 'dpi', orden: 302 },
      { key: 'conLuces', label: 'Con luces', grupo: 'Otros', tipo: 'booleano', orden: 910 },
      ...DIMENSIONES,
    ],
    destacados: ['tipoMouse', 'tipoSensor', 'resolucionSensor', 'esInalambrico'],
  },
  teclado: {
    nombre: 'Cómputo - Teclados',
    descripcion: 'Ficha para teclados mecánicos, membrana, gamer, oficina e inalámbricos.',
    campos: [
      ...GENERAL,
      { key: 'tipoTeclado', label: 'Tipo de teclado', grupo: 'Especificaciones', tipo: 'texto', orden: 100 },
      { key: 'distribucion', label: 'Distribución', grupo: 'Especificaciones', tipo: 'texto', orden: 101 },
      { key: 'idioma', label: 'Idioma', grupo: 'Especificaciones', tipo: 'texto', orden: 102 },
      { key: 'cantidadTeclas', label: 'Cantidad de teclas', grupo: 'Especificaciones', tipo: 'numero', orden: 103 },
      { key: 'tipoSwitch', label: 'Tipo de switch', grupo: 'Switches', tipo: 'texto', orden: 200 },
      { key: 'switchColor', label: 'Color de switch', grupo: 'Switches', tipo: 'texto', orden: 201 },
      { key: 'esInalambrico', label: 'Es inalámbrico', grupo: 'Conectividad', tipo: 'booleano', orden: 300 },
      { key: 'bluetooth', label: 'Con Bluetooth', grupo: 'Conectividad', tipo: 'booleano', orden: 301 },
      { key: 'tipoConexion', label: 'Tipo de conexión', grupo: 'Conectividad', tipo: 'texto', orden: 302 },
      { key: 'retroiluminado', label: 'Retroiluminado', grupo: 'Iluminación', tipo: 'booleano', orden: 400 },
      { key: 'iluminacionRgb', label: 'Iluminación RGB', grupo: 'Iluminación', tipo: 'booleano', orden: 401 },
      { key: 'resistenteAgua', label: 'Resistente al agua', grupo: 'Resistencia', tipo: 'booleano', orden: 500 },
      ...DIMENSIONES,
    ],
    destacados: ['tipoTeclado', 'tipoSwitch', 'esInalambrico', 'retroiluminado'],
  },
  almacenamiento: {
    nombre: 'Cómputo - Almacenamiento',
    descripcion: 'Ficha para SSD, HDD, memorias USB, microSD, discos externos y almacenamiento.',
    campos: [
      ...GENERAL,
      { key: 'tipoAlmacenamiento', label: 'Tipo de almacenamiento', grupo: 'Especificaciones', tipo: 'texto', orden: 100 },
      { key: 'capacidad', label: 'Capacidad', grupo: 'Especificaciones', tipo: 'texto', orden: 101 },
      { key: 'formato', label: 'Formato', grupo: 'Especificaciones', tipo: 'texto', orden: 102 },
      { key: 'interfaz', label: 'Interfaz', grupo: 'Conectividad', tipo: 'texto', orden: 200 },
      { key: 'protocolo', label: 'Protocolo', grupo: 'Conectividad', tipo: 'texto', orden: 201 },
      { key: 'velocidadLectura', label: 'Velocidad de lectura', grupo: 'Rendimiento', tipo: 'numero', unidad: 'MB/s', orden: 300 },
      { key: 'velocidadEscritura', label: 'Velocidad de escritura', grupo: 'Rendimiento', tipo: 'numero', unidad: 'MB/s', orden: 301 },
      { key: 'tipoMemoria', label: 'Tipo de memoria', grupo: 'Rendimiento', tipo: 'texto', orden: 302 },
      { key: 'compatibleCon', label: 'Compatible con', grupo: 'Compatibilidad', tipo: 'textarea', orden: 400 },
      ...DIMENSIONES,
    ],
    destacados: ['tipoAlmacenamiento', 'capacidad', 'interfaz', 'velocidadLectura'],
  },
  laptop: {
    nombre: 'Cómputo - Laptops y PCs',
    descripcion: 'Ficha para laptops, PCs, mini PC, all-in-one y equipos completos.',
    campos: [
      ...GENERAL,
      { key: 'procesador', label: 'Procesador', grupo: 'Procesador', tipo: 'texto', orden: 100 },
      { key: 'generacionProcesador', label: 'Generación del procesador', grupo: 'Procesador', tipo: 'texto', orden: 101 },
      { key: 'memoriaRam', label: 'Memoria RAM', grupo: 'Memoria', tipo: 'texto', orden: 200 },
      { key: 'tipoRam', label: 'Tipo de RAM', grupo: 'Memoria', tipo: 'texto', orden: 201 },
      { key: 'ramExpandible', label: 'RAM expandible hasta', grupo: 'Memoria', tipo: 'texto', orden: 202 },
      { key: 'almacenamiento', label: 'Almacenamiento', grupo: 'Almacenamiento', tipo: 'texto', orden: 300 },
      { key: 'tipoDisco', label: 'Tipo de disco', grupo: 'Almacenamiento', tipo: 'texto', orden: 301 },
      { key: 'almacenamientoExpandible', label: 'Almacenamiento expandible', grupo: 'Almacenamiento', tipo: 'booleano', orden: 302 },
      { key: 'pantalla', label: 'Tamaño de Pantalla', grupo: 'Pantalla', tipo: 'texto', orden: 400 },
      { key: 'resolucionPantalla', label: 'Resolución de pantalla', grupo: 'Pantalla', tipo: 'texto', orden: 401 },
      { key: 'tasaRefresco', label: 'Tasa de refresco', grupo: 'Pantalla', tipo: 'numero', unidad: 'Hz', orden: 402 },
      { key: 'tarjetaGrafica', label: 'Tarjeta gráfica', grupo: 'Gráficos', tipo: 'texto', orden: 500 },
      { key: 'sistemaOperativo', label: 'Sistema operativo', grupo: 'Software', tipo: 'texto', orden: 600 },
      { key: 'conectividad', label: 'Conectividad (Wi-Fi / Bluetooth)', grupo: 'Conectividad', tipo: 'texto', orden: 700 },
      { key: 'puertos', label: 'Puertos', grupo: 'Conectividad', tipo: 'textarea', orden: 701 },
      { key: 'camaraWeb', label: 'Cámara Web', grupo: 'Multimedia', tipo: 'texto', orden: 800 },
      { key: 'audio', label: 'Audio y Altavoces', grupo: 'Multimedia', tipo: 'texto', orden: 801 },
      { key: 'teclado', label: 'Características del teclado', grupo: 'Periféricos', tipo: 'texto', orden: 850 },
      { key: 'capacidadBateriaWh', label: 'Capacidad de batería', grupo: 'Batería', tipo: 'numero', unidad: 'Wh', orden: 900 },
      { key: 'duracionBateria', label: 'Duración de batería', grupo: 'Batería', tipo: 'numero', unidad: 'h', orden: 901 },
      ...DIMENSIONES,
    ],
    destacados: ['procesador', 'memoriaRam', 'almacenamiento', 'pantalla'],
  },
  cables: {
    nombre: 'Cómputo - Cables y adaptadores',
    descripcion: 'Ficha para cables, adaptadores, hubs, cargadores y conectividad.',
    campos: [
      ...GENERAL,
      { key: 'tipoCable', label: 'Tipo de cable/adaptador', grupo: 'Especificaciones', tipo: 'texto', orden: 100 },
      { key: 'conectorEntrada', label: 'Conector de entrada', grupo: 'Conectividad', tipo: 'texto', orden: 200 },
      { key: 'conectorSalida', label: 'Conector de salida', grupo: 'Conectividad', tipo: 'texto', orden: 201 },
      { key: 'version', label: 'Versión', grupo: 'Conectividad', tipo: 'texto', orden: 202 },
      { key: 'largoCable', label: 'Largo del cable', grupo: 'Dimensiones', tipo: 'numero', unidad: 'm', orden: 300 },
      { key: 'potenciaMaxima', label: 'Potencia máxima', grupo: 'Energía', tipo: 'numero', unidad: 'W', orden: 400 },
      { key: 'cargaRapida', label: 'Carga rápida', grupo: 'Energía', tipo: 'booleano', orden: 401 },
      { key: 'resolucionSoportada', label: 'Resolución soportada', grupo: 'Video', tipo: 'texto', orden: 500 },
      { key: 'material', label: 'Material', grupo: 'Otros', tipo: 'texto', orden: 910 },
    ],
    destacados: ['tipoCable', 'conectorEntrada', 'conectorSalida', 'largoCable'],
  },
  servicios: {
    nombre: 'Cómputo - Servicios técnicos',
    descripcion: 'Ficha para instalación, formateo, mantenimiento, diagnóstico y soporte técnico.',
    campos: [
      { key: 'tipoServicio', label: 'Tipo de servicio', grupo: 'Características del servicio', tipo: 'texto', orden: 1 },
      { key: 'modalidadServicio', label: 'Modalidad', grupo: 'Características del servicio', tipo: 'texto', orden: 2 },
      { key: 'tiempoEstimado', label: 'Tiempo estimado', grupo: 'Características del servicio', tipo: 'texto', orden: 3 },
      { key: 'incluyeDiagnostico', label: 'Incluye diagnóstico', grupo: 'Alcance', tipo: 'booleano', orden: 100 },
      { key: 'incluyeBackup', label: 'Incluye backup', grupo: 'Alcance', tipo: 'booleano', orden: 101 },
      { key: 'incluyeDrivers', label: 'Incluye instalación de drivers', grupo: 'Alcance', tipo: 'booleano', orden: 102 },
      { key: 'incluyeLimpieza', label: 'Incluye limpieza física', grupo: 'Alcance', tipo: 'booleano', orden: 103 },
      { key: 'requiereLicencia', label: 'Requiere licencia', grupo: 'Software', tipo: 'booleano', orden: 200 },
      { key: 'softwareIncluido', label: 'Software incluido', grupo: 'Software', tipo: 'textarea', orden: 201 },
      { key: 'equiposCompatibles', label: 'Equipos compatibles', grupo: 'Compatibilidad', tipo: 'textarea', orden: 300 },
      { key: 'requisitosPrevios', label: 'Requisitos previos', grupo: 'Condiciones', tipo: 'textarea', orden: 400 },
      { key: 'condicionesServicio', label: 'Condiciones del servicio', grupo: 'Condiciones', tipo: 'textarea', orden: 401 },
      { key: 'garantiaServicioDias', label: 'Garantía del servicio', grupo: 'Garantía', tipo: 'numero', unidad: 'días', orden: 500 },
    ],
    destacados: ['tipoServicio', 'modalidadServicio', 'tiempoEstimado', 'garantiaServicioDias'],
  },
  general: {
    nombre: 'Cómputo - Ficha técnica general',
    descripcion: 'Ficha genérica para accesorios y repuestos de cómputo sin familia específica.',
    campos: [
      ...GENERAL,
      { key: 'tipoProducto', label: 'Tipo de producto', grupo: 'Especificaciones', tipo: 'texto', orden: 100 },
      { key: 'partNumber', label: 'Part Number / SKU fabricante', grupo: 'Especificaciones', tipo: 'texto', orden: 101 },
      { key: 'compatibilidad', label: 'Compatibilidad', grupo: 'Compatibilidad', tipo: 'textarea', orden: 200 },
      { key: 'especificacionClave', label: 'Especificación clave', grupo: 'Especificaciones', tipo: 'textarea', orden: 300 },
      { key: 'material', label: 'Material', grupo: 'Otros', tipo: 'texto', orden: 910 },
      ...DIMENSIONES,
    ],
    destacados: ['tipoProducto', 'marca', 'modelo', 'compatibilidad'],
  },
};

const FAMILIAS: Array<{ familia: keyof typeof PLANTILLAS_COMPUTO; keywords: string[] }> = [
  { familia: 'servicios', keywords: ['servicio', 'instalacion', 'instalación', 'formateo', 'formatear', 'mantenimiento', 'diagnostico', 'diagnóstico', 'soporte', 'reparacion', 'reparación', 'limpieza', 'backup', 'driver', 'windows', 'office', 'antivirus'] },
  { familia: 'audifonos', keywords: ['audifono', 'audífono', 'auricular', 'headset', 'headphone', 'earbud', 'parlante', 'speaker', 'microfono', 'micrófono'] },
  { familia: 'mouse', keywords: ['mouse', 'raton', 'ratón', 'mause'] },
  { familia: 'teclado', keywords: ['teclado', 'keyboard', 'keycap', 'switch'] },
  { familia: 'almacenamiento', keywords: ['ssd', 'hdd', 'disco', 'kingston', 'memoria usb', 'usb ', 'pendrive', 'micro sd', 'microsd', 'sd card', 'almacenamiento', 'nvme', 'sata', 'm.2'] },
  { familia: 'laptop', keywords: ['laptop', 'notebook', 'pc ', 'computadora', 'all in one', 'aio', 'mini pc', 'monitor'] },
  { familia: 'cables', keywords: ['cable', 'adaptador', 'hub', 'hdmi', 'displayport', 'usb-c', 'usb c', 'cargador', 'fuente', 'conector'] },
];

export function esRubroComputo(nombre?: string | null) {
  return normalizar(nombre).includes('comput');
}

export function obtenerPlantillaComputo(params: { categoriaNombre?: string | null; descripcion?: string | null; tipoProducto?: string | null } = {}): PlantillaFichaTecnica {
  if (normalizar(params.tipoProducto) === 'servicio') {
    return construirPlantilla('servicios');
  }
  const haystack = normalizar(`${params.categoriaNombre || ''} ${params.descripcion || ''}`);
  const match = FAMILIAS.find(({ keywords }) => keywords.some((keyword) => haystack.includes(normalizar(keyword))));
  const familia = match?.familia || 'general';
  return construirPlantilla(familia);
}

function construirPlantilla(familia: keyof typeof PLANTILLAS_COMPUTO): PlantillaFichaTecnica {
  const plantilla = PLANTILLAS_COMPUTO[familia];
  return {
    id: null,
    ...plantilla,
    activo: true,
    fallback: true,
    familia,
  };
}

function normalizar(value?: string | null) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
