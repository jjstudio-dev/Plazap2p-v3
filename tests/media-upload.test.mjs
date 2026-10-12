// MED-001 (Blossom, BUD-01/02) — solo las partes puras/deterministas: hash,
// construcción del evento de autorización y validación. uploadBlob()/
// uploadImage() hacen fetch a un servidor real y no se prueban aquí (igual
// que el resto del proyecto no simula relays reales en los tests unitarios).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateFile, sha256Hex, buildBlossomAuthEvent, utf8ToBase64, MAX_BYTES, ALLOWED_TYPES,
} from '../js/media-upload.js'
import { PK1 } from './fixtures/events.mjs'

test('validateFile: tamaño, tipo y archivo vacío', () => {
  assert.equal(validateFile({ size: 1000, type: 'image/png' }), null)
  assert.equal(validateFile(null), 'archivo vacío o inválido')
  assert.equal(validateFile({ size: 0, type: 'image/png' }), 'archivo vacío o inválido')
  assert.equal(validateFile({ size: -5, type: 'image/png' }), 'archivo vacío o inválido')
  assert.ok(validateFile({ size: MAX_BYTES + 1, type: 'image/png' })?.includes('grande'))
  assert.ok(validateFile({ size: 1000, type: 'application/pdf' })?.includes('no admitido'))
})

test('validateFile: límites/tipos personalizados', () => {
  assert.equal(validateFile({ size: 500, type: 'image/gif' }, { maxBytes: 1000, allowedTypes: ['image/gif'] }), null)
  assert.ok(validateFile({ size: 500, type: 'image/png' }, { allowedTypes: ['image/gif'] })?.includes('no admitido'))
})

test('ALLOWED_TYPES incluye los formatos web habituales', () => {
  for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
    assert.ok(ALLOWED_TYPES.includes(t))
  }
})

test('sha256Hex: vector conocido (SHA-256 de "abc")', async () => {
  const buf = new TextEncoder().encode('abc').buffer
  const hex = await sha256Hex(buf)
  assert.equal(hex, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('buildBlossomAuthEvent: kind 24242, tags x/t/expiration correctos', () => {
  const ev = buildBlossomAuthEvent('a'.repeat(64), PK1)
  assert.equal(ev.kind, 24242)
  assert.equal(ev.pubkey, PK1)
  assert.deepEqual(ev.tags[0], ['t', 'upload'])
  assert.deepEqual(ev.tags[1], ['x', 'a'.repeat(64)])
  const exp = Number(ev.tags[2][1])
  assert.equal(ev.tags[2][0], 'expiration')
  assert.ok(exp > ev.created_at && exp <= ev.created_at + 300)
})

test('buildBlossomAuthEvent: normaliza el hash a minúsculas', () => {
  const ev = buildBlossomAuthEvent('A'.repeat(64), PK1)
  assert.equal(ev.tags[1][1], 'a'.repeat(64))
})

test('utf8ToBase64: round-trip con acentos/emoji (no solo ASCII)', () => {
  const original = '{"content":"Publicación con acentos y emoji 📢"}'
  const decoded = Buffer.from(utf8ToBase64(original), 'base64').toString('utf8')
  assert.equal(decoded, original)
})

// W3-02 — lo que se sube es la imagen redibujada, no el archivo original (que
// puede llevar dentro el lugar, la fecha y el modelo de teléfono).
test('uploadImage: sube la imagen redibujada, y el hash autorizado es el suyo', async (t) => {
  const { uploadImage } = await import('../js/media-upload.js')
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const sent = []
  globalThis.fetch = async (url, init) => { sent.push(init); return { ok: true, json: async () => ({ url: 'https://blossom.test/abc' }) } }

  const originalFile = new Blob(['FOTO-CON-GPS-SECRETO'], { type: 'image/jpeg' })
  const clean = new Blob(['solo-pixeles'], { type: 'image/jpeg' })
  let signedHash = null
  const sign = async unsigned => { signedHash = unsigned.tags.find(tag => tag[0] === 'x')[1]; return { ...unsigned, id: 'i', sig: 's' } }

  const url = await uploadImage(originalFile, PK1, sign, 'https://blossom.test', { reencode: async () => clean })

  assert.equal(url, 'https://blossom.test/abc')
  assert.equal(sent.length, 1)
  assert.equal(await sent[0].body.text(), 'solo-pixeles', 'no se envía el archivo original')
  assert.equal(signedHash, await sha256Hex(await clean.arrayBuffer()))
})

test('uploadImage: si la imagen no se puede redibujar, no se sube nada', async (t) => {
  const { uploadImage } = await import('../js/media-upload.js')
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let fetched = 0
  globalThis.fetch = async () => { fetched++; return { ok: true, json: async () => ({ url: 'x' }) } }
  const file = new Blob(['x'], { type: 'image/jpeg' })
  await assert.rejects(uploadImage(file, PK1, async u => u, 'https://blossom.test', { reencode: async () => { throw new Error('no se pudo procesar la imagen') } }))
  assert.equal(fetched, 0)
})
