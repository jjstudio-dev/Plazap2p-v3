// storage-keys.js — Registro central de claves de localStorage.
//
// Toda clave nueva de localStorage debe añadirse aquí como EXPORTABLE o
// SENSITIVE. Es lo que permite a un futuro backup/export (BON-013) saber
// qué es seguro exportar sin tener que releer cada módulo por separado, y
// evita que una clave nueva quede "suelta" y se filtre por omisión.
//
// SENSITIVE nunca se exporta ni se muestra: son credenciales con capacidad
// de gasto (NWC) o equivalentes. plazap2p_v3 (caché de eventos) tampoco es
// exportable pese a no ser secreto: loadFromCache() en app.js no re-verifica
// firmas al cargar, así que un "backup" manipulado podría inyectar anuncios
// falsos en quien lo importe (ver auditoría del plan, hallazgo 1).

export const EXPORTABLE = [
  'plazap2p_sort',      // app.js — preferencia de orden por canal
  'plazap2p_pubkey',    // signer.js — pubkey del usuario (pública, no secreta)
  'plazap2p_nwc_meta',  // wallet-session.js — metadatos de wallet SIN secret (stripSecret ya aplicado)
  'plazap2p_orders',    // order-tracking.js — estados locales de seguimiento (nunca publicados a relays)
  'plazap2p_saved_searches', // saved-searches.js — combinaciones de filtro/zona/texto guardadas
  'plazap2p_favorites',  // favorites.js — anuncios/npubs marcados como favoritos
  'plazap2p_blocked_pubkeys', // moderation.js — lista local de pubkeys bloqueados
]

export const SENSITIVE = [
  'plazap2p_nwc_persist', // wallet-session.js — conexión NWC completa (incluye secret)
  'plazap2p_nwc',         // wallet-session.js — clave legada, mismo contenido
]

// No exportable pero tampoco sensible: cachés/derivados que no deben
// re-importarse sin pasar por su ruta normal de verificación.
export const CACHE_ONLY = [
  'plazap2p_v3', // app.js — caché de eventos ya parseados, no reverificados al cargar
]

const ALL = [...EXPORTABLE, ...SENSITIVE, ...CACHE_ONLY]

/** true si la clave está registrada en alguna de las tres listas. */
export function isRegistered(key) {
  return ALL.includes(key)
}
