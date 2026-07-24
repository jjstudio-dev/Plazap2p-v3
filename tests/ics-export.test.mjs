// ics-export.test.mjs — BON-006
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildIcs } from '../js/ics-export.js'

const NOW = 1721304000 // fijo, para DTSTAMP determinista

test('evento 31923 (con hora): DTSTART/DTEND en UTC con sufijo Z', () => {
  const ev = {
    kind: 31923, title: 'Meetup Bitcoin', summary: 'Charla mensual', location: 'Madrid',
    start: { ts: 1721304000, date: new Date(1721304000000) },
    end: { ts: 1721310000, date: new Date(1721310000000) },
    naddr: 'naddr1abc', links: ['https://example.com'],
  }
  const ics = buildIcs(ev, NOW)
  assert.match(ics, /BEGIN:VCALENDAR/)
  assert.match(ics, /DTSTART:\d{8}T\d{6}Z/)
  assert.match(ics, /DTEND:\d{8}T\d{6}Z/)
  assert.match(ics, /SUMMARY:Meetup Bitcoin/)
  assert.match(ics, /LOCATION:Madrid/)
  assert.match(ics, /UID:naddr1abc@plazap2p/)
  assert.match(ics, /URL:https:\/\/example\.com/)
  assert.doesNotMatch(ics, /VALUE=DATE/)
})

test('evento 31922 (todo el día): VALUE=DATE y DTEND exclusivo (+1 día)', () => {
  const start = new Date(2026, 6, 18, 12, 0, 0) // 18 julio 2026, mediodía local
  const ev = { kind: 31922, title: 'Feria local', summary: '', location: '', start: { ts: Math.floor(start.getTime() / 1000), date: start }, end: null, naddr: 'naddr1xyz', links: [] }
  const ics = buildIcs(ev, NOW)
  assert.match(ics, /DTSTART;VALUE=DATE:20260718/)
  assert.match(ics, /DTEND;VALUE=DATE:20260719/)
})

test('evento sin end: no emite DTEND (evento con hora)', () => {
  const ev = { kind: 31923, title: 'Sin fin', summary: '', location: '', start: { ts: 1721304000, date: new Date(1721304000000) }, end: null, naddr: 'naddr1noend', links: [] }
  const ics = buildIcs(ev, NOW)
  assert.doesNotMatch(ics, /\r\nDTEND[:;]/)
})

test('escape de caracteres especiales en el orden correcto (backslash, coma, punto y coma, salto de línea)', () => {
  const ev = {
    kind: 31923, title: 'A\\B, C; D\nE', summary: '', location: '',
    start: { ts: 1721304000, date: new Date(1721304000000) }, end: null, naddr: 'naddr1esc', links: [],
  }
  const ics = buildIcs(ev, NOW)
  assert.match(ics, /SUMMARY:A\\\\B\\, C\\; D\\nE/)
})

test('SUMMARY largo (>75 octetos) se pliega con continuación de un espacio', () => {
  const longTitle = 'x'.repeat(120)
  const ev = { kind: 31923, title: longTitle, summary: '', location: '', start: { ts: 1721304000, date: new Date(1721304000000) }, end: null, naddr: 'naddr1long', links: [] }
  const ics = buildIcs(ev, NOW)
  const summaryLineRaw = ics.split('\r\n').find(l => l.startsWith('SUMMARY:'))
  assert.ok(new TextEncoder().encode(summaryLineRaw).length <= 75, 'primera línea de SUMMARY debe caber en 75 octetos')
  // la continuación debe empezar con un espacio
  const idx = ics.indexOf('SUMMARY:')
  const afterFirstFold = ics.slice(idx).split('\r\n')[1]
  assert.equal(afterFirstFold[0], ' ')
})

test('UID estable entre dos llamadas al mismo evento', () => {
  const ev = { kind: 31923, title: 'Estable', summary: '', location: '', start: { ts: 1721304000, date: new Date(1721304000000) }, end: null, naddr: 'naddr1stable', links: [] }
  const ics1 = buildIcs(ev, NOW)
  const ics2 = buildIcs(ev, NOW + 3600)
  const uid1 = ics1.match(/UID:(\S+)/)[1]
  const uid2 = ics2.match(/UID:(\S+)/)[1]
  assert.equal(uid1, uid2)
})

test('multibyte (acentos) no rompe el plegado de línea', () => {
  const ev = { kind: 31923, title: 'á'.repeat(100), summary: '', location: '', start: { ts: 1721304000, date: new Date(1721304000000) }, end: null, naddr: 'naddr1accents', links: [] }
  const ics = buildIcs(ev, NOW)
  for (const l of ics.split('\r\n')) {
    assert.ok(new TextEncoder().encode(l).length <= 75, `línea excede 75 octetos: "${l}"`)
  }
  // reconstruir el texto plegado y comprobar que no se corrompió ningún carácter
  const summaryLines = []
  const raw = ics.split('\r\n')
  let capturing = false
  for (const l of raw) {
    if (l.startsWith('SUMMARY:')) { capturing = true; summaryLines.push(l.slice('SUMMARY:'.length)); continue }
    if (capturing && l.startsWith(' ')) { summaryLines.push(l.slice(1)); continue }
    if (capturing) break
  }
  assert.equal(summaryLines.join(''), 'á'.repeat(100))
})
