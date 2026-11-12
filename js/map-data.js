// map-data.js — puntos del mapa a partir de lo que ya tiene la web.
//
// Capas («perfiles»), cada una con su interruptor:
//   comunidades  comunidades Bitcoin de España (2140meetups.com)
//   eventos      eventos de calendario con zona (`g`)
//   anuncios     anuncios con zona aproximada (PlazaP2P y Mercasats)
//   comercios    puntos de venta: anuncios con `t plazap2p-comercio` y ubicación exacta
//   btcmap       comercios que aceptan bitcoin, de BTC Map (se piden al mover el mapa)
//
// Una zona aproximada (geohash corto) se dibuja como un área, nunca como un
// punto exacto; solo lo publicado con precisión de calle lleva «Cómo llegar».

import { decodeGeohash, EXACT_FROM_LENGTH } from './geohash.js'

export const LAYERS = Object.freeze([
  { id: 'comunidades', label: '🏘 Comunidades', defaultOn: true },
  { id: 'eventos', label: '📅 Eventos', defaultOn: true },
  { id: 'comercios', label: '🏪 Puntos de venta', defaultOn: true },
  { id: 'anuncios', label: '🛒 Anuncios (zona aproximada)', defaultOn: true },
  { id: 'btcmap', label: '₿ Comercios BTC Map', defaultOn: false },
])

/** Etiqueta que marca un anuncio como punto de venta con ubicación exacta. */
export const COMMERCE_TAG = 'plazap2p-comercio'

/** Enlaces para llegar con la app de mapas o el GPS del móvil. */
export function directionsLinks(lat, lon, label = '') {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const ll = `${lat.toFixed(6)},${lon.toFixed(6)}`
  const q = label ? `(${encodeURIComponent(label.slice(0, 60))})` : ''
  return {
    // Abre la app de mapas del móvil (Google Maps, OsmAnd, Organic Maps…).
    geo: `geo:${ll}?q=${ll}${q}`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${ll}`,
    osm: `https://www.openstreetmap.org/directions?to=${ll}#map=17/${lat.toFixed(5)}/${lon.toFixed(5)}`,
  }
}

function pointFromGeohash(gh) {
  const cell = decodeGeohash(gh)
  if (!cell) return null
  return { lat: cell.lat, lon: cell.lon, exact: gh.length >= EXACT_FROM_LENGTH, latErr: cell.latErr, lonErr: cell.lonErr }
}

/** Comunidades ya limpias (comunidades-2140.js) → puntos de la capa comunidades. */
export function communityPoints(communities) {
  // Las que solo están en el directorio curado no tienen sitio: no salen en el mapa.
  return (communities || []).filter(c => c.lat != null && c.lon != null).map(c => ({
    // Su punto es el lugar público donde quedan (una plaza, un local): se puede ir.
    // De 2140meetups es el sitio donde quedan; de BTC Map solo la zona de la comunidad.
    layer: 'comunidades', id: `c-${c.id || c.nombre}`, lat: c.lat, lon: c.lon, exact: c.exacta !== false,
    latErr: c.exacta === false ? 0.05 : 0,
    title: c.nombre, subtitle: [c.ciudad, c.direccion].filter(Boolean).join(' · '), links: [
      c.telegram && { label: 'Telegram', url: c.telegram },
      c.web && { label: 'Web', url: c.web },
      c.npub && { label: 'Perfil Nostr', url: `https://njump.me/${c.npub}` },
      c.ficha && { label: 'Ficha en 2140meetups', url: c.ficha },
      c.btcmap && { label: 'Ficha en BTC Map', url: c.btcmap },
    ].filter(Boolean), npub: c.npub || null, image: c.foto || null,
  }))
}

/** Anuncios parseados (parseListing) → capas comercios y anuncios. */
export function listingPoints(listings) {
  const out = []
  for (const l of listings || []) {
    if (!l || !l.geohash) continue
    const p = pointFromGeohash(l.geohash)
    if (!p) continue
    const commerce = l.isCommerce && p.exact
    out.push({
      layer: commerce ? 'comercios' : 'anuncios', id: `l-${l.naddr}`, ...p,
      // Sin ser comercio, nunca se enseña como punto exacto aunque lo sea.
      exact: commerce,
      title: l.title, subtitle: [l.market ? `vía ${l.market.label}` : '', l.location || ''].filter(Boolean).join(' · '),
      naddr: l.naddr,
    })
  }
  return out
}

/** Eventos de calendario parseados → capa eventos (exacto o aproximado según su `g`). */
export function eventPoints(events) {
  const out = []
  for (const e of events || []) {
    if (!e || !e.geohash) continue
    const p = pointFromGeohash(e.geohash)
    if (!p) continue
    out.push({ layer: 'eventos', id: `e-${e.naddr}`, ...p, title: e.title, subtitle: e.location || '', naddr: e.naddr, start: e.start?.ts || null })
  }
  return out
}

/** Respuesta de api.btcmap.org/v4/places/search → capa btcmap. Ignora lo malformado. */
export function btcmapPoints(places) {
  if (!Array.isArray(places)) return []
  const out = []
  for (const p of places.slice(0, 500)) {
    const lat = Number(p?.lat), lon = Number(p?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    const name = typeof p.name === 'string' ? p.name.trim().slice(0, 80) : ''
    if (!name) continue
    let website = null
    try { const u = new URL(p.website); if (u.protocol === 'https:' || u.protocol === 'http:') website = u.href } catch { /* sin web */ }
    out.push({
      layer: 'btcmap', id: `b-${Number(p.id) || name}`, lat, lon, exact: true, title: name,
      subtitle: typeof p.address === 'string' ? p.address.slice(0, 120) : '',
      links: [
        website && { label: 'Web', url: website },
        Number.isInteger(p.id) && { label: 'Ficha en BTC Map', url: `https://btcmap.org/merchant/${p.id}` },
      ].filter(Boolean),
    })
  }
  return out
}

/** URL de búsqueda de BTC Map alrededor de un punto (radio acotado). */
export function btcmapSearchUrl(lat, lon, radiusKm) {
  const r = Math.min(Math.max(Math.round(radiusKm), 1), 50)
  return `https://api.btcmap.org/v4/places/search/?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&radius_km=${r}`
}
