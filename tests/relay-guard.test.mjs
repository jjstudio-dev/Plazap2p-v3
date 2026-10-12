// SEC-001 — validateSignedEvent / matchesFilters (js/relay-pool.js)
import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSignedEvent, matchesFilters } from '../js/relay-pool.js'
import { SK1, PK1, signWith, tampered } from './fixtures/events.mjs'

test('evento firmado válido → aceptado', () => {
  const ev = signWith(SK1)
  assert.equal(validateSignedEvent(ev), true)
})

test('firma corrupta → rechazado', () => {
  const ev = signWith(SK1)
  const badSig = (ev.sig[0] === 'f' ? '0' : 'f') + ev.sig.slice(1)
  assert.equal(validateSignedEvent(tampered(ev, { sig: badSig })), false)
})

test('contenido alterado tras firmar → rechazado (id no cuadra)', () => {
  const ev = signWith(SK1)
  assert.equal(validateSignedEvent(tampered(ev, { content: 'otro contenido' })), false)
})

test('id falso → rechazado', () => {
  const ev = signWith(SK1)
  const badId = (ev.id[0] === 'f' ? '0' : 'f') + ev.id.slice(1)
  assert.equal(validateSignedEvent(tampered(ev, { id: badId })), false)
})

test('pubkey suplantada → rechazado', () => {
  const ev = signWith(SK1)
  const otherPk = 'a'.repeat(64)
  assert.equal(validateSignedEvent(tampered(ev, { pubkey: otherPk })), false)
})

test('created_at 1 h en el futuro → rechazado', () => {
  const ev = signWith(SK1, { created_at: Math.floor(Date.now() / 1000) + 3600 })
  assert.equal(validateSignedEvent(ev), false)
})

test('estructura inválida (id no hex, tags no array) → rechazado', () => {
  assert.equal(validateSignedEvent(null), false)
  assert.equal(validateSignedEvent({}), false)
  assert.equal(validateSignedEvent(tampered(signWith(SK1), { id: 'zz' })), false)
  assert.equal(validateSignedEvent(tampered(signWith(SK1), { tags: 'no-array' })), false)
  assert.equal(validateSignedEvent(tampered(signWith(SK1), { tags: [['ok'], [42]] })), false)
})

test('sin caché envenenable: mismo id con contenido alterado sigue rechazado', () => {
  const ev = signWith(SK1)
  // 1) el evento legítimo pasa
  assert.equal(validateSignedEvent(ev), true)
  // 2) un relay reutiliza el MISMO id ya "visto" con contenido alterado —
  //    debe rechazarse (regresión de la caché por id, retirada por insegura)
  assert.equal(validateSignedEvent(tampered(ev, { content: 'alterado' })), false)
  // 3) y el legítimo sigue pasando después de haber visto la copia falsa
  assert.equal(validateSignedEvent(ev), true)
})

test('matchesFilters: kinds y authors', () => {
  const ev = signWith(SK1, { kind: 30402 })
  assert.equal(matchesFilters(ev, [{ kinds: [30402] }]), true)
  assert.equal(matchesFilters(ev, [{ kinds: [1] }]), false)
  assert.equal(matchesFilters(ev, [{ kinds: [1] }, { kinds: [30402], authors: [PK1] }]), true)
  assert.equal(matchesFilters(ev, [{ authors: ['b'.repeat(64)] }]), false)
  assert.equal(matchesFilters(ev, [{ ids: [ev.id] }]), true)
  assert.equal(matchesFilters(ev, []), true)      // sin filtros: pasa
  assert.equal(matchesFilters(ev, null), true)
})

test('matchesFilters: etiquetas — una valoración sobre otra persona no pasa', () => {
  const sobreX = signWith(SK1, { kind: 1985, tags: [['p', PK1], ['L', 'plazap2p.reputation']] })
  const sobreOtro = signWith(SK1, { kind: 1985, tags: [['p', 'b'.repeat(64)], ['L', 'plazap2p.reputation']] })
  const filtro = [{ kinds: [1985], '#p': [PK1], '#L': ['plazap2p.reputation'] }]
  assert.equal(matchesFilters(sobreX, filtro), true)
  assert.equal(matchesFilters(sobreOtro, filtro), false)
  // todas las etiquetas del filtro tienen que encajar, no solo una
  assert.equal(matchesFilters(sobreX, [{ kinds: [1985], '#p': [PK1], '#L': ['otro.espacio'] }]), false)
  // campos que no son condiciones sobre el evento se ignoran
  assert.equal(matchesFilters(sobreX, [{ kinds: [1985], '#p': [PK1], limit: 1 }]), true)
})

test('matchesFilters: since y until', () => {
  const ev = signWith(SK1, { kind: 1, created_at: 1_700_000_000 })
  assert.equal(matchesFilters(ev, [{ since: 1_700_000_000 }]), true)
  assert.equal(matchesFilters(ev, [{ since: 1_700_000_001 }]), false)
  assert.equal(matchesFilters(ev, [{ until: 1_700_000_000 }]), true)
  assert.equal(matchesFilters(ev, [{ until: 1_699_999_999 }]), false)
})
