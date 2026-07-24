// drafts.js — Borradores locales persistentes (UX-002, ver
// txt/PLAN_VERIFICACION_APP_PURA.md §6). Guarda el MISMO snapshot que ya usa
// publicar-app.js para no perder el formulario al saltar a Amber
// (takeFormSnapshot/restoreFormSnapshot) — este módulo solo le da más vida
// que la sesión de firma: sobrevive a cerrar la pestaña o recargar.
//
// Un borrador por tipo de publicación (servicio/evento/.../venta/compra/
// intercambio/valorar) — igual que el wizard solo tiene un formulario activo
// a la vez, no hace falta una lista. Nunca guarda datos de wallet/identidad.

const PREFIX = 'plazap2p_draft_'
const SCHEMA_VERSION = 1

function keyFor(type) {
  return `${PREFIX}${type}`
}

/** Descarta el borrador si el snapshot no tiene ningún campo de texto con contenido real. */
export function isSnapshotMeaningful(snapshot) {
  if (!snapshot) return false
  return Object.values(snapshot.fields || {}).some(v => String(v ?? '').trim().length > 0)
}

export function saveDraft(type, snapshot) {
  if (!type || !isSnapshotMeaningful(snapshot)) return false
  try {
    localStorage.setItem(keyFor(type), JSON.stringify({ v: SCHEMA_VERSION, savedAt: Date.now(), snapshot }))
    return true
  } catch {
    return false // localStorage lleno/deshabilitado: el formulario sigue funcionando, solo sin autosave
  }
}

/** Devuelve { v, savedAt, snapshot } o null. Migra/descarta versiones de esquema desconocidas en vez de restaurar datos inválidos. */
export function loadDraft(type) {
  if (!type) return null
  try {
    const raw = localStorage.getItem(keyFor(type))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.v !== SCHEMA_VERSION || typeof parsed.snapshot !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

export function deleteDraft(type) {
  if (!type) return
  try { localStorage.removeItem(keyFor(type)) } catch { /* no-op: nada que borrar si localStorage falla */ }
}

export function hasDraft(type) {
  return loadDraft(type) !== null
}
