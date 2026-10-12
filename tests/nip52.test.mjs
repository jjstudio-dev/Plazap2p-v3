// PROT-001 — eventos de calendario NIP-52 (js/publish-builders.js)
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEvento, nip52DayTags } from '../js/publish-builders.js'
import { PK1 } from './fixtures/events.mjs'

const base = { title: 'Meetup Bitcoin', desc: 'Charla y networking sobre Bitcoin y Nostr.' }
const tag = (ev, name) => ev.tags.find(t => t[0] === name)?.[1]

test('todo el día → kind 31922 con start ISO', () => {
  const r = buildEvento({ ...base, allDay: true, startDate: '2026-08-01' }, PK1)
  assert.equal(r.ok, true)
  assert.equal(r.unsignedEvent.kind, 31922)
  assert.equal(tag(r.unsignedEvent, 'start'), '2026-08-01')
  assert.equal(tag(r.unsignedEvent, 'start_tzid'), undefined)
})

test('todo el día con fin válido → tag end; fin ≤ inicio → error', () => {
  const ok = buildEvento({ ...base, allDay: true, startDate: '2026-08-01', endDate: '2026-08-03' }, PK1)
  assert.equal(tag(ok.unsignedEvent, 'end'), '2026-08-03')
  const bad = buildEvento({ ...base, allDay: true, startDate: '2026-08-03', endDate: '2026-08-01' }, PK1)
  assert.equal(bad.ok, false)
})

test('todo el día sin fecha o con formato no ISO → error', () => {
  assert.equal(buildEvento({ ...base, allDay: true }, PK1).ok, false)
  assert.equal(buildEvento({ ...base, allDay: true, startDate: '1754040000' }, PK1).ok, false)
})

test('con hora → kind 31923 con start Unix y start_tzid', () => {
  const r = buildEvento({ ...base, allDay: false, dateTs: 1785542400, tzid: 'Europe/Madrid' }, PK1)
  assert.equal(r.ok, true)
  assert.equal(r.unsignedEvent.kind, 31923)
  assert.equal(tag(r.unsignedEvent, 'start'), '1785542400')
  assert.equal(tag(r.unsignedEvent, 'start_tzid'), 'Europe/Madrid')
})

test('con hora: fin posterior → end; fin anterior → error; sin fecha → error', () => {
  const ok = buildEvento({ ...base, allDay: false, dateTs: 1785542400, endTs: 1785546000 }, PK1)
  assert.equal(tag(ok.unsignedEvent, 'end'), '1785546000')
  assert.equal(buildEvento({ ...base, allDay: false, dateTs: 1785542400, endTs: 100 }, PK1).ok, false)
  assert.equal(buildEvento({ ...base, allDay: false }, PK1).ok, false)
})

// Ronda 2: NIP-52 pide una etiqueta D por día UTC cubierto en los eventos con
// hora. Lo detectó el contrato con Android (BuildersContractTest.kt), que sí
// las ponía.
test('con hora → una etiqueta D por cada día UTC que cubre el evento (end exclusivo)', () => {
  const dias = r => r.unsignedEvent.tags.filter(t => t[0] === 'D').map(t => t[1])
  const DIA = 86400
  const inicio = 20_000 * DIA + 3600                       // 01:00 UTC del día 20000
  assert.deepEqual(dias(buildEvento({ ...base, allDay: false, dateTs: inicio }, PK1)), ['20000'], 'sin fin: solo su día')
  assert.deepEqual(dias(buildEvento({ ...base, allDay: false, dateTs: inicio, endTs: inicio + 7200 }, PK1)), ['20000'])
  assert.deepEqual(dias(buildEvento({ ...base, allDay: false, dateTs: inicio, endTs: 20_002 * DIA + 10 }, PK1)), ['20000', '20001', '20002'])
  assert.deepEqual(dias(buildEvento({ ...base, allDay: false, dateTs: inicio, endTs: 20_001 * DIA }, PK1)), ['20000'],
    'termina justo a medianoche: el día siguiente no está cubierto')
  assert.deepEqual(nip52DayTags(inicio, inicio + 5000 * DIA).length, 366, 'un evento de años no genera miles de etiquetas')
  // Los eventos de día completo (31922) no llevan D: su fecha ya es el día.
  assert.deepEqual(dias(buildEvento({ ...base, allDay: true, startDate: '2026-08-01' }, PK1)), [])
})

test('tzid con caracteres extraños se omite (no rompe el evento)', () => {
  const r = buildEvento({ ...base, allDay: false, dateTs: 1785542400, tzid: '<script>' }, PK1)
  assert.equal(r.ok, true)
  assert.equal(tag(r.unsignedEvent, 'start_tzid'), undefined)
})

test('nunca se genera 31922 con timestamp Unix (regresión del bug)', () => {
  const allDay = buildEvento({ ...base, allDay: true, startDate: '2026-08-01' }, PK1)
  assert.match(tag(allDay.unsignedEvent, 'start'), /^\d{4}-\d{2}-\d{2}$/)
  const timed = buildEvento({ ...base, allDay: false, dateTs: 1785542400 }, PK1)
  assert.notEqual(timed.unsignedEvent.kind, 31922)
})

test('edición conserva d y published_at originales', () => {
  const r = buildEvento({ ...base, allDay: false, dateTs: 1785542400 }, PK1, 'd-existente', 1700000000)
  assert.equal(r.dTag, 'd-existente')
  assert.equal(tag(r.unsignedEvent, 'd'), 'd-existente')
  assert.equal(tag(r.unsignedEvent, 'published_at'), '1700000000')
})
