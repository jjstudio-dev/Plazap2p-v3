// favorites.js — BON-001: favoritos locales, por naddr.
//
// Local primero: guardar un favorito no publica nada ni requiere identidad.
// Sincronizar a una lista NIP-51 (kind 30001/10001) firmada quedaría como
// paso posterior y siempre bajo acción explícita del usuario — no aquí.

const LS_KEY = 'plazap2p_favorites'

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter(x => typeof x === 'string' && x.length > 0) : []
  } catch {
    return []
  }
}

function save(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify([...new Set(list)])) } catch { /* privado/lleno: se pierde, no rompe la app */ }
}

export function isFavorite(naddr) {
  return !!naddr && load().includes(naddr)
}

export function addFavorite(naddr) {
  if (!naddr) return
  const list = load()
  if (!list.includes(naddr)) { list.push(naddr); save(list) }
}

export function removeFavorite(naddr) {
  save(load().filter(n => n !== naddr))
}

/** Alterna el estado y devuelve el nuevo valor (true = ahora es favorito). */
export function toggleFavorite(naddr) {
  if (isFavorite(naddr)) { removeFavorite(naddr); return false }
  addFavorite(naddr)
  return true
}

export function listFavorites() {
  return load()
}

export function favoritesCount() {
  return load().length
}
