// comunidades-2140.js — comunidades Bitcoin de España del directorio
// 2140meetups.com (copiadas en data/comunidades-2140.json por
// tools/build-comunidades-2140.mjs). Lo usa el script al generar el archivo y
// la web al leerlo: los dos pasan por la misma limpieza.

const NPUB_RE = /^npub1[02-9ac-hj-np-z]{58}$/
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
  if (!nombre || lat == null || lon == null) return null
  const npub = String(c.npub ?? c.nostr ?? '').trim().replace(/^nostr:/, '')
  const ln = String(c.lightning ?? c.lightning_address ?? '').trim()
  const telegram = httpsUrl(c.telegram)
  const web = httpsUrl(c.web ?? c.enlace)
  return {
    id: String(c.id ?? '').replace(/[^0-9a-z-]/gi, '').slice(0, 20) || null,
    nombre,
    ciudad: text(c.ciudad, 60) || null,
    direccion: text(c.direccion, 120) || null,
    lat,
    lon,
    telegram: telegram && /^https:\/\/(t\.me|telegram\.me)\//.test(telegram) ? telegram : null,
    web: web && web !== telegram ? web : null,
    lightning: LN_ADDRESS_RE.test(ln) ? ln.toLowerCase() : null,
    npub: NPUB_RE.test(npub) ? npub : null,
    ficha: (() => { const f = httpsUrl(c.ficha ?? c.link); return f && f.startsWith('https://2140meetups.com/') ? f : null })(),
  }
}

/** Lista limpia de data/comunidades-2140.json (o [] si viene mal). */
export function communitiesFrom(doc) {
  const list = Array.isArray(doc?.comunidades) ? doc.comunidades : []
  return list.map(cleanCommunity).filter(Boolean)
}
