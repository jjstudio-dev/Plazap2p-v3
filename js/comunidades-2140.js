// comunidades-2140.js — comunidades Bitcoin de España de 2140meetups.com y de
// BTC Map (juntadas sin repetir en data/comunidades-2140.json por
// tools/build-comunidades-2140.mjs; el nombre del archivo es histórico). Lo usa
// el script al generar el archivo y la web al leerlo: los dos pasan por la
// misma limpieza.

const NPUB_RE = /^npub1[02-9ac-hj-np-z]{58}$/
const PHOTO_RE = /^https:\/\/(2140meetups\.com\/wp-content\/uploads|static\.btcmap\.org\/images\/communities)\/[^?#]+\.(png|jpe?g|webp)$/i
const FICHA_RE = /^https:\/\/2140meetups\.com\/comunidad\/\d+\/?$/
const BTCMAP_RE = /^https:\/\/btcmap\.org\/community\/[a-z0-9_-]{1,80}$/
const SOURCES = ['2140meetups', 'btcmap', 'plazap2p']
const LN_ADDRESS_RE = /^[a-z0-9._-]{1,64}@[a-z0-9.-]{3,253}\.[a-z]{2,}$/i

function text(v, max) {
  const s = typeof v === 'string' ? v : (v && typeof v.rendered === 'string' ? v.rendered : '')
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&#8217;|&#039;/g, '\'').replace(/&#8211;/g, '–').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** https://… sin credenciales, o null. */
export function httpsUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim())
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null
  } catch { return null }
}

/** «Sevilla, Sevilla, España, Sevilla, España» → «Sevilla, España». */
function dedupeParts(s) {
  const seen = new Set()
  return s.split(',').map(p => p.trim()).filter(p => {
    const k = p.toLowerCase()
    if (!p || seen.has(k)) return false
    seen.add(k)
    return true
  }).join(', ')
}

function coord(v, limit) {
  const n = Number(v)
  return Number.isFinite(n) && Math.abs(n) <= limit && n !== 0 ? Math.round(n * 1e6) / 1e6 : null
}

/**
 * Una comunidad del API (o del JSON ya generado) con solo lo que se usa, todo
 * validado. null si le falta el nombre o la posición.
 */
export function cleanCommunity(c) {
  if (!c || typeof c !== 'object') return null
  const nombre = text(c.nombre ?? c.title, 80)
  const lat = coord(c.lat, 90)
  const lon = coord(c.lon, 180)
  const curada = c.curada === true
  // Sin sitio solo valen las del directorio curado (no salen en el mapa, sí en el listado).
  if (!nombre || (!curada && (lat == null || lon == null))) return null
  const npub = String(c.npub ?? c.nostr ?? '').trim().replace(/^nostr:/, '')
  const ln = String(c.lightning ?? c.lightning_address ?? '').trim()
  const telegram = httpsUrl(c.telegram)
  const web = httpsUrl(c.web ?? c.enlace)
  return {
    id: String(c.id ?? '').replace(/[^0-9a-z_-]/gi, '').slice(0, 80) || null,
    nombre,
    ciudad: text(c.ciudad, 60) || null,
    direccion: dedupeParts(text(c.direccion, 200)).slice(0, 120) || null,
    lat,
    lon,
    // Un enlace de Telegram con espacios (%20) viene roto del origen: no lleva a ningún grupo.
    telegram: telegram && /^https:\/\/(t\.me|telegram\.me)\/[^%\s]+$/.test(telegram) ? telegram : null,
    web: web && web !== telegram ? web : null,
    lightning: LN_ADDRESS_RE.test(ln) ? ln.toLowerCase() : null,
    npub: NPUB_RE.test(npub) ? npub : null,
    ficha: (() => { const f = httpsUrl(c.ficha ?? c.link); return f && FICHA_RE.test(f) ? f : null })(),
    btcmap: (() => { const f = httpsUrl(c.btcmap); return f && BTCMAP_RE.test(f) ? f : null })(),
    // Foto de la comunidad: solo de 2140meetups o BTC Map y con extensión de imagen (nada de SVG).
    foto: (() => { const f = httpsUrl(c.foto); return f && PHOTO_RE.test(f) ? f : null })(),
    destacada: c.destacada === true,
    // 2140meetups da el sitio donde quedan (se puede ir); BTC Map, la zona de la comunidad.
    exacta: c.exacta !== false,
    fuentes: (Array.isArray(c.fuentes) ? c.fuentes : ['2140meetups']).filter(f => SOURCES.includes(f)),
    // Del directorio curado de PlazaP2P (data/comunidades.json).
    curada,
    descripcion: text(c.descripcion, 300) || null,
    idioma: text(c.idioma, 40) || null,
    plataforma: text(c.plataforma, 30) || null,
  }
}

/** Lista limpia de data/comunidades-2140.json (o [] si viene mal). */
export function communitiesFrom(doc) {
  const list = Array.isArray(doc?.comunidades) ? doc.comunidades : []
  return list.map(cleanCommunity).filter(Boolean)
}

// Palabras que llevan casi todas: no dicen de qué sitio es la comunidad.
const GENERIC_WORDS = new Set(['bitcoin', 'bitcoiners', 'btc', '2140', '21', 'only', 'plebs', 'meetup', 'meetups',
  'club', 'social', 'comunidad', 'community', 'hub', 'maxi', 'the', 'de', 'del', 'la', 'el', 'y', 'p2p', 'bbh'])

function placeWords(v) {
  return String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter(w => w && !GENERIC_WORDS.has(w))
}

/** ¿Mismo nombre? «Pontevedra 2140 / Vigo Bitcoin P2P» = «Pontevedra _2140_». */
export function sameCommunityName(a, b) {
  const norm = v => String(v || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '')
  const x = norm(a), y = norm(b)
  return !!x && !!y && (x === y || (y.length >= 6 && x.includes(y)) || (x.length >= 6 && y.includes(x)))
}

/**
 * ¿Mismo sitio en el nombre, quitando las palabras genéricas? «2140 Tenerife» y
 * «Tenerife 2140», «Bitcoin Cádiz» y «BTC CADIZ». Solo sirve para juntar si en
 * el otro directorio hay UNA comunidad así: en Barcelona hay dos distintas.
 */
export function samePlaceWords(a, b) {
  const wa = placeWords(a), wb = placeWords(b)
  if (!wa.length || !wb.length) return false
  const [small, big] = wa.length <= wb.length ? [wa, new Set(wb)] : [wb, new Set(wa)]
  return small.every(w => big.has(w))
}

function sameTelegram(a, b) {
  const norm = u => String(u || '').toLowerCase().replace(/^https:\/\/(t|telegram)\.me\//, '').replace(/\/+$/, '')
  return !!a && !!b && norm(a) === norm(b)
}

/**
 * Directorio curado (data/comunidades.json) + comunidades locales (2140meetups
 * y BTC Map) en UNA lista, una entrada por comunidad. La misma comunidad: mismo
 * nombre, mismo Telegram o el mismo sitio en el nombre si solo hay una así; si
 * las dos tienen Telegram y es distinto, no son la misma. Se queda lo de las
 * dos: descripción e idioma del directorio; ciudad, sitio, foto y contactos de
 * las locales.
 */
export function mergeCommunities(curated, local) {
  const out = local.map(l => ({ ...l }))
  for (const c of curated || []) {
    if (!c || c.aprobado === false || !c.nombre) continue
    const link = httpsUrl(c.link)
    const tg = link && /^https:\/\/(t\.me|telegram\.me)\//.test(link) ? link : null
    const conflict = l => tg && l.telegram && !sameTelegram(tg, l.telegram)
    const byPlace = out.filter(l => !l.curada && samePlaceWords(c.nombre, l.nombre))
    // Mismo nombre manda aunque los Telegram no coincidan (en 2140meetups alguno viene roto).
    const twin = out.find(l => !l.curada && sameCommunityName(c.nombre, l.nombre)) ??
      out.find(l => !l.curada && sameTelegram(tg, l.telegram)) ??
      (byPlace.length === 1 && !conflict(byPlace[0]) ? byPlace[0] : null)
    const extra = {
      descripcion: c.descripcion || null, idioma: c.idioma || null, plataforma: c.plataforma || null,
      telegram: tg, web: link && !tg ? link : null, foto: null,
    }
    if (twin) {
      twin.curada = true
      // Los contactos del directorio curado los revisa una persona: mandan sobre los importados.
      for (const [k, v] of Object.entries(extra)) twin[k] = ['telegram', 'web'].includes(k) ? (v || twin[k]) : (twin[k] || v)
      twin.fuentes = [...new Set(['plazap2p', ...(twin.fuentes || [])])]
    } else {
      out.push({ id: `cur-${c.id || c.nombre}`, nombre: c.nombre, ciudad: null, lat: null, lon: null, ...extra,
        curada: true, exacta: false, fuentes: ['plazap2p'] })
    }
  }
  return out.map(cleanCommunity).filter(Boolean)
    .sort((a, b) => (b.destacada - a.destacada) || a.nombre.localeCompare(b.nombre, 'es'))
}
