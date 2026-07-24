// order-tracking.js — BON-010: seguimiento local de una operación
//
// Recordatorio 100% local y manual: el usuario marca "pagado"/"entregado"
// él mismo, nunca se publica a relays ni se infiere de un pago real (un
// pago no prueba entrega — principio del plan maestro). Clave = coordenada
// interna `${pubkey}:${dTag}`, la misma que usa eventKey() en app.js — NO
// el naddr bech32, porque encodeNaddr() puede incluir una lista de relays
// opcional y dos llamadas con relays distintos codifican el mismo anuncio
// en naddrs distintos (ver auditoría del plan, hallazgo 6).

const LS_KEY = 'plazap2p_orders'
export const VALID_STATUSES = ['pendiente', 'pagado', 'entregado', 'cancelado']

function key(pubkey, dTag) {
  return `${String(pubkey || '').toLowerCase()}:${String(dTag || '')}`
}

function readAll() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {}
  } catch { return {} }
}

function writeAll(map) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)) } catch { /* privado/lleno: se pierde, no es crítico */ }
}

/** Marca el estado de una operación. status=null borra la entrada. */
export function setStatus(pubkey, dTag, status) {
  if (!pubkey || !dTag) return
  const all = readAll()
  const k = key(pubkey, dTag)
  if (status == null) {
    delete all[k]
  } else {
    if (!VALID_STATUSES.includes(status)) return
    all[k] = { status, updatedAt: Math.floor(Date.now() / 1000) }
  }
  writeAll(all)
}

/** @returns {{status:string, updatedAt:number}|null} */
export function getStatus(pubkey, dTag) {
  if (!pubkey || !dTag) return null
  return readAll()[key(pubkey, dTag)] || null
}

/** @returns {Array<{pubkey:string, dTag:string, status:string, updatedAt:number}>} */
export function listAll() {
  const all = readAll()
  return Object.entries(all).map(([k, v]) => {
    const sep = k.indexOf(':')
    return { pubkey: k.slice(0, sep), dTag: k.slice(sep + 1), status: v.status, updatedAt: v.updatedAt }
  })
}
