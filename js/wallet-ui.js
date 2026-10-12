// wallet-ui.js — Pestaña wallet de publicar.html (NWC / NIP-47)
//
// Estados: desconectada (pegar string NWC) → conectada (saldo, recibir con
// QR, pagar con confirmación obligatoria). Los fondos viven SIEMPRE en la
// wallet externa del usuario; ver principios en js/nwc.js.

import * as nwc from './nwc.js'
import * as walletSession from './wallet-session.js'
import qrcode from './vendor/qrcode.js'

let conn = null
const $ = id => document.getElementById(id)

export function initWallet() {
  // WAL-001: sessionStorage por defecto; localStorage solo con opt-in
  conn = walletSession.load()

  $('w-btn-connect').addEventListener('click', onConnect)
  $('w-btn-disconnect').addEventListener('click', onDisconnect)
  $('w-btn-refresh').addEventListener('click', refreshBalance)
  $('w-btn-invoice').addEventListener('click', onMakeInvoice)
  $('w-invoice-text').addEventListener('click', e => { navigator.clipboard?.writeText(e.currentTarget.textContent) })
  $('w-btn-decode').addEventListener('click', onDecodeInvoice)

  renderState()
}

/** Llamar al entrar en la sección wallet. */
export function refreshWallet() {
  renderState()
  if (conn) refreshBalance()
}

/** ¿Hay wallet conectada? (para el botón ⚡ Pagar/Zap de anuncios) */
export function hasWallet() { return !!conn }

/** Paga una factura ya generada (zaps, LNURL directo) con la wallet conectada. Lanza si no hay wallet. */
export async function payViaWallet(bolt11) {
  if (!conn) throw new Error('conecta tu wallet primero (pestaña Wallet)')
  // payInvoiceSafely: nunca dar por "no pagado" un pago cuyo resultado se desconoce.
  const res = await nwc.payInvoiceSafely(conn, bolt11)
  refreshBalance()
  return res
}

function renderState() {
  $('w-disconnected').classList.toggle('hidden', !!conn)
  $('w-connected').classList.toggle('hidden', !conn)
  if (conn) {
    $('w-wallet-id').textContent = 'Wallet: ' + conn.walletPubkey.slice(0, 16) + '… · ' + conn.relay.replace('wss://', '')
    $('w-methods').textContent = (conn.methods || []).join(' · ')
  } else {
    // WAL-001: la sesión expiró pero conocemos la wallet (metadatos sin
    // secret) — pedir re-pegar el string, que es lo correcto por diseño.
    const meta = walletSession.loadMeta()
    if (meta) {
      setErr('err-w-connect',
        `ℹ️ Wallet conocida (${meta.walletPubkey.slice(0, 12)}…). La sesión caducó — vuelve a pegar el string de conexión para reconectar.`)
    }
  }
}

// ── Conectar / desconectar ────────────────────────────────────────────────────

async function onConnect() {
  setErr('err-w-connect', '')
  const btn = $('w-btn-connect')
  let parsed
  try {
    parsed = nwc.parseConnectionString($('w-conn-string').value)
  } catch (e) { setErr('err-w-connect', e.message); return }

  btn.disabled = true
  btn.innerHTML = '<span class="spinner"></span>Verificando conexión…'
  try {
    // W5: leer el evento info para negociar cifrado y conocer los métodos
    const info = await nwc.fetchWalletInfo(parsed)
    parsed.encryption = info.encryption
    parsed.methods = info.methods
    // Verificación real end-to-end antes de guardar
    await nwc.getBalance(parsed)

    conn = parsed
    walletSession.save(conn, { remember: !!$('w-remember')?.checked })
    $('w-conn-string').value = ''   // no dejar el secret a la vista
    renderState()
    refreshBalance()
  } catch (e) {
    setErr('err-w-connect', e.message)
  } finally {
    btn.disabled = false
    btn.textContent = '🔌 Conectar wallet'
  }
}

function onDisconnect() {
  if (!confirm('¿Desconectar la wallet?\n\nRecuerda además REVOCAR esta conexión desde tu wallet (Alby Hub / Coinos → conexiones) para invalidar la credencial.')) return
  walletSession.clear()
  conn = null
  $('w-balance').textContent = '—'
  renderState()
}

// ── Saldo ─────────────────────────────────────────────────────────────────────

async function refreshBalance() {
  if (!conn) return
  $('w-balance').textContent = '···'
  try {
    const { balance } = await nwc.getBalance(conn)
    $('w-balance').textContent = Math.floor(balance / 1000).toLocaleString('es-ES') + ' sats'
  } catch (e) {
    $('w-balance').textContent = '—'
    setErr('err-w-balance', e.message)
    setTimeout(() => setErr('err-w-balance', ''), 6000)
  }
}

// ── Recibir ───────────────────────────────────────────────────────────────────

async function onMakeInvoice() {
  setErr('err-w-receive', '')
  const amount = Number($('w-rcv-amount').value)
  if (!Number.isInteger(amount) || amount <= 0) { setErr('err-w-receive', 'Importe inválido (sats enteros)'); return }
  const btn = $('w-btn-invoice')
  btn.disabled = true
  btn.innerHTML = '<span class="spinner"></span>Generando…'
  try {
    const res = await nwc.makeInvoice(conn, amount, $('w-rcv-desc').value.trim().slice(0, 100))
    const bolt11 = res.invoice
    if (!bolt11) throw new Error('la wallet no devolvió la factura')
    renderQr(bolt11)
    $('w-invoice-text').textContent = bolt11
    $('w-invoice-box').classList.remove('hidden')
  } catch (e) {
    setErr('err-w-receive', e.message)
  } finally {
    btn.disabled = false
    btn.textContent = '📥 Generar factura'
  }
}

function renderQr(text) {
  const holder = $('w-qr')
  holder.replaceChildren()
  try {
    // typeNumber 0 = auto; nivel M
    const qr = qrcode(0, 'M')
    qr.addData(text.toUpperCase())   // mayúsculas = QR alfanumérico, más compacto
    qr.make()
    const img = document.createElement('img')
    img.src = qr.createDataURL(4, 8)
    img.alt = 'QR de la factura Lightning'
    img.style.width = '100%'
    img.style.maxWidth = '260px'
    img.style.imageRendering = 'pixelated'
    holder.appendChild(img)
  } catch {
    holder.textContent = '(QR no disponible — copia la factura en texto)'
  }
}

// ── Pagar ─────────────────────────────────────────────────────────────────────

async function onDecodeInvoice() {
  setErr('err-w-pay', '')
  $('w-confirm-box').classList.add('hidden')
  // Misma normalización que aplica decodeBolt11(): sin el prefijo "lightning:"
  // de los QR/enlaces y en minúsculas — es lo que se envía después a la wallet.
  const raw = $('w-pay-invoice').value.trim().replace(/^lightning:/i, '').toLowerCase()
  let dec
  try { dec = nwc.decodeBolt11(raw) }
  catch (e) { setErr('err-w-pay', e.message); return }

  // W4: validar expiración e importe ANTES de la confirmación
  if (dec.expired) { setErr('err-w-pay', '⏰ Esta factura ha expirado — pide una nueva'); return }
  if (dec.amountSats == null) { setErr('err-w-pay', 'Factura sin importe — no soportada en esta versión'); return }

  $('w-confirm-amount').textContent = dec.amountSats.toLocaleString('es-ES') + ' sats'
  $('w-confirm-desc').textContent = dec.description || '(sin descripción)'
  const expMins = Math.max(0, Math.round(((dec.timestamp + dec.expiry) * 1000 - Date.now()) / 60000))
  $('w-confirm-exp').textContent = `expira en ~${expMins} min`
  $('w-confirm-box').classList.remove('hidden')

  // Botón de confirmación de un solo uso (evita listeners duplicados)
  const btn = $('w-btn-pay')
  const fresh = btn.cloneNode(true)
  btn.replaceWith(fresh)
  fresh.addEventListener('click', () => executePay(raw, dec), { once: true })
}

async function executePay(bolt11, dec) {
  const btn = $('w-btn-pay')
  btn.disabled = true
  btn.innerHTML = '<span class="spinner"></span>Pagando…'
  setErr('err-w-pay', '')
  $('w-pay-result').classList.add('hidden')
  try {
    // W2: NUNCA reintentar pay_invoice a ciegas. payInvoiceSafely consulta el
    // estado si la respuesta se pierde, y distingue "no pagado" de "no se sabe".
    const res = await nwc.payInvoiceSafely(conn, bolt11)
    $('w-confirm-box').classList.add('hidden')
    $('w-pay-invoice').value = ''
    $('w-pay-result').textContent = res?.recovered
      ? '✅ El pago SÍ se completó (verificado tras perderse la respuesta)'
      : `✅ Pago enviado (${dec.amountSats.toLocaleString('es-ES')} sats)` +
        (res?.preimage ? ` · preimage ${String(res.preimage).slice(0, 16)}…` : '')
    $('w-pay-result').classList.remove('hidden')
    refreshBalance()
  } catch (e) {
    // El listener del botón es de un solo uso: ocultar la caja para que el
    // usuario re-verifique la factura (no dejar un botón visible sin efecto).
    $('w-confirm-box').classList.add('hidden')
    setErr('err-w-pay', e.message)
  } finally {
    btn.disabled = false
    btn.textContent = '⚡ Confirmar pago'
  }
}

function setErr(errId, msg) {
  const el = $(errId)
  if (!el) return
  el.textContent = msg
  el.classList.toggle('show', !!msg)
}
