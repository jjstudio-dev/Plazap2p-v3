// Fixtures de eventos Nostr firmados para los tests (TST-001).
// Usa el mismo bundle criptográfico que la app (nostr-tools pineado), así
// los tests verifican exactamente lo que verificará el cliente.

import { finalizeEvent, getPublicKey } from '../../js/vendor/nostr-crypto.js'

// Claves deterministas SOLO para tests — nunca usar fuera de aquí.
export const SK1 = Uint8Array.from({ length: 32 }, (_, i) => i + 1)
export const SK2 = Uint8Array.from({ length: 32 }, (_, i) => i + 101)
export const PK1 = getPublicKey(SK1)
export const PK2 = getPublicKey(SK2)

/**
 * Firma un evento con la clave dada. Devuelve el evento completo (id+sig)
 * COMO LLEGA POR LA RED: pasado por JSON. Importante: finalizeEvent marca el
 * objeto con un Symbol interno de "verificado" que verifyEvent usa como
 * atajo; el clon JSON lo elimina, igual que hace un relay real.
 */
export function signWith(sk, {
  kind = 30402,
  created_at = Math.floor(Date.now() / 1000),
  tags = [['d', 'test-fixture-1'], ['t', 'plazap2p']],
  content = 'contenido de prueba',
} = {}) {
  return JSON.parse(JSON.stringify(finalizeEvent({ kind, created_at, tags, content }, sk)))
}

/** Copia plana de un evento con campos sobreescritos (para adulterar). */
export function tampered(ev, overrides) {
  return JSON.parse(JSON.stringify({ ...ev, ...overrides }))
}
