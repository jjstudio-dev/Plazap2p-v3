// js/vendor/nostr-crypto.js es TODA la criptografía de la app (firmas,
// verificación de eventos, cifrado de la wallet). Es un bundle minificado que
// nadie lee en una revisión: este test detecta cualquier cambio en él y
// comprueba contra vectores públicos que sigue haciendo lo que debe.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { verifyEvent, finalizeEvent, getPublicKey, nip44 } from '../js/vendor/nostr-crypto.js'

const hex = h => Uint8Array.from(h.match(/.{2}/g).map(b => parseInt(b, 16)))
const toHex = b => Buffer.from(b).toString('hex')

test('el bundle es byte a byte el que declara su propia cabecera', () => {
  const src = readFileSync(new URL('../js/vendor/nostr-crypto.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const lines = src.split('\n')
  const declared = /sha256[^:]*: ([0-9a-f]{64})/.exec(lines.slice(0, 4).join('\n'))?.[1]
  assert.ok(declared, 'la cabecera debe declarar el sha256 del payload')
  const real = createHash('sha256').update(lines.slice(4).join('\n')).digest('hex')
  assert.equal(real, declared, 'el bundle criptográfico ha cambiado: si es intencionado, regenéralo y actualiza la cabecera')
})

test('BIP-340: clave pública del vector oficial 0', () => {
  assert.equal(getPublicKey(hex('0000000000000000000000000000000000000000000000000000000000000003')),
    'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9')
})

test('NIP-01: el id es el sha256 de la serialización canónica y cualquier cambio invalida la firma', () => {
  const ev = JSON.parse(JSON.stringify(finalizeEvent({ kind: 1, created_at: 1_700_000_000, tags: [['t', 'x']], content: 'hola' }, hex('01'.repeat(32)))))
  const ser = JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content])
  assert.equal(createHash('sha256').update(ser).digest('hex'), ev.id)
  assert.equal(verifyEvent(JSON.parse(JSON.stringify(ev))), true)
  for (const [campo, valor] of [['content', 'adiós'], ['created_at', 1_700_000_001], ['kind', 2], ['tags', []],
    ['pubkey', 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9'], ['id', 'a'.repeat(64)]]) {
    assert.equal(verifyEvent({ ...JSON.parse(JSON.stringify(ev)), [campo]: valor }), false, `${campo} alterado`)
  }
  const sig = ev.sig.slice(0, -2) + (ev.sig.endsWith('00') ? '01' : '00')
  assert.equal(verifyEvent({ ...JSON.parse(JSON.stringify(ev)), sig }), false, 'firma alterada')
})

test('NIP-44 v2: clave de conversación del vector oficial, simetría y rechazo de manipulación', () => {
  const ck = nip44.getConversationKey(hex('315e59ff51cb9209768cf7da80791ddcaae56ac9775eb25b6dee1234bc5d2268'),
    'c2f9d9948dc8c7c38321e4b85c8558872eafa0641cd269db76848a6073e69133')
  assert.equal(toHex(ck), '3dfef0ce2a4d80a25e7a328accf73448ef67096f65f79588e358d9a0eb9013f1')

  const [a, b] = [hex('02'.repeat(32)), hex('03'.repeat(32))]
  const [k1, k2] = [nip44.getConversationKey(a, getPublicKey(b)), nip44.getConversationKey(b, getPublicKey(a))]
  assert.equal(toHex(k1), toHex(k2))
  const ct = nip44.encrypt('mensaje ñ €', k1)
  assert.equal(nip44.decrypt(ct, k2), 'mensaje ñ €')
  const raw = Buffer.from(ct, 'base64'); raw[40] ^= 1
  assert.throws(() => nip44.decrypt(raw.toString('base64'), k2), 'el MAC debe detectar un texto cifrado manipulado')
})
