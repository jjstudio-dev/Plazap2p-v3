// backup.js — BON-013: exportar/importar configuración completa
//
// Construido sobre el registro de storage-keys.js: SOLO se exporta lo que
// esté en EXPORTABLE hoy — nunca plazap2p_v3 (caché de eventos, no
// reverificada al cargar — ver auditoría del plan, hallazgo 1) ni ninguna
// clave de NWC (SENSITIVE). Igual de importante en la importación: solo se
// escriben claves que sigan en EXPORTABLE, sea lo que sea que traiga el
// JSON — así un backup viejo o manipulado no puede colar una clave nueva
// que hoy sea sensible.
//
// Los valores se copian como strings opacos (mismo formato que ya usa cada
// clave en localStorage, JSON-stringified o no) — nunca se reinterpretan
// aquí, así no hay riesgo de doble-(de)serialización. Cada módulo dueño de
// su clave (signer.js, saved-searches.js, order-tracking.js...) ya valida
// el formato al leer, así que un valor corrupto en el import simplemente
// se ignora ahí, no aquí.

import { EXPORTABLE } from './storage-keys.js'

const FORMAT_VERSION = 1

/** @returns {{formatVersion:number, exportedAt:number, data:Record<string,string>}} */
export function exportConfig() {
  const data = {}
  for (const key of EXPORTABLE) {
    try {
      const v = localStorage.getItem(key)
      if (v != null) data[key] = v
    } catch { /* privado/bloqueado: se omite esa clave */ }
  }
  return { formatVersion: FORMAT_VERSION, exportedAt: Math.floor(Date.now() / 1000), data }
}

/**
 * @param {string|object} json
 * @param {{onIdentityChange?: (newHex:string, oldHex:string) => boolean}} [opts]
 *   onIdentityChange se llama SOLO si el backup trae un plazap2p_pubkey
 *   distinto al actual — debe devolver true para aplicar el cambio de
 *   identidad, false para conservar la identidad actual (el resto de
 *   claves se aplica igual).
 * @returns {{ok:true, applied:string[]} | {ok:false, error:string}}
 */
export function importConfig(json, { onIdentityChange } = {}) {
  let parsed
  try { parsed = typeof json === 'string' ? JSON.parse(json) : json } catch { return { ok: false, error: 'JSON inválido' } }
  if (!parsed || typeof parsed !== 'object' || !parsed.data || typeof parsed.data !== 'object') {
    return { ok: false, error: 'formato de backup no reconocido' }
  }

  const toApply = {}
  for (const [key, value] of Object.entries(parsed.data)) {
    if (EXPORTABLE.includes(key) && typeof value === 'string') toApply[key] = value
  }

  const PUBKEY_KEY = 'plazap2p_pubkey'
  if (Object.prototype.hasOwnProperty.call(toApply, PUBKEY_KEY)) {
    const newPubkey = toApply[PUBKEY_KEY]
    let currentPubkey = null
    try { currentPubkey = localStorage.getItem(PUBKEY_KEY) } catch { /* ignorar */ }
    if (currentPubkey && newPubkey !== currentPubkey) {
      const proceed = typeof onIdentityChange === 'function' ? !!onIdentityChange(newPubkey, currentPubkey) : false
      if (!proceed) delete toApply[PUBKEY_KEY]
    }
  }

  const applied = []
  for (const [key, value] of Object.entries(toApply)) {
    try { localStorage.setItem(key, value); applied.push(key) } catch { /* privado/lleno: se omite esa clave */ }
  }
  return { ok: true, applied }
}
