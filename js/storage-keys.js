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

// Claves que se forman con un prefijo y un sufijo variable. Exportables.
export const EXPORTABLE_PREFIXES = [
  'plazap2p_draft_',     // drafts.js — borrador del formulario de publicar, uno por tipo
]

const ALL = [...EXPORTABLE, ...SENSITIVE, ...CACHE_ONLY]

/** true si la clave está registrada en alguna de las listas (o empieza por un prefijo registrado). */
export function isRegistered(key) {
  return ALL.includes(key) || EXPORTABLE_PREFIXES.some(p => String(key).startsWith(p) && String(key).length > p.length)
}
