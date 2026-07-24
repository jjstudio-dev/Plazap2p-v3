// notify.test.mjs — BON-011 (alcance MVP)
import test from 'node:test'
import assert from 'node:assert/strict'
import { isSupported, permissionState, requestPermission, notify } from '../js/notify.js'

test('sin Notification global (entorno no soportado): isSupported=false, permissionState=unsupported, notify no lanza', () => {
  delete globalThis.Notification
  assert.equal(isSupported(), false)
  assert.equal(permissionState(), 'unsupported')
  assert.equal(notify('título', {}), null)
})

test('requestPermission sin soporte devuelve "unsupported" sin lanzar', async () => {
  delete globalThis.Notification
  assert.equal(await requestPermission(), 'unsupported')
})

test('con Notification global: permissionState refleja Notification.permission', () => {
  class FakeNotification {
    constructor(title, options) { this.title = title; this.options = options }
    static permission = 'granted'
    static requestPermission = async () => 'granted'
  }
  globalThis.Notification = FakeNotification
  assert.equal(isSupported(), true)
  assert.equal(permissionState(), 'granted')
})

test('notify() con permiso granted crea una Notification; sin permiso, no', () => {
  let created = null
  class FakeNotification {
    constructor(title, options) { created = { title, options } }
    static permission = 'granted'
  }
  globalThis.Notification = FakeNotification
  const n = notify('🔔 Nuevo anuncio', { body: 'detalle' })
  assert.ok(n)
  assert.equal(created.title, '🔔 Nuevo anuncio')
  assert.equal(created.options.body, 'detalle')

  created = null
  FakeNotification.permission = 'default'
  const n2 = notify('otro', {})
  assert.equal(n2, null)
  assert.equal(created, null)
})

test('requestPermission() con soporte devuelve el resultado de Notification.requestPermission()', async () => {
  class FakeNotification {
    static permission = 'default'
    static requestPermission = async () => 'denied'
  }
  globalThis.Notification = FakeNotification
  assert.equal(await requestPermission(), 'denied')
})

test('notify() nunca lanza aunque el constructor falle', () => {
  class ThrowingNotification {
    static permission = 'granted'
    constructor() { throw new Error('boom') }
  }
  globalThis.Notification = ThrowingNotification
  assert.doesNotThrow(() => notify('x', {}))
})

test.after(() => { delete globalThis.Notification })
