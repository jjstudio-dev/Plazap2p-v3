// publish-utils — validación de URLs y saneado del contacto que acaban dentro
// de un evento firmado y público. Sin tests hasta la ronda 2: una prueba de
// mutación quitó la comprobación de esquema de validateUrl() y nada falló.
import test from 'node:test'
import assert from 'node:assert/strict'
import { validateUrl, sanitizeContact, parseEventDate, formatStars } from '../js/publish-utils.js'
import { buildComunidad, buildHerramienta, buildServicio } from '../js/publish-builders.js'
import { PK1 } from './fixtures/events.mjs'

test('validateUrl: solo http(s), sin usuario@ y con forma de URL', () => {
  assert.equal(validateUrl('https://ejemplo.test/a?b=1'), 'https://ejemplo.test/a?b=1')
  assert.equal(validateUrl('  https://ejemplo.test  '), 'https://ejemplo.test/')
  for (const mala of [
    'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x',
    'file:///etc/passwd', 'ftp://ejemplo.test/a', 'nostr:npub1xyz', 'intent://x#Intent;scheme=http;end',
    'https://usuario@ejemplo.test/', 'https://usuario:clave@ejemplo.test/', 'https://legit.com@evil.test/',
    'ejemplo.test', '//ejemplo.test', '', null, undefined,
  ]) {
    assert.equal(validateUrl(mala), null, String(mala))
  }
})

test('los builders nunca publican una URL con esquema ejecutable', () => {
  const DESC = 'Descripción suficientemente larga para validar.'
  const urls = ev => ev.tags.filter(t => t[0] === 'r' || t[0] === 'image').map(t => t[1])
  const com = buildComunidad({ title: 'Grupo', desc: DESC, accessUrl: 'javascript:alert(1)', imageUrl: 'data:text/html,x' }, PK1)
  const her = buildHerramienta({ title: 'Herramienta', desc: DESC, officialUrl: 'javascript:alert(1)', imageUrl: 'vbscript:x' }, PK1)
  const ser = buildServicio({ title: 'Servicio', desc: DESC, imageUrl: 'javascript:alert(1)' }, PK1)
  for (const built of [com, her, ser]) {
    assert.equal(built.ok, true)
    assert.deepEqual(urls(built.unsignedEvent), [])
  }
})

test('sanitizeContact: quita enlaces y acortadores, conserva alias, correo y npub', () => {
  for (const ok of ['@usuario', 'ana@correo.test', 'npub1abcdef', 'Telegram: @ana · Signal: ana.01']) {
    assert.equal(sanitizeContact(ok), ok)
  }
  for (const [entrada, prohibido] of [
    ['escribe a https://t.me/estafa', 't.me'], ['http://phishing.test/login', 'phishing'], ['wss://relay.test/x', 'relay.test'],
    ['nostr:npub1xyz', 'npub1xyz'], ['t.me/estafa', 't.me/'], ['discord.gg/abc', 'discord.gg/'], ['wa.me/34600111222', 'wa.me/'],
    ['bit.ly/x1', 'bit.ly/'], ['linktr.ee/yo', 'linktr.ee/'], ['HTTPS://MAYUS.test/a', 'MAYUS'],
    ['paga en evil.com/pago', 'evil.com'], ['www.evil.com', 'evil.com'], ['WWW.Evil.Com/x', 'evil'],
    ['mi tienda sub.dominio.example/checkout?id=1', 'dominio.example'],
  ]) {
    const out = sanitizeContact(entrada)
    assert.ok(!out.toLowerCase().includes(prohibido.toLowerCase()), `${entrada} → ${out}`)
  }
  assert.equal(sanitizeContact('línea 1\r\nlínea 2'), 'línea 1 línea 2', 'sin saltos de línea')
  assert.equal(sanitizeContact('x'.repeat(500)).length, 200)
  assert.equal(sanitizeContact(''), null)
  assert.equal(sanitizeContact(null), null)
})

test('parseEventDate y formatStars', () => {
  assert.equal(parseEventDate('2025-07-12T18:00Z'), Math.floor(Date.parse('2025-07-12T18:00Z') / 1000))
  assert.equal(parseEventDate('no es fecha'), null)
  assert.equal(parseEventDate(''), null)
  assert.equal(formatStars(3), '⭐⭐⭐☆☆')
  assert.equal(formatStars(99), '⭐⭐⭐⭐⭐')
  assert.equal(formatStars(-2), '☆☆☆☆☆')
})
