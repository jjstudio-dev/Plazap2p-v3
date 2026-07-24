// moderation.js — Moderación local por usuario (MOD-001, BON-017)
//
// Lista de pubkeys ocultas, SOLO en este navegador — no es un ban global ni
// se publica a nadie. Respeta la autonomía del cliente: cada persona decide
// qué no quiere ver, PlazaP2P no censura contenido para todos.
//
// Portable (BON-017): export/import como JSON plano de pubkeys hex, para
// llevarse la lista a otro dispositivo sin depender de esta app.

const LS_KEY = 'plazap2p_blocked_pubkeys'

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter(h => /^[0-9a-f]{64}$/i.test(h)).map(h => h.toLowerCase()) : []
  } catch {
    return []
  }
}

function save(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify([...new Set(list)])) } catch { /* privado/lleno: se pierde la lista, no la app */ }
}

export function isBlocked(pubkeyHex) {
  if (!pubkeyHex) return false
  return load().includes(String(pubkeyHex).toLowerCase())
}

export function blockPubkey(pubkeyHex) {
  if (!/^[0-9a-f]{64}$/i.test(String(pubkeyHex || ''))) return
  const list = load()
  const hex = pubkeyHex.toLowerCase()
  if (!list.includes(hex)) { list.push(hex); save(list) }
}

export function unblockPubkey(pubkeyHex) {
  const hex = String(pubkeyHex || '').toLowerCase()
  save(load().filter(h => h !== hex))
}

export function listBlocked() {
  return load()
}

/** BON-017 — exporta la lista como JSON descargable/copiable (solo pubkeys, nada sensible). */
export function exportBlocked() {
  return JSON.stringify({ plazap2p_blocked_pubkeys: load() }, null, 2)
}

/** @returns {number} cuántas pubkeys nuevas se importaron (ya existentes no cuentan). */
export function importBlocked(json) {
  let parsed
  try { parsed = JSON.parse(json) } catch { throw new Error('JSON inválido') }
  const incoming = Array.isArray(parsed) ? parsed : parsed?.plazap2p_blocked_pubkeys
  if (!Array.isArray(incoming)) throw new Error('formato no reconocido')
  const valid = incoming.filter(h => /^[0-9a-f]{64}$/i.test(String(h))).map(h => String(h).toLowerCase())
  const before = load()
  const merged = [...new Set([...before, ...valid])]
  save(merged)
  return merged.length - before.length
}
