// seller-profile.js — «Perfil del vendedor»: lo que se sabe de quien publica.
//
// Parte pura (sin red ni DOM), para poder probarla: resume los anuncios de un
// vendedor y decide qué contacto se ofrece. La ventana la pinta app.js con
// estos datos, su perfil Nostr (kind 0, profile.js) y su reputación
// (reputacion.js).

/**
 * Anuncios de un vendedor (ya parseados con parseListing) → activos (lo más
 * nuevo primero, sin caducados ni retirados), cuántos vendidos y desde cuándo
 * publica. Si llegan varias versiones del mismo anuncio, cuenta la última.
 */
export function summarizeSellerListings(listings, nowSec = Math.floor(Date.now() / 1000)) {
  const latest = new Map()
  for (const l of listings || []) {
    if (!l || !l.naddr) continue
    const prev = latest.get(l.naddr)
    if (!prev || (l.created_at || 0) > (prev.created_at || 0)) latest.set(l.naddr, l)
  }
  const all = [...latest.values()]
  const status = l => String(l.status || 'active').toLowerCase()
  const expired = l => Number.isFinite(l.expiresAt) && l.expiresAt > 0 && l.expiresAt <= nowSec
  const active = all.filter(l => status(l) === 'active' && !expired(l))
    .sort((a, b) => (b.publishedAt || b.created_at || 0) - (a.publishedAt || a.created_at || 0))
  const sold = all.filter(l => status(l) === 'sold').length
  const times = all.map(l => l.publishedAt || l.created_at).filter(t => Number.isFinite(t) && t > 0)
  return { active, sold, since: times.length ? Math.min(...times) : null }
}

/** Nombre a enseñar: el del perfil o, si no hay, el principio del npub. */
export function sellerDisplayName(meta, npub) {
  const name = (meta?.displayName || meta?.name || '').trim()
  return name || `${String(npub || '').slice(0, 16)}…`
}

/** «desde marzo de 2026» a partir de un timestamp en segundos (o '' sin dato). */
export function sinceLabel(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  return new Date(ts * 1000).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
}
