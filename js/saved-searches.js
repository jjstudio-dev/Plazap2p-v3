// saved-searches.js — BON-002: búsquedas guardadas y alertas de Mercado
//
// Solo avisa mientras la pestaña está abierta (no hay Push real sin
// backend — BON-011 no existe). CRUD sobre localStorage, mismo patrón de
// registro que storage-keys.js. matchesFilterState() es la ÚNICA fuente de
// verdad del matching: la usa tanto app.js (para pintar Mercado) como esta
// alerta, para que "coincide con lo que veo al buscar a mano" sea siempre
// cierto (ver auditoría del plan, hallazgo 5).

const LS_KEY = 'plazap2p_saved_searches'
const SS_ALERTED_KEY = 'plazap2p_saved_searches_alerted' // sessionStorage: no debe sobrevivir a un cierre de pestaña

function readAll() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function writeAll(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)) } catch { /* privado/lleno: se pierde, no es crítico */ }
}

/** @returns {string} id de la búsqueda guardada */
export function saveSearch({ filter = null, location = null, query = null, label = '' } = {}) {
  const all = readAll()
  const id = `ss-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  all.push({ id, filter, location, query, label: String(label || '').slice(0, 80), createdAt: Math.floor(Date.now() / 1000) })
  writeAll(all)
  return id
}

export function listSearches() {
  return readAll()
}

export function removeSearch(id) {
  writeAll(readAll().filter(s => s.id !== id))
}

/**
 * Predicado puro de matching — MISMA lógica que ya usa app.js en
 * renderActiveChannel() para el filtro/zona/texto de Mercado. `state` es
 * {filter, location, query} (de una búsqueda guardada o del estado actual
 * de los controles); `item` es un objeto ya parseado por parseListing().
 */
export function matchesFilterState(state, item) {
  const { filter, location, query } = state || {}
  if (filter && filter !== 'all' && item.category !== filter) return false
  if (location && location !== 'all' && item.location !== location) return false
  const q = String(query || '').trim().toLowerCase()
  if (q) {
    const text = [item.title, item.summary, item.content, item.location].filter(Boolean).join(' ').toLowerCase()
    if (!text.includes(q)) return false
  }
  return true
}

export function matchesSearch(search, item) {
  return matchesFilterState(search, item)
}

function readAlerted() {
  try {
    const raw = sessionStorage.getItem(SS_ALERTED_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function writeAlerted(list) {
  try { sessionStorage.setItem(SS_ALERTED_KEY, JSON.stringify(list.slice(-500))) } catch { /* ignorar */ }
}

export function wasAlerted(searchId, eventKey) {
  return readAlerted().includes(`${searchId}:${eventKey}`)
}

export function markAlerted(searchId, eventKey) {
  const list = readAlerted()
  list.push(`${searchId}:${eventKey}`)
  writeAlerted(list)
}
