// geo-cities.js — BON-003 (alcance MVP tras auditoría del plan)
//
// La versión completa (geocodificación + mapa embebido con pines) es la
// pieza de infraestructura más grande de todo el backlog y exige decidir
// con mucho cuidado el nivel de redondeo de privacidad ANTES de escribir
// código — una vez alguien publica coordenadas exactas por error, quedan
// en los relays para siempre (no hay borrado real en Nostr).
//
// Este módulo NO pide ni publica ninguna coordenada. Solo resuelve el
// `location` de texto libre que YA existe en los anuncios (p.ej. "Madrid",
// "Valencia centro") contra una tabla estática de coordenadas aproximadas
// de ciudad — cero campos nuevos, cero riesgo de coordenadas exactas por
// error. Sirve solo para enlazar a un mapa externo (OpenStreetMap), nunca
// para embeber un mapa con pines (eso necesitaría una librería como
// Leaflet, que contradice el principio de cero dependencias del proyecto).

const CITY_COORDS = {
  madrid:               [40.4168, -3.7038],
  barcelona:             [41.3874, 2.1686],
  valencia:              [39.4699, -0.3763],
  sevilla:               [37.3891, -5.9845],
  bilbao:                [43.2630, -2.9350],
  zaragoza:              [41.6488, -0.8891],
  malaga:                [36.7213, -4.4213],
  murcia:                [37.9922, -1.1307],
  'palma de mallorca':   [39.5696, 2.6502],
  'las palmas':          [28.1235, -15.4363],
  'santa cruz de tenerife': [28.4636, -16.2518],
  alicante:              [38.3452, -0.4810],
  cordoba:               [37.8882, -4.7794],
  valladolid:            [41.6523, -4.7245],
  vigo:                  [42.2406, -8.7207],
  gijon:                 [43.5322, -5.6611],
  granada:               [37.1773, -3.5986],
  'buenos aires':        [-34.6037, -58.3816],
  'ciudad de mexico':    [19.4326, -99.1332],
  'mexico df':           [19.4326, -99.1332],
  bogota:                [4.7110, -74.0721],
  lima:                  [-12.0464, -77.0428],
  santiago:              [-33.4489, -70.6693],
  montevideo:            [-34.9011, -56.1645],
  caracas:               [10.4806, -66.9036],
  quito:                 [-0.1807, -78.4678],
  'san jose':            [9.9281, -84.0907],
  guatemala:             [14.6349, -90.5069],
  'la paz':              [-16.5000, -68.1500],
  asuncion:              [-25.2637, -57.5759],
}

/** Quita acentos y pasa a minúsculas, para hacer el lookup insensible a tildes. */
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita diacríticos (marcas combinantes NFD)
    .trim()
}

/**
 * Aproxima coordenadas de una ciudad a partir de texto libre. Solo hace
 * match si el texto normalizado EMPIEZA por un nombre de ciudad conocido
 * (p.ej. "Valencia centro" → valencia), para no dar falsos positivos con
 * texto tipo "Cerca de Madrid, pero en otra provincia".
 * @returns {[number, number] | null} [lat, lon] aproximado, o null
 */
export function approximateCityCoords(locationText) {
  const norm = normalize(locationText)
  if (!norm) return null
  for (const [city, coords] of Object.entries(CITY_COORDS)) {
    if (norm === city || norm.startsWith(city + ' ') || norm.startsWith(city + ',')) return coords
  }
  return null
}

/** URL de OpenStreetMap centrada en la ciudad aproximada, o null si no se reconoce. */
export function osmLinkForLocation(locationText) {
  const coords = approximateCityCoords(locationText)
  if (!coords) return null
  const [lat, lon] = coords
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=11/${lat}/${lon}`
}
