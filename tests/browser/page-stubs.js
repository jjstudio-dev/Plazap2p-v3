// Dobles que el arnés inyecta en la página ANTES de cualquier script de la app
// (Page.addScriptToEvaluateOnNewDocument). Script clásico, no módulo.
// Lee su configuración de window.__scenario (JSON puesto por harness.mjs).
//
//   scenario.events        eventos Nostr ya firmados que "existen en la red"
//   scenario.eventsByLoad  [[…], […]] lo mismo, pero distinto en cada recarga
//   scenario.storage       'quota' (no se puede escribir) | 'denied' (ni leer)
//   scenario.relays        { [url | '*']: { mode, delayMs, only, without, rawEvents, rawFrames, ... } }
//   scenario.fetch         [{ match, status, json, text, delayMs, fail, hang }]
//   scenario.localStorage  { clave: valor } sembrado una sola vez por pestaña
//   scenario.nip07         { sk: hex, behavior: 'ok'|'reject'|'tamper' }
//   scenario.dialogs       { confirm: bool, prompt: string|null }
(() => {
  if (window.__stubsInstalled) return
  window.__stubsInstalled = true
  const S = window.__scenario || {}

  // ── Registro observable desde las pruebas ────────────────────────────────
  window.__xss = []          // cualquier carga hostil que llegue a ejecutarse escribe aquí
  window.__published = []    // EVENT enviados por la app a los relays
  window.__reqs = []         // REQ enviados por la app
  window.__dialogs = []
  window.__fetchLog = []
  window.__opened = []
  window.__clipboard = []
  window.__signed = []

  // ── Diálogos nativos: nunca bloquear la página ───────────────────────────
  const dlg = S.dialogs || {}
  window.alert = m => { window.__dialogs.push({ type: 'alert', message: String(m) }) }
  window.confirm = m => { window.__dialogs.push({ type: 'confirm', message: String(m) }); return dlg.confirm !== false }
  window.prompt = m => { window.__dialogs.push({ type: 'prompt', message: String(m) }); return dlg.prompt ?? null }
  window.open = u => { window.__opened.push(String(u)); return null }
  try {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async t => { window.__clipboard.push(String(t)) }, readText: async () => '' },
    })
  } catch { /* contexto sin clipboard */ }

  // ── Número de carga de esta pestaña (0 = primera; sube con cada recarga) ─
  let loadIndex = 0
  try {
    loadIndex = Number(sessionStorage.getItem('__loads') || 0)
    sessionStorage.setItem('__loads', String(loadIndex + 1))
  } catch { /* almacenamiento no disponible */ }
  window.__loadIndex = loadIndex

  // ── Almacenamiento averiado: lleno (no se puede escribir) o denegado ─────
  if (S.storage === 'quota') {
    Storage.prototype.setItem = function () { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError') }
  } else if (S.storage === 'denied') {
    const denied = () => { throw new DOMException('Access is denied for this document.', 'SecurityError') }
    Object.defineProperty(window, 'localStorage', { configurable: true, get: denied })
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: denied })
  }

  // ── localStorage sembrado (una vez por pestaña: sobrevive a un reload) ───
  try {
    if (S.localStorage && !sessionStorage.getItem('__seeded')) {
      for (const [k, v] of Object.entries(S.localStorage)) {
        localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
      }
      sessionStorage.setItem('__seeded', '1')
    }
    if (S.sessionStorage && !sessionStorage.getItem('__seededSession')) {
      for (const [k, v] of Object.entries(S.sessionStorage)) {
        sessionStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
      }
      sessionStorage.setItem('__seededSession', '1')
    }
  } catch { /* almacenamiento no disponible en about:blank */ }

  // ── Relay simulado ───────────────────────────────────────────────────────
  // eventsByLoad: lo que hay en la red en cada carga de la página (la última
  // lista vale para las siguientes) — permite que algo "desaparezca" entre
  // una visita y la siguiente.
  const byLoad = Array.isArray(S.eventsByLoad) ? S.eventsByLoad[Math.min(loadIndex, S.eventsByLoad.length - 1)] : null
  const store = (byLoad || S.events || []).slice()
  const relayCfg = S.relays || {}
  const sockets = new Set()

  function matchFilter(ev, f) {
    if (!f || typeof f !== 'object') return false
    if (Array.isArray(f.kinds) && !f.kinds.includes(ev.kind)) return false
    if (Array.isArray(f.authors) && !f.authors.includes(ev.pubkey)) return false
    if (Array.isArray(f.ids) && !f.ids.includes(ev.id)) return false
    if (typeof f.since === 'number' && ev.created_at < f.since) return false
    if (typeof f.until === 'number' && ev.created_at > f.until) return false
    for (const [k, vals] of Object.entries(f)) {
      if (k[0] !== '#' || !Array.isArray(vals)) continue
      const name = k.slice(1)
      if (!(ev.tags || []).some(t => t[0] === name && vals.includes(t[1]))) return false
    }
    return true
  }
  const matchAny = (ev, filters) => filters.some(f => matchFilter(ev, f))

  class FakeWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    constructor(url) {
      this.url = String(url)
      this.readyState = 0
      this.subs = new Map()
      this._listeners = {}
      this.cfg = relayCfg[this.url] || relayCfg['*'] || {}
      sockets.add(this)
      const cfg = this.cfg
      if (cfg.mode === 'hang') return   // nunca termina de conectar
      setTimeout(() => {
        if (this.readyState !== 0) return
        if (cfg.mode === 'down') { this.readyState = 3; sockets.delete(this); this._fire('error', {}); this._fire('close', {}); return }
        this.readyState = 1
        this._fire('open', {})
        if (cfg.dropAfterMs != null) setTimeout(() => this._drop(), cfg.dropAfterMs)
      }, cfg.connectMs ?? 5)
    }
    addEventListener(type, fn) { (this._listeners[type] ||= new Set()).add(fn) }
    removeEventListener(type, fn) { this._listeners[type]?.delete(fn) }
    _fire(type, ev) {
      try { this['on' + type]?.(ev) } catch (e) { console.error('[fake-relay] handler on' + type, e) }
      for (const fn of this._listeners[type] || []) { try { fn(ev) } catch (e) { console.error('[fake-relay] listener ' + type, e) } }
    }
    _emit(msg) {
      if (this.readyState !== 1) return
      this._fire('message', { data: typeof msg === 'string' ? msg : JSON.stringify(msg) })
    }
    _drop() {
      if (this.readyState === 3) return
      this.readyState = 3
      sockets.delete(this)
      this._fire('close', {})
    }
    _visible(ev) {
      const cfg = this.cfg
      if (Array.isArray(cfg.only) && !cfg.only.includes(ev.id)) return false
      if (Array.isArray(cfg.without) && cfg.without.includes(ev.id)) return false
      return true
    }
    send(data) {
      if (this.readyState !== 1) throw new Error('WebSocket is not open')
      let msg
      try { msg = JSON.parse(data) } catch { return }
      const cfg = this.cfg
      if (msg[0] === 'REQ') {
        const [, subId, ...filters] = msg
        window.__reqs.push({ url: this.url, subId, filters })
        this.subs.set(subId, filters)
        if (cfg.mode === 'silent') return
        // Si hay wallet simulada, esperar a que haya publicado su evento info.
        Promise.resolve(window.__walletReady).then(() => setTimeout(() => {
          if (!this.subs.has(subId)) return
          for (const frame of cfg.rawFrames || []) this._emit(String(frame).replaceAll('$SUB', subId))
          for (const raw of cfg.rawEvents || []) this._emit(['EVENT', subId, raw])
          let matched = store.filter(ev => this._visible(ev) && matchAny(ev, filters))
          if (cfg.reverse) matched = matched.slice().reverse()
          for (const ev of matched) this._emit(['EVENT', subId, ev])
          if (cfg.closed) this._emit(['CLOSED', subId, String(cfg.closed)])
          else if (!cfg.noEose) { this._emit(['EOSE', subId]); if (cfg.dupEose) this._emit(['EOSE', subId]) }
        }, cfg.delayMs ?? 5))
      } else if (msg[0] === 'CLOSE') {
        this.subs.delete(msg[1])
      } else if (msg[0] === 'EVENT') {
        const event = msg[1]
        window.__published.push({ url: this.url, event })
        if (cfg.noOk) return
        setTimeout(() => {
          if (cfg.rejectPublish) { this._emit(['OK', event.id, false, String(cfg.rejectPublish)]); return }
          if (!store.some(e => e.id === event.id)) store.push(event)
          this._emit(['OK', event.id, true, ''])
          window.__relay.deliver(event)
          Promise.resolve(window.__relay.onPublish?.(event, this)).catch(e => console.error('[fake-relay] onPublish', e))
        }, cfg.okDelayMs ?? 5)
      }
    }
    close() {
      if (this.readyState === 3) return
      this.readyState = 3
      sockets.delete(this)
      setTimeout(() => this._fire('close', {}), 0)
    }
  }
  window.WebSocket = FakeWebSocket

  window.__relay = {
    store,
    onPublish: null,
    /** Entrega un evento en vivo a las suscripciones abiertas que encajen. */
    deliver(ev, urlFilter = null) {
      for (const s of sockets) {
        if (urlFilter && s.url !== urlFilter) continue
        if (!s._visible(ev)) continue
        for (const [subId, filters] of s.subs) if (matchAny(ev, filters)) s._emit(['EVENT', subId, ev])
      }
    },
    /** Añade un evento a la red y lo entrega en vivo. */
    add(ev) { if (!store.some(e => e.id === ev.id)) store.push(ev); this.deliver(ev) },
    dropAll() { for (const s of [...sockets]) s._drop() },
    openCount: () => [...sockets].filter(s => s.readyState === 1).length,
    urls: () => [...sockets].map(s => s.url),
  }

  // ── fetch: lo externo nunca sale a la red ────────────────────────────────
  const realFetch = window.fetch.bind(window)
  window.__fetchRoutes = (S.fetch || []).slice()
  window.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : (input?.url ?? String(input))
    const abs = new URL(raw, location.href)
    for (const r of window.__fetchRoutes) {
      if (!new RegExp(r.match).test(abs.href)) continue
      window.__fetchLog.push({ url: abs.href, route: r.match })
      if (r.hang) {
        return new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
        })
      }
      if (r.delayMs) await new Promise(res => setTimeout(res, r.delayMs))
      if (r.fail) throw new TypeError('Failed to fetch')
      const body = r.text !== undefined ? r.text : JSON.stringify(r.json ?? null)
      return new Response(body, { status: r.status ?? 200, headers: { 'Content-Type': r.type ?? 'application/json' } })
    }
    if (abs.origin === location.origin) return realFetch(input, init)
    window.__fetchLog.push({ url: abs.href, blocked: true })
    throw new TypeError('Failed to fetch (red exterior bloqueada por el arnés)')
  }

  const hexToBytes = hex => Uint8Array.from(hex.match(/.{2}/g).map(b => parseInt(b, 16)))
  const crypto$ = () => import('/js/vendor/nostr-crypto.js')

  // ── Wallet NWC simulada (NIP-47) ─────────────────────────────────────────
  // scenario.wallet = { sk, methods?, encryption?, behaviors: { <método>: respuesta } }
  // respuesta: { result } | { error:{code,message} } | 'silent' — o una lista
  // de ellas para contestar distinto en llamadas sucesivas. Modificadores:
  // forged (firmada por otra clave), wrongRef (referencia a otra petición),
  // delayMs. Lo recibido queda en window.__walletCalls.
  if (S.wallet) {
    window.__walletCalls = []
    window.__walletBehaviors = { ...(S.wallet.behaviors || {}) }
    const clone = o => JSON.parse(JSON.stringify(o))
    const nowS = () => Math.floor(Date.now() / 1000)
    window.__walletReady = crypto$().then(c => {
      const skb = hexToBytes(S.wallet.sk)
      const pub = c.getPublicKey(skb)
      const tags = S.wallet.encryption ? [['encryption', S.wallet.encryption]] : []
      const infoSigner = S.wallet.forgedInfo ? hexToBytes('07'.repeat(32)) : skb
      const info = clone(c.finalizeEvent({ kind: 13194, created_at: nowS() - 60, tags,
        content: S.wallet.methods ?? 'get_balance pay_invoice make_invoice lookup_invoice' }, infoSigner))
      // Info falsificada: el relay la presenta como de la wallet, pero la firmó otro.
      if (S.wallet.forgedInfo) info.pubkey = pub
      if (!S.wallet.noInfo) store.push(info)
      return { c, skb, pub }
    })
    window.__relay.onPublish = async event => {
      const { c, skb, pub } = await window.__walletReady
      if (event.kind !== 23194 || !event.tags.some(t => t[0] === 'p' && t[1] === pub)) return
      const nip44 = event.tags.some(t => t[0] === 'encryption' && t[1] === 'nip44_v2')
      const key = nip44 ? c.nip44.getConversationKey(skb, event.pubkey) : null
      const req = JSON.parse(nip44 ? c.nip44.decrypt(event.content, key) : await c.nip04.decrypt(skb, event.pubkey, event.content))
      window.__walletCalls.push(req)
      let b = window.__walletBehaviors[req.method]
      if (Array.isArray(b)) b = b.length > 1 ? b.shift() : b[0]
      if (!b || b === 'silent') return
      const body = JSON.stringify(b.error ? { result_type: req.method, error: b.error } : { result_type: req.method, result: b.result })
      const content = nip44 ? c.nip44.encrypt(body, key) : await c.nip04.encrypt(skb, event.pubkey, body)
      const resp = clone(c.finalizeEvent({
        kind: 23195, created_at: nowS(),
        tags: [['p', event.pubkey], ['e', b.wrongRef ? 'f'.repeat(64) : event.id]], content,
      }, b.forged ? hexToBytes('07'.repeat(32)) : skb))
      setTimeout(() => window.__relay.add(resp), b.delayMs ?? 5)
    }
  }

  // ── Firmante NIP-07 simulado: firma de verdad con una clave de prueba ────
  if (S.nip07) {
    window.nostr = {
      async getPublicKey() {
        if (S.nip07.behavior === 'reject') throw new Error('User rejected')
        const { getPublicKey } = await crypto$()
        return getPublicKey(hexToBytes(S.nip07.sk))
      },
      async signEvent(unsigned) {
        if (S.nip07.behavior === 'reject') throw new Error('User rejected')
        const { finalizeEvent } = await crypto$()
        const signed = JSON.parse(JSON.stringify(finalizeEvent({
          kind: unsigned.kind, created_at: unsigned.created_at, tags: unsigned.tags, content: unsigned.content,
        }, hexToBytes(S.nip07.sk))))
        if (S.nip07.behavior === 'tamper') signed.content = signed.content + ' (alterado)'
        window.__signed.push(signed)
        return signed
      },
    }
  }
})()
