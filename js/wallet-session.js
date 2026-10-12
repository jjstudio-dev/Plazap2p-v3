// wallet-session.js — Ciclo de vida de la conexión NWC (WAL-001)
//
// El `secret` del string NWC es una credencial CON CAPACIDAD DE GASTO (hasta
// el presupuesto configurado en la wallet). Reglas:
//   - Por defecto vive en sessionStorage: desaparece al cerrar la pestaña.
//   - Solo pasa a localStorage si el usuario marca explícitamente
//     "Recordar esta conexión" (opt-in con advertencia visible en la UI).
//   - Los METADATOS sin secret (walletPubkey, relay, métodos, cifrado) se
//     guardan en localStorage solo con ese mismo opt-in: dicen qué wallet usa
//     alguien y por qué relay, y no hay por qué dejarlo escrito sin pedirlo.
//   - clear() borra las tres claves. Nunca loguear ni exportar el secret.
//
// Migración: versiones anteriores guardaban la conexión completa en
// localStorage['plazap2p_nwc'] — al cargar se mueve a sessionStorage y la
// clave antigua se elimina.

const SS_KEY  = 'plazap2p_nwc_session'   // sessionStorage: conexión completa
const LS_KEY  = 'plazap2p_nwc_persist'   // localStorage: solo con opt-in
const LS_META = 'plazap2p_nwc_meta'      // localStorage: metadatos SIN secret
const LEGACY_KEY = 'plazap2p_nwc'        // clave insegura de versiones previas

function isValidConn(c) {
  return !!(c
    && /^[0-9a-f]{64}$/.test(c.walletPubkey || '')
    && /^[0-9a-f]{64}$/.test(c.secret || '')
    && typeof c.relay === 'string' && /^wss?:\/\//.test(c.relay))
}

function stripSecret(conn) {
  const { secret, ...meta } = conn
  return meta
}

/**
 * Guarda la conexión activa. sessionStorage siempre; localStorage (la
 * conexión y sus metadatos sin secret) solo si remember=true.
 */
export function save(conn, { remember = false } = {}) {
  if (!isValidConn(conn)) throw new Error('conexión NWC inválida')
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(conn)) } catch { /* privado/lleno */ }
  try {
    if (remember) {
      localStorage.setItem(LS_KEY, JSON.stringify(conn))
      localStorage.setItem(LS_META, JSON.stringify(stripSecret(conn)))
    } else {
      localStorage.removeItem(LS_KEY)
      localStorage.removeItem(LS_META)
    }
  } catch { /* ignorar */ }
}

/** Conexión activa: sesión actual, o persistida con opt-in, o null. */
export function load() {
  migrateLegacy()
  // El acceso a sessionStorage/localStorage va DENTRO del try: con el
  // almacenamiento bloqueado por el navegador, solo nombrarlos ya lanza.
  for (const [getStorage, key] of [[() => sessionStorage, SS_KEY], [() => localStorage, LS_KEY]]) {
    try {
      const storage = getStorage()
      const raw = storage.getItem(key)
      if (!raw) continue
      const c = JSON.parse(raw)
      if (isValidConn(c)) return c
      storage.removeItem(key)   // datos corruptos: no dejarlos
    } catch { /* seguir */ }
  }
  return null
}

/** Metadatos sin secret de la última wallet conectada (para UI), o null. */
export function loadMeta() {
  try {
    const raw = localStorage.getItem(LS_META)
    if (!raw) return null
    const m = JSON.parse(raw)
    return (m && /^[0-9a-f]{64}$/.test(m.walletPubkey || '')) ? m : null
  } catch { return null }
}

/** ¿Hay un secret persistido en localStorage (opt-in "recordar")? */
export function isPersisted() {
  try { return !!localStorage.getItem(LS_KEY) } catch { return false }
}

/**
 * Saca del almacenamiento permanente una conexión recordada en una visita
 * anterior: sigue activa en esta pestaña, pero deja de estar escrita. La
 * página lo llama al arrancar mientras no ofrezca "recordar".
 */
export function forgetPersisted() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw && !sessionStorage.getItem(SS_KEY) && isValidConn(JSON.parse(raw))) {
      sessionStorage.setItem(SS_KEY, raw)
    }
  } catch { /* corrupta o almacenamiento bloqueado: se borra igual abajo */ }
  try {
    localStorage.removeItem(LS_KEY)
    localStorage.removeItem(LS_META)
  } catch { /* ignorar */ }
}

/** Borra conexión, persistencia y metadatos. */
export function clear() {
  try { sessionStorage.removeItem(SS_KEY) } catch { /* ignorar */ }
  try {
    localStorage.removeItem(LS_KEY)
    localStorage.removeItem(LS_META)
    localStorage.removeItem(LEGACY_KEY)
  } catch { /* ignorar */ }
}

/** Una sola vez: mover la conexión de la clave legada insegura a la sesión. */
function migrateLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return
    localStorage.removeItem(LEGACY_KEY)
    const c = JSON.parse(raw)
    if (isValidConn(c)) {
      sessionStorage.setItem(SS_KEY, JSON.stringify(c))
      localStorage.setItem(LS_META, JSON.stringify(stripSecret(c)))
    }
  } catch { /* si falla, la clave legada ya se eliminó */ }
}
