// Coordenadas aproximadas (centro urbano) de capitales de departamento, capitales
// de provincia con agencia Shalom/Olva y distritos de Lima/Callao. Se usan para
// ubicar en el mapa los destinos de envío sin llamar a un geocoder por cada
// carga; lo que no esté acá lo geocodifica el navegador y lo cachea.

export interface Coordenada {
  lat: number;
  lng: number;
}

const C = (lat: number, lng: number): Coordenada => ({ lat, lng });

/** Clave: nombre normalizado (sin tildes, mayúsculas). */
const COORDENADAS: Record<string, Coordenada> = {
  // ── Capitales de departamento ──
  CHACHAPOYAS: C(-6.2296, -77.8725),
  AMAZONAS: C(-6.2296, -77.8725),
  HUARAZ: C(-9.5278, -77.5278),
  ANCASH: C(-9.5278, -77.5278),
  ABANCAY: C(-13.6339, -72.8814),
  APURIMAC: C(-13.6339, -72.8814),
  AREQUIPA: C(-16.409, -71.5375),
  AYACUCHO: C(-13.1588, -74.2239),
  HUAMANGA: C(-13.1588, -74.2239),
  CAJAMARCA: C(-7.1638, -78.5003),
  CALLAO: C(-12.0566, -77.1181),
  CUSCO: C(-13.5319, -71.9675),
  HUANCAVELICA: C(-12.7826, -74.9764),
  HUANUCO: C(-9.9306, -76.2422),
  ICA: C(-14.0678, -75.7286),
  HUANCAYO: C(-12.0651, -75.2049),
  JUNIN: C(-12.0651, -75.2049),
  TRUJILLO: C(-8.1116, -79.0288),
  'LA LIBERTAD': C(-8.1116, -79.0288),
  CHICLAYO: C(-6.7714, -79.8409),
  LAMBAYEQUE: C(-6.7714, -79.8409),
  LIMA: C(-12.0464, -77.0428),
  IQUITOS: C(-3.7437, -73.2516),
  MAYNAS: C(-3.7437, -73.2516),
  LORETO: C(-3.7437, -73.2516),
  'PUERTO MALDONADO': C(-12.5933, -69.1891),
  TAMBOPATA: C(-12.5933, -69.1891),
  'MADRE DE DIOS': C(-12.5933, -69.1891),
  MOQUEGUA: C(-17.1948, -70.9353),
  'MARISCAL NIETO': C(-17.1948, -70.9353),
  'CERRO DE PASCO': C(-10.6864, -76.2564),
  PASCO: C(-10.6864, -76.2564),
  PIURA: C(-5.1945, -80.6328),
  PUNO: C(-15.8402, -70.0219),
  MOYOBAMBA: C(-6.0342, -76.9714),
  'SAN MARTIN': C(-6.4873, -76.373),
  TACNA: C(-18.0146, -70.2536),
  TUMBES: C(-3.5669, -80.4515),
  PUCALLPA: C(-8.3791, -74.5539),
  CALLERIA: C(-8.3791, -74.5539),
  'CORONEL PORTILLO': C(-8.3791, -74.5539),
  UCAYALI: C(-8.3791, -74.5539),
  // ── Provincias / ciudades con agencia ──
  CHIMBOTE: C(-9.0745, -78.5936),
  SANTA: C(-9.0745, -78.5936),
  CHINCHA: C(-13.4099, -76.1323),
  'CHINCHA ALTA': C(-13.4099, -76.1323),
  PISCO: C(-13.71, -76.2032),
  NAZCA: C(-14.8356, -74.9382),
  TARMA: C(-11.4197, -75.6906),
  'LA MERCED': C(-11.0564, -75.3297),
  CHANCHAMAYO: C(-11.0564, -75.3297),
  JAUJA: C(-11.7757, -75.4966),
  HUAMACHUCO: C(-7.8156, -78.0483),
  'SANCHEZ CARRION': C(-7.8156, -78.0483),
  CHEPEN: C(-7.2272, -79.4275),
  HUACHO: C(-11.1067, -77.61),
  HUAURA: C(-11.1067, -77.61),
  'SAN VICENTE DE CAÑETE': C(-13.0761, -76.3844),
  CAÑETE: C(-13.0761, -76.3844),
  MALA: C(-12.6582, -76.6303),
  HUARAL: C(-11.4956, -77.2072),
  BARRANCA: C(-10.7539, -77.7611),
  YURIMAGUAS: C(-5.9006, -76.1111),
  ILO: C(-17.6394, -71.3375),
  SULLANA: C(-4.9039, -80.6853),
  TALARA: C(-4.5772, -81.2719),
  PAITA: C(-5.0892, -81.1144),
  JULIACA: C(-15.4997, -70.1333),
  'SAN ROMAN': C(-15.4997, -70.1333),
  TARAPOTO: C(-6.4873, -76.373),
  JAEN: C(-5.7078, -78.8078),
  BAGUA: C(-5.6389, -78.5311),
  ANDAHUAYLAS: C(-13.6555, -73.3871),
  SICUANI: C(-14.2694, -71.2261),
  CANCHIS: C(-14.2694, -71.2261),
  QUILLABAMBA: C(-12.8642, -72.6925),
  'LA CONVENCION': C(-12.8642, -72.6925),
  TINGO: C(-9.2956, -75.9958),
  'TINGO MARIA': C(-9.2956, -75.9958),
  'LEONCIO PRADO': C(-9.2956, -75.9958),
  SATIPO: C(-11.2525, -74.6386),
  HUANTA: C(-12.9333, -74.25),
  CAMANA: C(-16.6228, -72.7111),
  MOLLENDO: C(-17.0231, -72.0147),
  ISLAY: C(-17.0231, -72.0147),
  // ── Lima Metropolitana y Callao (distritos) ──
  'CERCADO DE LIMA': C(-12.0464, -77.0428),
  'SAN MARTIN DE PORRES': C(-12.0233, -77.0611),
  'SAN JUAN DE LURIGANCHO': C(-11.975, -77.0),
  MIRAFLORES: C(-12.1211, -77.0299),
  'SANTIAGO DE SURCO': C(-12.1461, -76.9931),
  SURCO: C(-12.1461, -76.9931),
  COMAS: C(-11.9384, -77.0532),
  'LOS OLIVOS': C(-11.9733, -77.0704),
  ATE: C(-12.0261, -76.92),
  'VILLA EL SALVADOR': C(-12.2134, -76.9377),
  'SAN ISIDRO': C(-12.0976, -77.0365),
  'LA VICTORIA': C(-12.0658, -77.0179),
  'PUEBLO LIBRE': C(-12.0753, -77.0631),
  'JESUS MARIA': C(-12.0742, -77.049),
  LINCE: C(-12.0844, -77.0362),
  'SAN MIGUEL': C(-12.0776, -77.0904),
  'MAGDALENA DEL MAR': C(-12.0907, -77.0699),
  MAGDALENA: C(-12.0907, -77.0699),
  BREÑA: C(-12.0578, -77.0509),
  RIMAC: C(-12.029, -77.0289),
  INDEPENDENCIA: C(-11.9911, -77.0546),
  'PUENTE PIEDRA': C(-11.86, -77.0763),
  CARABAYLLO: C(-11.862, -77.035),
  'SAN JUAN DE MIRAFLORES': C(-12.1598, -76.9698),
  'VILLA MARIA DEL TRIUNFO': C(-12.162, -76.933),
  CHORRILLOS: C(-12.17, -77.023),
  BARRANCO: C(-12.149, -77.022),
  SURQUILLO: C(-12.1122, -77.0176),
  'SAN BORJA': C(-12.101, -76.999),
  'LA MOLINA': C(-12.08, -76.93),
  'SANTA ANITA': C(-12.043, -76.971),
  'EL AGUSTINO': C(-12.043, -76.995),
  'SAN LUIS': C(-12.074, -76.999),
  CHACLACAYO: C(-11.975, -76.769),
  LURIGANCHO: C(-11.937, -76.7),
  CHOSICA: C(-11.937, -76.7),
  LURIN: C(-12.275, -76.867),
  PACHACAMAC: C(-12.229, -76.86),
  VENTANILLA: C(-11.875, -77.125),
  BELLAVISTA: C(-12.06, -77.115),
  'LA PERLA': C(-12.068, -77.11),
  'CARMEN DE LA LEGUA': C(-12.045, -77.09),
  ANCON: C(-11.7733, -77.1761),
  'SANTA ROSA': C(-11.8, -77.17),
};

export function normalizarNombreLugar(v?: string | null): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Busca coordenadas probando, en orden, distrito → provincia → departamento →
 * el texto libre del destino. Devuelve null si nada coincide.
 */
export function coordenadasDeDestino(partes: {
  destino?: string | null;
  distrito?: string | null;
  provincia?: string | null;
  departamento?: string | null;
}): Coordenada | null {
  const candidatos = [partes.distrito, partes.provincia, partes.departamento, partes.destino]
    .map(normalizarNombreLugar)
    .filter(Boolean);
  for (const c of candidatos) {
    if (COORDENADAS[c]) return COORDENADAS[c];
    // "JULIACA, SAN ROMAN" → probar cada tramo.
    for (const tramo of c.split(',').map((x) => x.trim())) {
      if (COORDENADAS[tramo]) return COORDENADAS[tramo];
    }
  }
  return null;
}
