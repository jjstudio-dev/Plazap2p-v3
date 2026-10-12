// Doble de RelayPool para probar las consultas puntuales sin red: simula
// VARIOS relays que entregan eventos y EOSE en el orden que decida el test.

export function fakePool(relayUrls = ['wss://a', 'wss://b']) {
  const subs = new Map()
  return {
    subs,
    live: new Set(relayUrls),          // relays de los que aún se espera respuesta
    get expectedCount() { return this.live.size },
    subscribe(id, filters, handlers = {}) {
      subs.set(id, { filters, ...handlers })
      this.onSubscribe?.(id, filters, handlers)
    },
    unsubscribe(id) { subs.delete(id) },
    /** Un relay entrega un evento a todas las suscripciones abiertas. */
    emit(ev, url) { for (const s of [...subs.values()]) s.onEvent?.(ev, url) },
    /** Un relay termina de enviar lo almacenado. */
    eose(url) { for (const s of [...subs.values()]) s.onEose?.(url) },
    /** Un relay se cae a mitad de consulta. */
    drop(url) { this.live.delete(url) },
  }
}

/**
 * Hace que el pool conteste solo a las consultas de ANTIGÜEDAD de valoradores
 * (filtros { authors:[x], until, limit:1 } de reputacion.js): cada autor de
 * `veteranos` (o todos, si no se indica) tiene un evento anterior al corte.
 * Las demás suscripciones siguen bajo control manual del test.
 */
export function answerRaterAge(pool, veteranos = null) {
  pool.onSubscribe = (_id, filters, handlers) => {
    if (!filters.every(f => Array.isArray(f.authors) && typeof f.until === 'number')) return
    queueMicrotask(() => {
      for (const f of filters) {
        const author = f.authors[0]
        if (veteranos && !veteranos.includes(author)) continue
        handlers.onEvent?.({ kind: 1, pubkey: author, created_at: f.until - 1000, content: '', tags: [] }, [...pool.live][0])
      }
      for (const url of pool.live) handlers.onEose?.(url)
    })
  }
  return pool
}

/** Deja correr microtareas y timers ya vencidos. */
export const flush = (ms = 0) => new Promise(r => setTimeout(r, ms))
