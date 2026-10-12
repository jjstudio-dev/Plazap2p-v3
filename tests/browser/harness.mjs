// Arnés de pruebas en navegador real — sin dependencias npm.
// Node (>=22, WebSocket global) habla con Chrome por CDP. Sirve el repo desde
// un servidor local en http://[::1]:<puerto> (index.html desregistra el
// Service Worker en localhost/127.0.0.1, así que es el único origen donde se
// puede probar el SW).
//
// Nada de lo que hay aquí toca la red real: Chrome sale por un proxy que no
// existe (--proxy-server) y los WebSocket/fetch externos se sustituyen por
// dobles dentro de la página (page-stubs.js).

import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const STUBS = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'page-stubs.js'), 'utf8')

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.pdf': 'application/pdf', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
}

/** Servidor estático del repo. `overrides` permite sustituir respuestas por
 * ruta (p.ej. servir otro sw.js o hacer fallar un asset): { '/sw.js': {status, body, type} }. */
export function startServer(overrides = {}) {
  const hits = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    let pathname = decodeURIComponent(url.pathname)
    hits.push(pathname + url.search)
    const ov = overrides[pathname]
    if (ov) {
      res.writeHead(ov.status ?? 200, { 'Content-Type': ov.type ?? 'text/plain', 'Cache-Control': 'no-store' })
      res.end(ov.body ?? '')
      return
    }
    if (pathname.endsWith('/')) pathname += 'index.html'
    const file = path.normalize(path.join(REPO_ROOT, pathname))
    if (!file.startsWith(REPO_ROOT)) { res.writeHead(403); res.end(); return }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
      res.end(buf)
    })
  })
  return new Promise(resolve => {
    const listen = () => server.listen(0, '::1', () => {
      const { port } = server.address()
      // Chrome se niega a abrir ciertos puertos (ERR_UNSAFE_PORT): si el
      // sistema asigna uno de ellos, pedir otro.
      if (CHROME_UNSAFE_PORTS.has(port)) { server.close(listen); return }
      resolve({ origin: `http://[::1]:${port}`, port, hits, overrides, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r) }) })
    })
    listen()
  })
}

const CHROME_UNSAFE_PORTS = new Set([
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
])

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)
  const found = candidates.find(p => fs.existsSync(p))
  if (!found) throw new Error('No se encontró Chrome/Edge. Define CHROME_PATH.')
  return found
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Lanza Chrome headless y devuelve un cliente CDP mínimo. */
export async function launchBrowser() {
  // Ruta CORTA a propósito: con rutas largas CacheStorage falla con "Entry
  // already exists" y el Service Worker queda `redundant`.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pz'))
  const proc = spawn(findChrome(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    // Sin red exterior: todo sale por un proxy inexistente, salvo el bucle
    // local, que Chrome nunca manda al proxy.
    '--proxy-server=http://127.0.0.1:9',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  let stderr = ''
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome no arrancó: ' + stderr.slice(-400))), 20000)
    proc.stderr.on('data', d => {
      stderr += d
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(stderr)
      if (m) { clearTimeout(timer); resolve(m[1]) }
    })
    proc.on('exit', code => { clearTimeout(timer); reject(new Error(`Chrome salió (${code}): ${stderr.slice(-400)}`)) })
  })

  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP: no se pudo conectar')) })
  let nextId = 1
  const pending = new Map()
  const listeners = new Set()
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data)
    if (msg.id) {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message}`)) : p.resolve(msg.result)
    } else {
      for (const fn of listeners) fn(msg)
    }
  }
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject, method })
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })

  return {
    send, listeners,
    async close() {
      try { await send('Browser.close') } catch { /* ya cerrado */ }
      await sleep(300)
      try { proc.kill() } catch { /* ya muerto */ }
      for (let i = 0; i < 10; i++) {
        try { fs.rmSync(userDataDir, { recursive: true, force: true }); break } catch { await sleep(300) }
      }
    },
  }
}

/** Texto de un RemoteObject de consola, sin depender de que sea serializable. */
function argText(a) {
  if (a.type === 'string') return a.value
  if (a.value !== undefined) return JSON.stringify(a.value)
  return a.description ?? a.type
}

/**
 * Abre una página aislada (contexto de navegador propio: almacenamiento y
 * Service Worker independientes del resto de pruebas).
 *
 * @param {object} browser — de launchBrowser()
 * @param {object} opts
 *   - scenario: objeto JSON que page-stubs.js recibe como window.__scenario
 *   - viewport: { width, height, mobile }
 *   - stubs: false para cargar la página sin dobles
 *   - serviceWorker: true para dejar que el Service Worker intercepte
 */
export async function openPage(browser, { scenario = {}, viewport = { width: 1280, height: 900 }, stubs = true, serviceWorker = false } = {}) {
  const { send, listeners } = browser
  const { browserContextId } = await send('Target.createBrowserContext')
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const cdp = (method, params) => send(method, params, sessionId)

  const errors = []      // excepciones no controladas + console.error
  const warnings = []    // console.warn
  const failed = []      // peticiones de red fallidas
  const dialogs = []
  const onEvent = msg => {
    if (msg.sessionId !== sessionId) return
    const p = msg.params
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = p.exceptionDetails
      errors.push(`EXCEPCIÓN: ${d.exception?.description ?? d.text} @ ${d.url ?? ''}:${d.lineNumber ?? ''}`)
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = p.args.map(argText).join(' ')
      if (p.type === 'error') errors.push(`console.error: ${text}`)
      else if (p.type === 'warning') warnings.push(text)
    } else if (msg.method === 'Log.entryAdded') {
      if (p.entry.level === 'error') failed.push(`${p.entry.text} ${p.entry.url ?? ''}`.trim())
    } else if (msg.method === 'Page.javascriptDialogOpening') {
      dialogs.push({ type: p.type, message: p.message })
      // Si un diálogo nativo llega hasta aquí es que el doble de página no lo
      // interceptó: aceptarlo para no dejar la página colgada.
      cdp('Page.handleJavaScriptDialog', { accept: true }).catch(() => {})
    }
  }
  listeners.add(onEvent)

  await cdp('Page.enable')
  await cdp('Runtime.enable')
  await cdp('Log.enable')
  await cdp('Network.enable')
  // Por defecto el Service Worker no interviene: cada prueba ve los archivos
  // del disco, no una caché. Las pruebas del SW lo piden con serviceWorker:true.
  if (!serviceWorker) await cdp('Network.setBypassServiceWorker', { bypass: true })
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: !!viewport.mobile,
  })
  if (stubs) {
    await cdp('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__scenario = ${JSON.stringify(scenario)};\n${STUBS}`,
    })
  }

  const evaluate = async (expression, { awaitPromise = true } = {}) => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true })
    if (r.exceptionDetails) {
      throw new Error('evaluate: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    }
    return r.result.value
  }

  const page = {
    cdp, errors, warnings, failed, dialogs, evaluate,
    async goto(url) {
      const loaded = new Promise(resolve => {
        const fn = msg => {
          if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') { listeners.delete(fn); resolve() }
        }
        listeners.add(fn)
      })
      const r = await cdp('Page.navigate', { url })
      if (r.errorText) throw new Error(`navegación a ${url}: ${r.errorText}`)
      await Promise.race([loaded, sleep(15000)])
    },
    async reload() {
      const loaded = new Promise(resolve => {
        const fn = msg => {
          if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') { listeners.delete(fn); resolve() }
        }
        listeners.add(fn)
      })
      await cdp('Page.reload', { ignoreCache: false })
      await Promise.race([loaded, sleep(15000)])
    },
    /** Espera a que `expression` (JS en la página) sea verdadera. */
    async waitFor(expression, { timeout = 8000, label = expression } = {}) {
      const start = Date.now()
      for (;;) {
        let v = false
        try { v = await evaluate(`(() => { try { return !!(${expression}) } catch { return false } })()`) } catch { /* navegación en curso */ }
        if (v) return
        if (Date.now() - start > timeout) throw new Error(`timeout esperando: ${label}`)
        await sleep(60)
      }
    },
    sleep,
    click: sel => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no existe ' + ${JSON.stringify(sel)}); el.click(); })()`),
    /** Escribe en un campo disparando los eventos que escucha la app. */
    fill: (sel, value) => evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no existe ' + ${JSON.stringify(sel)});
      if (el.type === 'checkbox' || el.type === 'radio') { el.checked = ${JSON.stringify(value)} === true; }
      else el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`),
    /** Teclea de verdad (no asigna .value): necesario para probar lo que el
     * navegador hace con texto no válido en campos numéricos. */
    async type(sel, text) {
      await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no existe ' + ${JSON.stringify(sel)}); el.focus(); })()`)
      for (const ch of text) await cdp('Input.dispatchKeyEvent', { type: 'char', text: ch })
    },
    text: sel => evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`),
    count: sel => evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`),
    async screenshot(file) {
      const { data } = await cdp('Page.captureScreenshot', { format: 'png' })
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, Buffer.from(data, 'base64'))
      return file
    },
    setOffline: offline => cdp('Network.emulateNetworkConditions', {
      offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    }),
    async close() {
      listeners.delete(onEvent)
      try { await send('Target.closeTarget', { targetId }) } catch { /* ya cerrada */ }
      try { await send('Target.disposeBrowserContext', { browserContextId }) } catch { /* ya liberado */ }
    },
  }
  return page
}

/** Errores que no son de la app: recursos externos bloqueados a propósito por el arnés. */
export function appErrors(page) {
  const external = /fonts\.googleapis|fonts\.gstatic|ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED/
  return [...page.errors, ...page.failed].filter(e => !external.test(e))
}
