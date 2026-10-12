// publicar-app.js — Controlador de publicar.html
//
// Orquesta: formularios (adaptados del mini-app de Telegram) → builders
// (eventos sin firmar) → firma delegada (signer.js: NIP-07 o Amber/NIP-55)
// → publicación a relays (RelayPool.publishWithFeedback) → resultado.
//
// Diferencias clave con el mini-app original:
//  - Sin Telegram.WebApp: botón sticky propio en vez de MainButton,
//    history API en vez de BackButton, publicación directa en vez de sendData.
//  - El usuario firma con SU clave (no hay Modo Perfil ni /vincular).

import { RelayPool } from './relay-pool.js'
import { encodeNaddr, decodeNaddr, getTagValue, getTagValues, hexToNpub } from './nostr.js'
import * as signer from './signer.js'
import {
  buildServicio, buildEvento, buildComunidad, buildHerramienta,
  buildTransaccion, buildValoracion, buildRetirada, buildReporte, normalizePrice,
  VALID_CATS_SERVICIO, VALID_PLATS_COMUNIDAD, VALID_CATS_HERRAMIENTA,
  VALID_ALCANCES, VALID_CURRENCIES, VALID_REPORT_TYPES,
} from './publish-builders.js'
import { sanitizeContact } from './publish-utils.js'
import { initMisAnuncios, refreshMisAnuncios, stopMisAnuncios } from './mis-anuncios.js'
import { fetchReputacion } from './reputacion.js'
import { initWallet, refreshWallet, hasWallet, payViaWallet } from './wallet-ui.js'
import { fetchProfileMeta } from './profile.js'
import { sendZap } from './zaps.js'
import { saveDraft, loadDraft, deleteDraft } from './drafts.js'
import { uploadImage } from './media-upload.js'

// ── Constantes ────────────────────────────────────────────────────────────────

const VALID_TYPES = ['servicio', 'evento', 'comunidad', 'herramienta', 'venta', 'compra', 'intercambio']
const TX_META = {
  venta:       { icon: '📦', label: 'Publicar Venta',       tag: 'plazap2p-venta' },
  compra:      { icon: '🛒', label: 'Publicar Compra',      tag: 'plazap2p-compra' },
  intercambio: { icon: '🔄', label: 'Publicar Intercambio', tag: 'plazap2p-intercambio' },
}
const ALL_SECTIONS = [
  'sec-identidad', 'sec-home', 'sec-servicio', 'sec-evento', 'sec-comunidad',
  'sec-herramienta', 'sec-transaccion', 'sec-valorar', 'sec-reportar', 'sec-zap', 'sec-misanuncios',
  'sec-wallet', 'sec-resultado', 'sec-paste-event',
]
const FORM_FIELD_IDS = [
  's-title', 's-desc', 's-price', 's-currency', 's-negociar', 's-image', 's-contact',
  'e-title', 'e-desc', 'e-date', 'e-allday', 'e-date-end', 'e-location', 'e-image', 'e-contact',
  'c-title', 'c-desc', 'c-access', 'c-image',
  'h-title', 'h-desc', 'h-url', 'h-image',
  'tx-title', 'tx-desc', 'tx-price', 'tx-currency', 'tx-negociar', 'tx-image', 'tx-contact',
  'v-npub', 'v-comment', 'r-npub', 'r-comment',
]
const FALLBACK_RELAYS = [
  'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.damus.io',
  'wss://relay.nostr.band', 'wss://nostr.mom',
]

// ── Estado ────────────────────────────────────────────────────────────────────

let pool = null
let config = null
let ready = Promise.resolve()   // se resuelve cuando config y pool existen (ver DOMContentLoaded)
let selectedType = null      // solo de VALID_TYPES — nunca de input de usuario
let editingDTag = null       // d-tag si estamos editando un anuncio existente
let editingPublishedAt = null // published_at original al editar (PROT-002)
let editingOriginal = null   // evento que se está editando (solo vale mientras su d-tag sea editingDTag)
let userPubkey = signer.getStoredPubkey()
let lastSignedEvent = null   // para el botón Reintentar sin re-firmar
let broadcasting = false     // evita reintentos concurrentes (RelayPool indexa por eventId)
let devMode = false
let draftRestored = false    // UX-002: el formulario abierto viene de un borrador (controla #btn-discard-draft)
let valorarRefTag = null     // REP-002: referencia opcional (tag a/e) del anuncio que motivó la valoración
let valorarRefFor = null     // ...válida solo mientras v-npub siga siendo ESTE hex (si el usuario lo cambia a mano, la ref queda obsoleta)
let reportRefTag = null      // MOD-002: misma idea que valorarRefTag, para sec-reportar
let zapTargetHex = null      // ZAP-001: pubkey del receptor de la sección zap actualmente abierta
let zapTargetLud16 = null
let zapRefTag = null

/** REP-002: naddr de ?ref= → tag 'a' `<kind>:<pubkey>:<d>`, o null si no hay/está roto. */
function parseValorarRef(naddrRaw) {
  if (!naddrRaw) return null
  try {
    const { kind, pubkey, identifier } = decodeNaddr(naddrRaw)
    if (!kind || !/^[0-9a-f]{64}$/i.test(pubkey) || !identifier) return null
    return `${kind}:${pubkey}:${identifier}`
  } catch {
    return null // ref malformada: se ignora, no rompe el flujo de valorar
  }
}

const $ = id => document.getElementById(id)

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URL(location.href).searchParams
  devMode = params.get('dev') === '1'

  // La interfaz se activa YA; config.json y los relays llegan en segundo
  // plano. Antes se esperaba a la red para cablear los botones: con conexión
  // lenta la página se veía pero no respondía a los toques. Lo que necesita
  // red (pool/config) espera a `ready`.
  ready = (async () => {
    await loadConfig()
    pool = new RelayPool(config.relays)
    pool.connect()
  })()

  wireUi()
  updateIdentityUi()

  // 1. ¿Volvemos de Amber? (callback con resultado en la URL)
  const cb = signer.parseAmberCallback(params)
  if (cb) { await handleAmberCallback(cb); return }

  // 2. ¿Hay una firma pendiente sin resolver? (Amber sin retorno automático)
  const pending = signer.loadPending()
  if (pending?.step === 'sign' && pending.unsignedEvent) {
    restoreFormSnapshot(pending.formSnapshot)
    showSection('sec-paste-event')
    return
  }

  // 3. Deep link ?valorar=<npub|hex> — llega desde el directorio de
  //    Vendedores o el modal de un anuncio en index.html.
  const valorarTarget = signer.parseToHex(params.get('valorar') || '')
  if (valorarTarget) {
    $('v-npub').value = hexToNpub(valorarTarget)
    if (userPubkey) {
      renderAspects()
      openActividad('valorar')
      // REP-002 — después de openActividad(), que resetea valorarRefTag a null
      valorarRefTag = parseValorarRef(params.get('ref'))
      valorarRefFor = valorarRefTag ? valorarTarget : null
      onValoradoChange()   // muestra la reputación actual del valorado
      return
    }
    // Sin identidad: pedir conexión primero (el npub queda precargado)
    openPerfil('identidad')
    return
  }

  // 3b. Deep link ?report=<npub|hex>&ref=<naddr> — "🚩 Reportar" del modal
  //     de un anuncio en index.html (MOD-002).
  const reportTarget = signer.parseToHex(params.get('report') || '')
  if (reportTarget) {
    $('r-npub').value = hexToNpub(reportTarget)
    if (userPubkey) {
      reportRefTag = parseValorarRef(params.get('ref')) // mismo formato de referencia que REP-002
      setActiveNav('nav-actividad')
      hidePubChips()
      selectedType = null
      editingDTag = null
      editingPublishedAt = null
      showSection('sec-reportar')
      $('btn-publicar').textContent = '🚩 Enviar reporte'
      return
    }
    openPerfil('identidad')
    return
  }

  // 3c. Deep link ?zap=<npub|hex>&ref=<naddr> — "⚡ Zap" del modal de un
  //     anuncio en index.html (ZAP-001).
  const zapTarget = signer.parseToHex(params.get('zap') || '')
  if (zapTarget) {
    if (userPubkey) {
      setActiveNav('nav-actividad')
      hidePubChips()
      selectedType = null
      editingDTag = null
      editingPublishedAt = null
      openZap(zapTarget, parseValorarRef(params.get('ref')))
      return
    }
    openPerfil('identidad')
    return
  }

  // 3d. Deep link ?pagar=<naddr> — "💳 Pagar" del modal de un anuncio en
  //     index.html (PAY-001: contexto informativo, nunca certifica la operación).
  const pagarNaddr = params.get('pagar')
  if (pagarNaddr) {
    if (userPubkey) {
      try {
        const { pubkey, kind } = decodeNaddr(pagarNaddr)
        const ctx = $('w-pay-context')
        ctx.textContent = `💳 Vas a pagar en relación con este anuncio: ${hexToNpub(pubkey).slice(0, 20)}… — verifica el importe y el destinatario con la otra parte antes de pagar.`
        ctx.classList.remove('hidden')
      } catch { /* naddr ilegible: se omite el contexto, el pago sigue funcionando igual */ }
      openPerfil('wallet')
      return
    }
    openPerfil('identidad')
    return
  }

  // 4. Routing normal (deep link ?type=servicio como el mini-app)
  const rawType = params.get('type') ?? ''
  if (userPubkey && VALID_TYPES.includes(rawType)) navigateTo(rawType)
  else if (userPubkey) showSection('sec-home')
  else openPerfil('identidad')
})

async function loadConfig() {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)   // red colgada: seguir con los relays por defecto
  try {
    const res = await fetch('data/config.json', { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const loaded = await res.json()
    if (!loaded || typeof loaded !== 'object') throw new Error('config ilegible')
    if (!Array.isArray(loaded.relays) || loaded.relays.length === 0) loaded.relays = FALLBACK_RELAYS
    config = loaded
  } catch {
    config = { relays: FALLBACK_RELAYS, ratings: { aspects: [] } }
  } finally {
    clearTimeout(timer)
  }
}

// ── Cableado de UI ────────────────────────────────────────────────────────────

function wireUi() {
  // Cards de tipo
  document.querySelectorAll('.type-card').forEach(card => {
    card.addEventListener('click', () => {
      const t = card.getAttribute('data-type')
      if (!VALID_TYPES.includes(t)) return
      // Publicación NUEVA desde home: nunca heredar el d-tag de una edición
      // anterior abandonada (reutilizarlo sobrescribiría aquel anuncio).
      editingDTag = null
      editingPublishedAt = null
      navigateTo(t)
    })
  })

  // Pills — selección simple por grupo (delegación como el mini-app)
  document.querySelectorAll('.pills').forEach(group => {
    group.addEventListener('click', e => {
      const pill = e.target.closest('.pill')
      if (!pill) return
      group.querySelectorAll('.pill').forEach(p => p.classList.remove('active'))
      pill.classList.add('active')
    })
  })

  // A11Y-001: type-card y pill son <div> (no <button>) por el layout visual
  // (grid/flex-wrap) — se hacen operables por teclado aquí en un solo sitio
  // en vez de repetir role/tabindex en los ~32 elementos del HTML. Cubre
  // también los pills que renderAspects() crea dinámicamente (misma clase).
  makeKeyboardActivatable(document)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const el = e.target.closest('.type-card, .pill')
    if (!el) return
    e.preventDefault()
    el.click()
  })

  // Contadores de caracteres
  ;[['s-title', 200], ['s-desc', 2000], ['e-title', 200], ['e-desc', 2000],
    ['c-title', 80], ['c-desc', 800], ['h-title', 80], ['h-desc', 800],
    ['tx-title', 150], ['tx-desc', 1500], ['v-comment', 500], ['r-comment', 500], ['z-comment', 300],
  ].forEach(([id, max]) => setupCounter(id, max))

  // Toggles "A negociar"
  setupNegociar('s-negociar', 's-price', 's-currency')
  setupNegociar('tx-negociar', 'tx-price', 'tx-currency')

  // MED-001: subida de imagen a Blossom (solo firmador NIP-07 — ver setupImageUpload)
  ;['s', 'e', 'c', 'h', 'tx'].forEach(setupImageUpload)

  // Identidad
  $('btn-connect').addEventListener('click', onConnectClick)
  $('btn-disconnect').addEventListener('click', () => {
    signer.clearPubkey()
    userPubkey = null
    stopMisAnuncios()   // si no, la suscripción del pubkey desconectado sigue abierta
    updateIdentityUi()
    openPerfil('identidad')
  })
  $('id-badge').addEventListener('click', () => openPerfil('identidad'))
  $('btn-paste-pubkey').addEventListener('click', onPastePubkey)

  // Publicar (botón sticky)
  $('btn-publicar').addEventListener('click', handleSubmit)

  // Fallback pegar evento firmado
  $('btn-paste-event').addEventListener('click', onPasteEvent)

  // Zap (ZAP-001)
  $('btn-send-zap').addEventListener('click', submitZap)
  $('zap-btn-goto-wallet').addEventListener('click', () => openPerfil('wallet'))

  // Bottom nav — 5 destinos alineados con el shell de index.html (MOB-002).
  // Actividad y Perfil agrupan dos secciones cada uno mediante chips.
  $('nav-publicar').addEventListener('click', () => {
    setActiveNav('nav-publicar')
    hidePubChips()
    editingDTag = null   // salir de un modo edición abandonado
    editingPublishedAt = null
    showSection(userPubkey ? 'sec-home' : 'sec-identidad')
  })
  $('nav-actividad').addEventListener('click', () => openActividad())
  $('nav-perfil').addEventListener('click', () => openPerfil())
  $('pub-chips').addEventListener('click', e => {
    const chip = e.target.closest('.pub-chip')
    if (!chip) return
    const chipId = chip.dataset.chip
    if (ACTIVIDAD_CHIPS.some(c => c.id === chipId)) openActividad(chipId)
    else openPerfil(chipId)
  })
  initWallet()

  // UX-002: autoguardado de borrador (debounced). Nunca durante una edición
  // real (editingDTag) — si no, un draft con el d-tag de un anuncio ajeno
  // podría restaurarse luego en un formulario "nuevo" y sobrescribirlo al
  // publicar (ver el guard equivalente en navigateTo()).
  let draftSaveTimer = null
  document.addEventListener('input', () => {
    if (!selectedType || editingDTag) return
    clearTimeout(draftSaveTimer)
    draftSaveTimer = setTimeout(() => {
      if (saveDraft(selectedType, takeFormSnapshot())) draftRestored = true
      $('btn-discard-draft')?.classList.toggle('hidden', !draftRestored)
    }, 800)
  })
  $('btn-discard-draft').addEventListener('click', () => {
    if (!selectedType) return
    const type = selectedType // resetFormsAfterSuccess() pone selectedType a null
    deleteDraft(type)
    draftRestored = false
    $('btn-discard-draft').classList.add('hidden')
    resetFormsAfterSuccess()
    navigateTo(type) // vuelve a mostrar el mismo formulario, ahora vacío (loadDraft ya no encuentra nada)
  })

  // Reputación en vivo al escribir el npub del valorado
  $('v-npub').addEventListener('change', onValoradoChange)

  // Mis anuncios (módulo aparte)
  initMisAnuncios({
    pool: () => pool,
    getPubkey: () => userPubkey,
    listEl: () => $('ma-list'),
    statusEl: () => $('ma-status'),
    onEdit: startEdit,
    onRetirar: startRetirada,
    onDuplicar: startDuplicar,
    onMarcarVendido: startMarcarVendido,
  })
}

/** A11Y-001: role=button + tabindex=0 en .type-card/.pill que aún no lo tengan. */
function makeKeyboardActivatable(root) {
  root.querySelectorAll('.type-card, .pill').forEach(el => {
    if (el.hasAttribute('tabindex')) return
    el.setAttribute('role', 'button')
    el.setAttribute('tabindex', '0')
  })
}

function setActiveNav(id) {
  ;['nav-publicar', 'nav-actividad', 'nav-perfil'].forEach(n =>
    $(n).classList.toggle('bn-tab--active', n === id))
}

// ── Chips de sub-navegación: Actividad (Mis anuncios/Valorar) y
//    Perfil (Identidad/Wallet) — mismo patrón que #mbn-chips en index.html.
const ACTIVIDAD_CHIPS = [
  { id: 'misanuncios', label: '📋 Mis anuncios' },
  { id: 'valorar',     label: '⭐ Valorar' },
]
const PERFIL_CHIPS = [
  { id: 'identidad', label: '🔑 Identidad' },
  { id: 'wallet',    label: '⚡ Wallet' },
]

function renderPubChips(items, activeId) {
  const wrap = $('pub-chips')
  wrap.innerHTML = items.map(it =>
    `<button class="pub-chip${it.id === activeId ? ' active' : ''}" data-chip="${it.id}" type="button">${it.label}</button>`
  ).join('')
  wrap.hidden = false
  document.body.classList.add('has-chips')
}

function hidePubChips() {
  $('pub-chips').hidden = true
  $('pub-chips').innerHTML = ''
  document.body.classList.remove('has-chips')
}

function openActividad(chipId = 'misanuncios') {
  setActiveNav('nav-actividad')
  if (!userPubkey) { hidePubChips(); showSection('sec-identidad'); return }
  renderPubChips(ACTIVIDAD_CHIPS, chipId)
  if (chipId === 'valorar') {
    // El botón "Publicar" es compartido con los formularios (sec-valorar
    // está en isForm): si queda un selectedType de un formulario abandonado,
    // handleSubmit publicaría ESE formulario en vez de la valoración visible.
    selectedType = null
    editingDTag = null
    editingPublishedAt = null
    valorarRefTag = null // reset por defecto — el deep link ?ref= lo rellena DESPUÉS de llamar aquí
    valorarRefFor = null
    renderAspects()
    showSection('sec-valorar')
    $('btn-publicar').textContent = '⭐ Enviar valoración'
  } else {
    showSection('sec-misanuncios')
    ready.then(() => { if (!$('sec-misanuncios').classList.contains('hidden')) refreshMisAnuncios() })
  }
}

function openPerfil(chipId = 'identidad') {
  setActiveNav('nav-perfil')
  renderPubChips(PERFIL_CHIPS, chipId)
  if (chipId === 'wallet') {
    showSection('sec-wallet')
    refreshWallet()
  } else {
    showSection('sec-identidad')
  }
}

// ── Navegación entre secciones ────────────────────────────────────────────────

function showSection(id) {
  ALL_SECTIONS.forEach(s => $(s)?.classList.add('hidden'))
  $(id)?.classList.remove('hidden')
  const isForm = ['sec-servicio', 'sec-evento', 'sec-comunidad', 'sec-herramienta', 'sec-transaccion', 'sec-valorar', 'sec-reportar'].includes(id)
  $('publish-bar').classList.toggle('hidden', !isForm)
  window.scrollTo({ top: 0, behavior: 'instant' })
}

function navigateTo(type, options = {}) {
  if (!userPubkey) { showSection('sec-identidad'); return }
  selectedType = type
  draftRestored = false
  if (!editingDTag && !options.skipDraft) {
    // UX-002: nunca pisa una edición real de un anuncio existente (arriba,
    // editingDTag ya viene puesto por startEdit() antes de llamar aquí) —
    // solo se ofrece al abrir un formulario NUEVO. skipDraft: lo usa
    // startDuplicar() (ADS-001), que ya rellenó los campos a mano.
    clearAllErrors()
    const draft = loadDraft(type)
    if (draft) {
      restoreFormSnapshot(draft.snapshot)
      // restoreFormSnapshot() también fija editingDTag/editingPublishedAt desde
      // el snapshot — aquí SIEMPRE debe quedar null: este bloque solo se
      // ejecuta para una publicación nueva (arriba, !editingDTag), nunca se
      // debe heredar un d-tag de sesión vieja y sobrescribir un anuncio ajeno.
      editingDTag = null
      editingPublishedAt = null
      draftRestored = true
    }
  }
  $('btn-discard-draft')?.classList.toggle('hidden', !draftRestored)
  const secId = TX_META[type] ? 'sec-transaccion' : `sec-${type}`
  if (TX_META[type]) {
    $('tx-icon').textContent = TX_META[type].icon
    $('tx-form-title').textContent = TX_META[type].label
  }
  showSection(secId)
  $('btn-publicar').textContent = editingDTag ? '💾 Guardar cambios' : '📢 Publicar'
}

// ── Identidad ─────────────────────────────────────────────────────────────────

function updateIdentityUi() {
  const badge = $('id-badge')
  if (userPubkey) {
    badge.textContent = '🔑 ' + hexToNpub(userPubkey).slice(0, 12) + '…'
    badge.classList.add('connected')
    $('id-disconnected').classList.add('hidden')
    $('id-connected').classList.remove('hidden')
    $('id-npub').textContent = hexToNpub(userPubkey)
    fetchProfile(userPubkey)
  } else {
    badge.textContent = 'Sin conectar'
    badge.classList.remove('connected')
    $('id-disconnected').classList.remove('hidden')
    $('id-connected').classList.add('hidden')
  }
}

async function onConnectClick() {
  setErr('err-connect', '')
  const kind = signer.detectSigner()

  if (kind === 'nip07') {
    try {
      userPubkey = await signer.nip07GetPubkey()
      signer.storePubkey(userPubkey)
      updateIdentityUi()
      showSection('sec-home')
    } catch (e) {
      setErr('err-connect', 'La extensión rechazó la petición: ' + (e?.message || e))
    }
    return
  }

  if (kind === 'nip55') {
    // Detección de Amber ausente (F9): si en ~2,5s la página no pierde el
    // foco, el intent no resolvió → mostrar guía de instalación.
    const guideTimer = setTimeout(() => {
      if (document.visibilityState === 'visible') {
        $('signer-guide').classList.remove('hidden')
        $('paste-pubkey-block').classList.remove('hidden')
      }
    }, 2500)
    document.addEventListener('visibilitychange', () => clearTimeout(guideTimer), { once: true })
    signer.amberConnect()   // navega — el resultado vuelve por callback
    // Por si el callback no retorna a esta instancia: mostrar fallback al volver
    setTimeout(() => $('paste-pubkey-block').classList.remove('hidden'), 4000)
    return
  }

  $('signer-guide').classList.remove('hidden')
}

function onPastePubkey() {
  const hex = signer.parseToHex($('paste-pubkey').value)
  if (!hex) { setErr('err-paste-pubkey', 'npub inválido'); return }
  userPubkey = hex
  signer.storePubkey(hex)
  signer.clearPending()
  updateIdentityUi()
  showSection('sec-home')
}

/** Perfil kind 0 para la tarjeta de identidad (nombre + avatar). */
async function fetchProfile(hex) {
  await ready
  if (!pool) return
  const profile = await fetchProfileMeta(pool, hex)
  if (hex !== userPubkey) return   // la identidad cambió mientras llegaba la respuesta
  const name = profile?.displayName || profile?.name
  $('id-name').textContent = name ? String(name).slice(0, 40) : 'Sin perfil publicado'
  if (profile?.picture) {
    const img = document.createElement('img')
    img.src = profile.picture
    img.alt = ''
    $('id-avatar').replaceChildren(img)
  }
}

// ── Callback de Amber ─────────────────────────────────────────────────────────

async function handleAmberCallback(cb) {
  // Limpiar la URL cuanto antes (F2/F7: el resultado viaja en query params)
  history.replaceState(null, '', 'publicar.html')

  if (cb.step === 'pubkey') {
    userPubkey = cb.value
    signer.storePubkey(cb.value)
    signer.clearPending()
    updateIdentityUi()
    showSection('sec-home')
    return
  }

  // step === 'signed'
  await processSignedEvent(cb.value)
}

/** Valida el evento firmado contra el pending y lo publica. */
async function processSignedEvent(signedEvent) {
  if (signer.wasProcessed(signedEvent.id)) {
    // F2: refresh del callback — el evento ya se publicó en esta sesión
    showSection(userPubkey ? 'sec-home' : 'sec-identidad')
    return
  }

  const pending = signer.loadPending()
  if (!pending?.unsignedEvent) {
    renderResult({ ok: false, title: 'Sesión de firma caducada',
      sub: 'No encontramos la publicación pendiente (¿han pasado más de 15 minutos?). Vuelve a rellenar el formulario.' })
    return
  }

  // F3 + SEC-002: firma Schnorr real, id recalculado, mismo contenido y fecha
  // de esta sesión de firma. Nada sin verificar llega a los relays.
  const check = signer.verifySignedReturn(signedEvent, pending.unsignedEvent)
  if (!check.ok && check.code !== 'pubkey') {
    renderResult({ ok: false, title: 'Evento firmado rechazado',
      sub: check.error + '. Publicación abortada por seguridad.' })
    return
  }

  // F4: el usuario cambió de cuenta en el firmador (firma válida, otra clave)
  if (check.ok === false && check.code === 'pubkey') {
    if (confirm('El evento está firmado con una identidad distinta a la conectada.\n¿Actualizar tu identidad a esa clave y publicar?')) {
      userPubkey = signedEvent.pubkey
      signer.storePubkey(userPubkey)
      updateIdentityUi()
    } else {
      renderResult({ ok: false, title: 'Publicación cancelada', sub: 'La identidad del evento no coincide con la conectada.' })
      return
    }
  }

  await broadcastAndReport(signedEvent, pending)
}

// ── Submit ────────────────────────────────────────────────────────────────────

async function handleSubmit() {
  if (!selectedType && !$('sec-valorar').classList.contains('hidden')) {
    return submitValoracion()
  }
  if (!selectedType && !$('sec-reportar').classList.contains('hidden')) {
    return submitReporte()
  }
  if (!selectedType) return

  clearAllErrors()
  const { ok, errors } = validateForm(selectedType)
  if (!ok) { showErrors(errors); return }

  const payload = buildPayload(selectedType)
  const built = runBuilder(selectedType, payload)
  if (!built.ok) {
    renderResult({ ok: false, title: 'Datos inválidos', sub: built.error })
    return
  }
  if (devMode) built.unsignedEvent.tags.push(['t', 'plazap2p-test'])

  const original = currentOriginal()
  if (original) built.unsignedEvent.created_at = newerThan(original)
  const queue = original ? kindChangeCleanup(original, built.unsignedEvent) : []

  // UX-001: ninguna firma empieza sin que el usuario vea antes exactamente
  // qué va a firmar — signAndPublish() ahora solo lo llama el botón
  // "Confirmar y firmar" de renderPreview(), nunca este handler directamente.
  renderPreview(built.unsignedEvent, { type: selectedType, dTag: built.dTag, editing: !!editingDTag }, queue)
}

/** El evento que se está editando, o null (publicación nueva o referencia obsoleta). */
function currentOriginal() {
  return (editingDTag && editingOriginal && getTagValue(editingOriginal.tags, 'd') === editingDTag)
    ? editingOriginal : null
}

/**
 * created_at para una versión que SUSTITUYE a `ev` (editar, vendido, retirar).
 * Entre dos versiones de un evento reemplazable gana la más reciente: si el
 * reloj de este dispositivo va por detrás del que publicó el original, o todo
 * ocurre en el mismo segundo, los relays se quedarían con la versión antigua
 * mientras la app dice "actualizado".
 */
function newerThan(ev) {
  return Math.max(Math.floor(Date.now() / 1000), (Number(ev?.created_at) || 0) + 1)
}

/**
 * Un evento de calendario cambia de kind al marcar/desmarcar "todo el día"
 * (31922 ↔ 31923). Con el mismo d-tag pero otro kind es OTRA dirección: la
 * versión anterior seguiría publicada como un evento distinto. Devuelve los
 * eventos que la retiran (status:inactive para quien lo lee así, y kind 5
 * para el resto de clientes), a firmar después del principal.
 */
function kindChangeCleanup(original, next) {
  if (original.kind === next.kind) return []
  const inactive = {
    kind: original.kind,
    created_at: newerThan(original),
    tags: original.tags.map(t => t[0] === 'status' ? ['status', 'inactive'] : t),
    content: original.content,
    pubkey: userPubkey,
  }
  if (!inactive.tags.some(t => t[0] === 'status')) inactive.tags.push(['status', 'inactive'])
  const del = buildRetirada({ kind: original.kind, dTag: editingDTag, eventId: original.id }, userPubkey)
  return [inactive, ...(del.ok ? [del.unsignedEvent] : [])]
}

/** UX-001 — resumen antes de firmar. Reutiliza el mismo #res-box/.res-card
 * que renderResult() (Firmando.../Publicado): mismo contenedor, se
 * sobrescribe con box.replaceChildren() en ambos, sin solapamiento. */
function renderPreview(unsignedEvent, meta, queue = []) {
  const box = $('res-box')
  box.replaceChildren()

  const card = document.createElement('div')
  card.className = 'res-card'

  const icon = document.createElement('div')
  icon.className = 'res-icon'
  icon.textContent = '👁️'
  card.appendChild(icon)

  const h = document.createElement('div')
  h.className = 'res-title'
  h.textContent = 'Revisa antes de firmar'
  card.appendChild(h)

  const npub = userPubkey ? hexToNpub(userPubkey) : ''
  const p = document.createElement('div')
  p.className = 'res-sub'
  p.textContent = `Firmarás como ${npub.slice(0, 16)}… y quedará público en la red Nostr, en los relays configurados.`
  card.appendChild(p)

  const priceTag = unsignedEvent.tags.find(t => t[0] === 'price')
  const fields = document.createElement('div')
  fields.className = 'res-relays'
  const addRow = (label, value) => {
    if (!value) return
    const row = document.createElement('div')
    row.className = 'res-relay'
    const l = document.createElement('span'); l.textContent = label
    const v = document.createElement('span'); v.textContent = value
    row.append(l, v)
    fields.appendChild(row)
  }
  addRow('Tipo', TX_META[meta.type]?.label || meta.type)
  addRow('Título', getTagValue(unsignedEvent.tags, 'title'))
  addRow('Precio', priceTag ? `${priceTag[1]} ${priceTag[2] || ''}`.trim() : null)
  addRow('Contacto', getTagValue(unsignedEvent.tags, 'contact'))
  addRow('Imagen', getTagValue(unsignedEvent.tags, 'image') ? 'adjunta' : null)
  addRow('Relays', `${(config?.relays || []).length} configurados`)
  if (queue.length) addRow('Firmas', `${1 + queue.length} — el evento cambia de tipo y hay que retirar la versión anterior`)
  card.appendChild(fields)

  const summary = getTagValue(unsignedEvent.tags, 'summary')
  if (summary) {
    const desc = document.createElement('p')
    desc.className = 'res-sub'
    desc.style.textAlign = 'left'
    desc.style.whiteSpace = 'pre-wrap'
    desc.textContent = summary
    card.appendChild(desc)
  }

  const actions = document.createElement('div')
  actions.className = 'res-actions'

  const editBtn = document.createElement('button')
  editBtn.className = 'btn-secondary'
  editBtn.type = 'button'
  editBtn.textContent = '← Editar'
  editBtn.addEventListener('click', () => {
    // Sin pasar por navigateTo(): mantiene los campos tal como el usuario
    // los dejó, sin que la restauración de borrador (UX-002) los reemplace.
    showSection(TX_META[meta.type] ? 'sec-transaccion' : `sec-${meta.type}`)
  })
  actions.appendChild(editBtn)

  const confirmBtn = document.createElement('button')
  confirmBtn.className = 'btn-primary'
  confirmBtn.type = 'button'
  confirmBtn.textContent = '🔑 Confirmar y firmar'
  confirmBtn.addEventListener('click', () => {
    confirmBtn.disabled = true
    signAndPublish(unsignedEvent, meta, queue)
  })
  actions.appendChild(confirmBtn)

  card.appendChild(actions)
  box.appendChild(card)
  showSection('sec-resultado')
}

function runBuilder(type, payload) {
  switch (type) {
    case 'servicio':    return buildServicio(payload, userPubkey, editingDTag, editingPublishedAt)
    case 'evento':      return buildEvento(payload, userPubkey, editingDTag, editingPublishedAt)
    case 'comunidad':   return buildComunidad(payload, userPubkey, editingDTag, editingPublishedAt)
    case 'herramienta': return buildHerramienta(payload, userPubkey, editingDTag, editingPublishedAt)
    case 'venta':
    case 'compra':
    case 'intercambio': return buildTransaccion({ ...payload, tipoTag: TX_META[type].tag }, userPubkey, editingDTag, editingPublishedAt)
    default:            return { ok: false, error: 'tipo desconocido' }
  }
}

/**
 * Pipeline de firma: NIP-07 resuelve en la página; NIP-55 navega a Amber
 * (el resto del pipeline continúa en handleAmberCallback tras la recarga).
 * queue: eventos adicionales a firmar después (retirada = inactive + kind 5).
 */
async function signAndPublish(unsignedEvent, meta, queue = []) {
  const btn = $('btn-publicar')
  btn.disabled = true
  btn.innerHTML = '<span class="spinner"></span>Firmando…'

  // Total de firmas de esta operación: se fija en el primer paso y viaja en
  // meta para poder decir "Paso N de M" en los siguientes.
  if (!meta.totalSteps) meta = { ...meta, totalSteps: 1 + queue.length }

  const pending = {
    step: 'sign',
    unsignedEvent,
    meta,
    queue,
    formSnapshot: takeFormSnapshot(),
  }
  signer.savePending(pending)

  const kind = signer.detectSigner()
  try {
    if (kind === 'nip07') {
      const signed = await signer.nip07Sign(unsignedEvent)
      await processSignedEvent(signed)
    } else if (kind === 'nip55') {
      signer.amberSign(unsignedEvent)   // navega — no retorna
      // Si en unos segundos seguimos aquí (Amber abrió en otra app y no hubo
      // navegación de vuelta), ofrecer el fallback de pegado manual.
      setTimeout(() => { showSection('sec-paste-event') }, 4000)
    } else {
      showSection('sec-identidad')
      $('signer-guide').classList.remove('hidden')
    }
  } catch (e) {
    renderResult({ ok: false, title: 'Firma cancelada',
      sub: (e?.message || 'El firmador rechazó la petición.') + ' Puedes intentarlo de nuevo — el formulario conserva tus datos.' })
  } finally {
    btn.disabled = false
    btn.textContent = editingDTag ? '💾 Guardar cambios' : '📢 Publicar'
  }
}

function onPasteEvent() {
  setErr('err-paste-event', '')
  const parsed = signer.parseSignedEventJson($('paste-event').value)
  if (!parsed) { setErr('err-paste-event', 'Eso no parece un evento Nostr firmado válido'); return }
  processSignedEvent(parsed.value)
}

// ── Publicación a relays ──────────────────────────────────────────────────────

/** Espera a que el pool tenga al menos `min` relays conectados (F1). */
function waitForRelays(min = 1, timeoutMs = 8000) {
  return new Promise(resolve => {
    const start = Date.now()
    const check = () => {
      if (pool.connectedCount >= min) return resolve(true)
      if (Date.now() - start > timeoutMs) return resolve(false)
      setTimeout(check, 250)
    }
    check()
  })
}

async function broadcastAndReport(signedEvent, pending) {
  // RelayPool.publishWithFeedback indexa su callback de seguimiento solo por
  // eventId: dos llamadas concurrentes para el mismo evento (doble clic en
  // "Reintentar" mientras un intento anterior sigue esperando su timeout de
  // 8 s) se pisarían entre sí y podrían borrar el callback de la que sigue
  // en curso. Un solo broadcast en vuelo a la vez evita la carrera.
  if (broadcasting) return
  broadcasting = true
  try {
    await broadcastAndReportInner(signedEvent, pending)
  } finally {
    broadcasting = false
  }
}

async function broadcastAndReportInner(signedEvent, pending) {
  renderResult({ ok: null, title: 'Publicando…', sub: 'Enviando a los relays de la red Nostr.' })

  await ready
  const connected = await waitForRelays()
  if (!connected) {
    lastSignedEvent = { signedEvent, pending }
    renderResult({
      ok: false, title: 'Sin conexión con los relays',
      sub: 'No se pudo conectar con ningún relay. Comprueba tu conexión y reintenta — el evento ya está firmado, no hará falta firmar de nuevo.',
      retry: true,
    })
    return
  }

  const results = await pool.publishWithFeedback(signedEvent, 8000)
  const accepted = results.filter(r => r.accepted)

  if (accepted.length >= 1) {
    signer.markProcessed(signedEvent.id)
    signer.clearPending()
    lastSignedEvent = null

    // ¿Quedan eventos por firmar en cola? (retirada: inactive + kind 5)
    if (pending?.queue?.length) {
      const [next, ...rest] = pending.queue
      const total = pending.meta?.totalSteps || (1 + pending.queue.length)
      const done = total - pending.queue.length
      renderResult({
        ok: true, title: `Paso ${done} de ${total} publicado`,
        sub: next.kind === 5
          ? 'Falta firmar la solicitud de borrado (kind 5) para completar la retirada.'
          : 'Falta firmar la retirada de la versión anterior del evento.',
        results,
        nextInQueue: { unsignedEvent: next, meta: pending.meta, queue: rest, label: `✍️ Firmar paso ${done + 1} de ${total}` },
      })
      return
    }

    const isAnuncio = signedEvent.kind === 30402 || signedEvent.kind === 31922 || signedEvent.kind === 31923
    const dTag = getTagValue(signedEvent.tags, 'd')
    let naddr = null
    if (isAnuncio && dTag) {
      try { naddr = encodeNaddr({ kind: signedEvent.kind, pubkey: signedEvent.pubkey, identifier: dTag, relays: config.relays.slice(0, 3) }) }
      catch { /* naddr es opcional */ }
    }
    deleteDraft(pending?.meta?.type) // UX-002: publicado con éxito → ya no es un borrador pendiente
    draftRestored = false
    $('btn-discard-draft')?.classList.add('hidden')
    resetFormsAfterSuccess()
    renderResult({
      ok: true,
      title: signedEvent.kind === 1985 ? '⭐ Valoración publicada'
           : editingDTagWas(pending)   ? '💾 Anuncio actualizado'
           : signedEvent.kind === 5    ? '🗑 Solicitud de borrado enviada'
           : '🎉 ¡Publicado en Nostr!',
      sub: `Aceptado por ${accepted.length} de ${results.length} relays.`,
      results, naddr,
    })
  } else {
    lastSignedEvent = { signedEvent, pending }
    const msgs = results.filter(r => !r.accepted && r.message).map(r => r.message)
    const clockIssue = msgs.some(m => /created_at|too far|future|past/i.test(m))
    renderResult({
      ok: false, title: 'Ningún relay aceptó el evento',
      sub: clockIssue
        ? '⏰ Parece un problema de hora: revisa que la fecha/hora del dispositivo sea correcta y reintenta.'
        : (msgs[0] ? `Motivo: ${msgs[0]}` : 'Puede que tu clave sea nueva para estos relays. Prueba a publicar primero tu perfil (kind 0) desde Amber o Primal, y reintenta.'),
      results, retry: true,
    })
  }
}

function editingDTagWas(pending) {
  return !!pending?.meta?.editing
}

// ── Pantalla de resultado ─────────────────────────────────────────────────────

function renderResult({ ok, title, sub, results = [], naddr = null, retry = false, nextInQueue = null }) {
  const box = $('res-box')
  box.replaceChildren()

  const card = document.createElement('div')
  card.className = 'res-card ' + (ok === true ? 'ok' : ok === false ? 'err' : '')

  const icon = document.createElement('div')
  icon.className = 'res-icon'
  icon.textContent = ok === true ? '✅' : ok === false ? '⚠️' : '📡'
  card.appendChild(icon)

  const h = document.createElement('div')
  h.className = 'res-title'
  h.textContent = title
  card.appendChild(h)

  const p = document.createElement('div')
  p.className = 'res-sub'
  p.textContent = sub
  card.appendChild(p)

  if (results.length) {
    const list = document.createElement('div')
    list.className = 'res-relays'
    for (const r of results) {
      const row = document.createElement('div')
      row.className = 'res-relay'
      const url = document.createElement('span')
      url.textContent = r.url.replace('wss://', '')
      const st = document.createElement('span')
      st.className = r.accepted ? 'r-ok' : 'r-err'
      st.textContent = r.accepted ? '✓' : ('✗ ' + (r.message || '').slice(0, 40))
      row.append(url, st)
      list.appendChild(row)
    }
    card.appendChild(list)
  }

  const actions = document.createElement('div')
  actions.className = 'res-actions'

  if (naddr) {
    const nbox = document.createElement('div')
    nbox.className = 'naddr-box'
    nbox.textContent = naddr
    nbox.title = 'Toca para copiar'
    nbox.addEventListener('click', () => navigator.clipboard?.writeText(naddr))
    card.appendChild(nbox)

    const view = document.createElement('a')
    view.className = 'btn-secondary'
    view.href = `https://njump.me/${naddr}`
    view.target = '_blank'
    view.rel = 'noopener'
    view.textContent = '🔗 Ver en Nostr (njump)'
    actions.appendChild(view)

    const market = document.createElement('a')
    market.className = 'btn-secondary'
    market.href = './'
    market.textContent = '🛒 Ver en el Mercado'
    actions.appendChild(market)
  }

  if (retry && lastSignedEvent) {
    const btn = document.createElement('button')
    btn.className = 'btn-primary'
    btn.textContent = '🔄 Reintentar publicación'
    btn.addEventListener('click', () => {
      btn.disabled = true
      broadcastAndReport(lastSignedEvent.signedEvent, lastSignedEvent.pending)
    })
    actions.appendChild(btn)
  }

  if (nextInQueue) {
    const btn = document.createElement('button')
    btn.className = 'btn-primary'
    btn.textContent = nextInQueue.label || '✍️ Firmar paso 2 de 2'
    btn.addEventListener('click', () => signAndPublish(nextInQueue.unsignedEvent, nextInQueue.meta, nextInQueue.queue))
    actions.appendChild(btn)
  }

  const home = document.createElement('button')
  home.className = 'btn-secondary'
  home.textContent = '← Volver'
  home.addEventListener('click', () => showSection('sec-home'))
  actions.appendChild(home)

  card.appendChild(actions)
  box.appendChild(card)
  showSection('sec-resultado')
}

// ── Validación (port del mini-app + validaciones nuevas) ─────────────────────

function validateForm(type) {
  const errors = new Map()
  switch (type) {
    case 'servicio':
      checkLen(errors, 's-title', 5, 200)
      checkLen(errors, 's-desc', 10, 2000)
      checkUrl(errors, 's-image')
      checkPrice(errors, 's-price', 's-negociar')
      checkContact(errors, 's-contact')
      break
    case 'evento':
      checkLen(errors, 'e-title', 5, 200)
      checkLen(errors, 'e-desc', 10, 2000)
      checkUrl(errors, 'e-image')
      checkContact(errors, 'e-contact')
      // PROT-001: NIP-52 exige `start` — la fecha ya no es opcional
      if (!$('e-date')?.value) errors.set('e-date', 'La fecha de inicio es obligatoria')
      else checkEventDate(errors, 'e-date')
      if ($('e-date')?.value && $('e-date-end')?.value
        && $('e-date-end').value <= $('e-date').value) {
        errors.set('e-date-end', 'El fin debe ser posterior al inicio')
      }
      break
    case 'comunidad':
      checkLen(errors, 'c-title', 3, 80)
      checkLen(errors, 'c-desc', 20, 800)
      checkUrl(errors, 'c-access')
      checkUrl(errors, 'c-image')
      break
    case 'herramienta':
      checkLen(errors, 'h-title', 2, 80)
      checkLen(errors, 'h-desc', 20, 800)
      checkUrl(errors, 'h-url')
      checkUrl(errors, 'h-image')
      break
    case 'venta':
    case 'compra':
    case 'intercambio':
      checkLen(errors, 'tx-title', 3, 150)
      checkLen(errors, 'tx-desc', 20, 1500)
      checkUrl(errors, 'tx-image')
      checkPrice(errors, 'tx-price', 'tx-negociar')
      checkContact(errors, 'tx-contact')
      break
  }
  return { ok: errors.size === 0, errors }
}

function checkLen(errors, id, min, max) {
  const el = $(id)
  if (!el) return
  const len = el.value.trim().length
  if (len < min) errors.set(id, `Mínimo ${min} caracteres (tienes ${len})`)
  else if (len > max) errors.set(id, `Máximo ${max} caracteres`)
}

function checkUrl(errors, id) {
  const el = $(id)
  if (!el) return
  const val = el.value.trim()
  if (!val) return
  try {
    const u = new URL(val)
    if (u.protocol !== 'https:') errors.set(id, 'URL inválida — debe empezar por https://')
    else if (u.username || u.password) errors.set(id, 'URL inválida — no puede contener usuario@')
  } catch {
    errors.set(id, 'URL inválida — formato incorrecto')
  }
}

/** F12: precio numérico (el wizard del bot lo garantizaba por flujo). */
function checkPrice(errors, priceId, negociarId) {
  if ($(negociarId)?.checked) return
  // Campo numérico con texto que el navegador no entiende ("12e", "doce"):
  // .value llega vacío, así que sin esto el anuncio se publicaba SIN precio
  // aunque el usuario viera el suyo escrito.
  if ($(priceId)?.validity?.badInput) { errors.set(priceId, 'Precio inválido — solo números (p.ej. 25 o 0.5)'); return }
  const raw = $(priceId)?.value.trim()
  if (!raw) return   // opcional
  if (normalizePrice(raw) === null) errors.set(priceId, 'Precio inválido — solo números (p.ej. 25 o 0.5)')
}

/** F11: el contacto no puede perder información en la sanitización. */
function checkContact(errors, id) {
  const raw = $(id)?.value.trim()
  if (!raw) return
  const safe = sanitizeContact(raw)
  if (!safe || safe !== raw) {
    errors.set(id, 'El contacto no puede contener enlaces — usa @usuario, correo o npub')
  }
}

/** F13: aviso (no bloqueante) si la fecha del evento ya pasó. */
function checkEventDate(errors, id) {
  const raw = $(id)?.value
  if (!raw) return
  const ts = Math.floor(new Date(raw).getTime() / 1000)
  if (Number.isFinite(ts) && ts < Math.floor(Date.now() / 1000)) {
    const errEl = $(`err-${id}`)
    if (errEl) { errEl.textContent = '⚠️ La fecha está en el pasado (se publicará igualmente)'; errEl.classList.add('show') }
  }
}

function showErrors(errors) {
  errors.forEach((msg, id) => {
    setErr(`err-${id}`, msg)
    $(id)?.classList.add('invalid')
  })
  document.querySelector('.f-error.show')?.closest('.field-group')
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function setErr(errId, msg) {
  const el = $(errId)
  if (!el) return
  el.textContent = msg
  el.classList.toggle('show', !!msg)
}

function clearAllErrors() {
  document.querySelectorAll('.f-error').forEach(el => { el.textContent = ''; el.classList.remove('show') })
  document.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'))
}

// ── Payloads (port del mini-app) ─────────────────────────────────────────────

const val = id => $(id)?.value.trim() ?? ''
function pillVal(groupId, validList) {
  const selected = document.querySelector(`#${groupId} .pill.active`)
  const v = selected?.getAttribute('data-value') ?? null
  return (v && validList.includes(v)) ? v : null
}
const boolChk = id => $(id)?.checked ?? false

function buildPayload(type) {
  switch (type) {
    case 'servicio': {
      const neg = boolChk('s-negociar')
      return {
        title: val('s-title'), desc: val('s-desc'),
        catId: pillVal('pills-s-cat', VALID_CATS_SERVICIO),
        price: neg ? null : normalizePrice(val('s-price')),
        currency: neg ? null : (VALID_CURRENCIES.includes(val('s-currency')) ? val('s-currency') : null),
        imageUrl: val('s-image') || null,
        contact: val('s-contact') || null,
      }
    }
    case 'evento': {
      // PROT-001: allDay → 31922 (fechas ISO); con hora → 31923 (Unix + tzid)
      const allDay = boolChk('e-allday')
      const dateRaw = $('e-date')?.value ?? ''
      const endRaw = $('e-date-end')?.value ?? ''
      const toTs = raw => {
        if (!raw) return null
        const ts = Math.floor(new Date(raw).getTime() / 1000)
        return (Number.isFinite(ts) && ts > 0) ? ts : null
      }
      let tzid = null
      try { tzid = Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch { /* opcional */ }
      return {
        title: val('e-title'), desc: val('e-desc'),
        allDay,
        // datetime-local = "YYYY-MM-DDTHH:mm" → la fecha ISO es el prefijo
        startDate: allDay ? (dateRaw.slice(0, 10) || null) : null,
        endDate:   allDay ? (endRaw.slice(0, 10) || null) : null,
        dateTs:    allDay ? null : toTs(dateRaw),
        endTs:     allDay ? null : toTs(endRaw),
        tzid,
        location: val('e-location') || null,
        imageUrl: val('e-image') || null,
        contact: val('e-contact') || null,
      }
    }
    case 'comunidad':
      return {
        title: val('c-title'), desc: val('c-desc'),
        platId: pillVal('pills-c-plat', VALID_PLATS_COMUNIDAD),
        accessUrl: val('c-access') || null,
        imageUrl: val('c-image') || null,
      }
    case 'herramienta':
      return {
        title: val('h-title'), desc: val('h-desc'),
        catId: pillVal('pills-h-cat', VALID_CATS_HERRAMIENTA),
        officialUrl: val('h-url') || null,
        platforms: Array.from(document.querySelectorAll('input[name="h-platform"]:checked')).map(cb => cb.value),
        imageUrl: val('h-image') || null,
      }
    case 'venta':
    case 'compra':
    case 'intercambio': {
      const neg = boolChk('tx-negociar')
      return {
        title: val('tx-title'), desc: val('tx-desc'),
        alcanceId: pillVal('pills-tx-alcance', VALID_ALCANCES),
        price: neg ? null : normalizePrice(val('tx-price')),
        currency: neg ? null : (VALID_CURRENCIES.includes(val('tx-currency')) ? val('tx-currency') : null),
        imageUrl: val('tx-image') || null,
        contact: val('tx-contact') || null,
      }
    }
    default: return {}
  }
}

// ── Valorar ───────────────────────────────────────────────────────────────────

function renderAspects() {
  const wrap = $('v-aspects')
  if (wrap.childElementCount > 0) return   // ya renderizado
  if (!config) { ready.then(renderAspects); return }   // config.json aún en camino
  const aspects = config?.ratings?.aspects || []
  for (const a of aspects) {
    const row = document.createElement('div')
    row.className = 'aspect-row'
    const lbl = document.createElement('span')
    lbl.className = 'aspect-lbl'
    lbl.textContent = `${a.icon || ''} ${a.label}`.trim()
    const pills = document.createElement('div')
    pills.className = 'pills aspect-pills'
    pills.id = `pills-aspect-${a.id}`
    for (let n = 1; n <= 5; n++) {
      const pill = document.createElement('div')
      pill.className = 'pill'
      pill.setAttribute('data-value', String(n))
      pill.textContent = String(n)
      pills.appendChild(pill)
    }
    pills.addEventListener('click', e => {
      const pill = e.target.closest('.pill')
      if (!pill) return
      const wasActive = pill.classList.contains('active')
      pills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'))
      if (!wasActive) pill.classList.add('active')   // segundo toque des-selecciona
    })
    row.append(lbl, pills)
    wrap.appendChild(row)
  }
  makeKeyboardActivatable(wrap)
}

async function onValoradoChange() {
  const hex = signer.parseToHex(val('v-npub'))
  setErr('err-v-npub', '')
  if (!hex) return
  try {
    await ready
    const rep = await fetchReputacion(pool, hex)
    if (rep.count > 0) {
      setErr('err-v-npub', '')
      const errEl = $('err-v-npub')
      errEl.textContent = `ℹ️ Reputación actual: ${rep.avg.toFixed(1)}/5 (${rep.count} ${rep.count === 1 ? 'valoración firmada' : 'valoraciones firmadas'})`
      errEl.classList.add('show')
    }
  } catch { /* informativo — no bloquear */ }
}

async function submitValoracion() {
  clearAllErrors()
  const rateeHex = signer.parseToHex(val('v-npub'))
  if (!rateeHex) { setErr('err-v-npub', 'npub inválido'); return }
  const rating = Number(pillVal('pills-v-rating', ['1', '2', '3', '4', '5']))
  if (!rating) { setErr('err-v-rating', 'Elige una puntuación'); return }

  const aspects = {}
  for (const a of (config?.ratings?.aspects || [])) {
    const v = document.querySelector(`#pills-aspect-${a.id} .pill.active`)?.getAttribute('data-value')
    if (v) aspects[a.id] = Number(v)
  }

  // REP-002: la referencia solo se adjunta si sigue siendo del MISMO npub
  // para el que se guardó — si el usuario cambió v-npub a mano, ya no aplica.
  const refTag = (valorarRefTag && valorarRefFor === rateeHex) ? valorarRefTag : null
  const built = buildValoracion({ rateeHex, rating, comment: val('v-comment'), aspects, refTag }, userPubkey)
  if (!built.ok) { setErr('err-v-npub', built.error); return }
  if (devMode) built.unsignedEvent.tags.push(['t', 'plazap2p-test'])

  selectedType = null
  await signAndPublish(built.unsignedEvent, { type: 'valoracion' })
}

async function submitReporte() {
  clearAllErrors()
  const reportedHex = signer.parseToHex(val('r-npub'))
  if (!reportedHex) { setErr('err-r-npub', 'npub inválido'); return }
  const reportType = pillVal('pills-r-tipo', VALID_REPORT_TYPES)
  if (!reportType) { setErr('err-r-tipo', 'Elige un motivo'); return }

  const built = buildReporte({ reportedHex, reportType, comment: val('r-comment'), refTag: reportRefTag }, userPubkey)
  if (!built.ok) { setErr('err-r-npub', built.error); return }
  if (devMode) built.unsignedEvent.tags.push(['t', 'plazap2p-test'])

  selectedType = null
  await signAndPublish(built.unsignedEvent, { type: 'reporte' })
}

// ── Zap (NIP-57) ──────────────────────────────────────────────────────────────
// ZAP-001: el request (kind 9734) se firma con la IDENTIDAD, nunca con la
// wallet — por eso, igual que MED-001 (subida Blossom), esta pantalla solo
// funciona con firmador NIP-07 hoy: el salto de página de Amber está pensado
// para el flujo de publicación principal, no para un paso intermedio de
// firma dentro de enviar un zap. Con Amber, ver el aviso de abajo.

async function openZap(recipientHex, refTag) {
  showSection('sec-zap')
  zapTargetHex = recipientHex
  zapTargetLud16 = null
  zapRefTag = refTag
  $('zap-target-info').textContent = `Enviando a ${hexToNpub(recipientHex).slice(0, 20)}…`
  $('zap-form-fields').classList.add('hidden')
  $('zap-no-wallet').classList.add('hidden')
  $('zap-no-lud16').classList.add('hidden')
  setErr('err-zap', '')
  $('zap-result').classList.add('hidden')

  if (signer.detectSigner() !== 'nip07') {
    setErr('err-zap', 'Enviar zaps requiere un firmador de extensión (NIP-07) por ahora — con Amber, usa la wallet directamente desde tu cliente Nostr habitual.')
    return
  }
  if (!hasWallet()) {
    $('zap-no-wallet').classList.remove('hidden')
    return
  }

  $('zap-target-info').textContent += ' — consultando su perfil…'
  await ready
  const profile = await fetchProfileMeta(pool, recipientHex)
  if (!profile?.lud16) {
    $('zap-no-lud16').classList.remove('hidden')
    $('zap-target-info').textContent = `Enviando a ${hexToNpub(recipientHex).slice(0, 20)}…`
    return
  }
  zapTargetLud16 = profile.lud16
  $('zap-target-info').textContent = `Enviando a ${profile.displayName || profile.name || hexToNpub(recipientHex).slice(0, 20) + '…'} (${profile.lud16})`
  $('zap-form-fields').classList.remove('hidden')
}

async function submitZap() {
  setErr('err-zap', '')
  $('zap-result').classList.add('hidden')
  const amountSats = Number($('z-amount').value)
  if (!Number.isInteger(amountSats) || amountSats <= 0) { setErr('err-z-amount', 'Importe inválido (sats enteros)'); return }
  if (!zapTargetHex || !zapTargetLud16) { setErr('err-zap', 'Falta el destinatario o su lightning address'); return }

  const btn = $('btn-send-zap')
  btn.disabled = true
  btn.innerHTML = '<span class="spinner"></span>Enviando…'
  try {
    const { payResult } = await sendZap({
      recipientHex: zapTargetHex,
      recipientLud16: zapTargetLud16,
      amountMsats: amountSats * 1000,
      relays: config.relays,
      comment: val('z-comment'),
      addressableRef: (zapRefTag && /^\d+:[0-9a-f]{64}:.*$/i.test(zapRefTag)) ? zapRefTag : null,
    }, userPubkey, signer.nip07Sign, null, (_conn, bolt11) => payViaWallet(bolt11))

    $('zap-result').textContent = `✅ Zap de ${amountSats.toLocaleString('es-ES')} sats enviado` +
      (payResult?.preimage ? ` · preimage ${String(payResult.preimage).slice(0, 16)}…` : '')
    $('zap-result').classList.remove('hidden')
    $('z-amount').value = ''
    $('z-comment').value = ''
  } catch (e) {
    setErr('err-zap', e?.message || 'no se pudo enviar el zap')
  } finally {
    btn.disabled = false
    btn.textContent = '⚡ Enviar zap'
  }
}

// ── Editar / Retirar (desde Mis anuncios) ────────────────────────────────────

/** Precarga el formulario desde los tags de un evento propio y entra en modo edición. */
/** Detecta el tipo de wizard (servicio/evento/.../intercambio) a partir de los
 * tags del evento — compartido por startEdit() y startDuplicar(). */
function detectTypeFromEvent(ev) {
  const tTags = getTagValues(ev.tags, 't')
  if (tTags.includes('plazap2p-servicio')) return 'servicio'
  if (tTags.includes('plazap2p-evento') || ev.kind === 31922 || ev.kind === 31923) return 'evento'
  if (tTags.includes('plazap2p-comunidad')) return 'comunidad'
  if (tTags.includes('plazap2p-herramienta')) return 'herramienta'
  if (tTags.includes('plazap2p-venta')) return 'venta'
  if (tTags.includes('plazap2p-compra')) return 'compra'
  if (tTags.includes('plazap2p-intercambio')) return 'intercambio'
  return null
}

/** Rellena los campos del formulario del `type` dado a partir de los tags de
 * un evento ya publicado — compartido por startEdit() (editar) y
 * startDuplicar() (ADS-001: publicar de cero a partir de un anuncio propio). */
function populateFormFromEvent(ev, type) {
  const tags = ev.tags
  const tTags = getTagValues(tags, 't')
  const prefix = TX_META[type] ? 'tx' : type[0]
  const set = (id, v) => { const el = $(id); if (el && v != null) el.value = v }
  const setPill = (groupId, value) => {
    if (!value) return
    document.querySelectorAll(`#${groupId} .pill`).forEach(p => p.classList.remove('active'))
    document.querySelector(`#${groupId} .pill[data-value="${CSS.escape(value)}"]`)?.classList.add('active')
  }

  set(`${prefix}-title`, getTagValue(tags, 'title'))
  set(`${prefix}-desc`, getTagValue(tags, 'summary'))
  const price = tags.find(t => t[0] === 'price')
  if (price) { set(`${prefix}-price`, price[1]); if (price[2]) set(`${prefix}-currency`, price[2]) }
  set(`${prefix}-image`, getTagValue(tags, 'image'))
  set(`${prefix}-contact`, getTagValue(tags, 'contact'))

  // Restaurar selección de pills/checkboxes desde los tags (si no, la edición
  // perdería categoría/plataforma/alcance en silencio al re-publicar).
  if (type === 'servicio') setPill('pills-s-cat', getTagValue(tags, 'service_type'))
  if (type === 'evento') {
    set('e-location', getTagValue(tags, 'location'))
    // PROT-001: start puede ser Unix (31923, o 31922 legado con bug) o
    // fecha ISO (31922 correcto). end análogo.
    const pad = n => String(n).padStart(2, '0')
    const tsToLocal = ts => {
      const d = new Date(ts * 1000)
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    const startRaw = getTagValue(tags, 'start') || ''
    const endRaw = getTagValue(tags, 'end') || ''
    if (/^\d{4}-\d{2}-\d{2}$/.test(startRaw)) {
      const chk = $('e-allday'); if (chk) chk.checked = true
      set('e-date', `${startRaw}T00:00`)
      if (/^\d{4}-\d{2}-\d{2}$/.test(endRaw)) set('e-date-end', `${endRaw}T00:00`)
    } else {
      const startTs = Number(startRaw)
      if (Number.isFinite(startTs) && startTs > 0) set('e-date', tsToLocal(startTs))
      const endTs = Number(endRaw)
      if (Number.isFinite(endTs) && endTs > 0) set('e-date-end', tsToLocal(endTs))
    }
  }
  if (type === 'comunidad') {
    set('c-access', getTagValue(tags, 'r'))
    setPill('pills-c-plat', tTags.find(t => VALID_PLATS_COMUNIDAD.includes(t)))
  }
  if (type === 'herramienta') {
    set('h-url', getTagValue(tags, 'r'))
    setPill('pills-h-cat', tTags.find(t => VALID_CATS_HERRAMIENTA.includes(t)))
    const plats = getTagValues(tags, 'platform')
    document.querySelectorAll('input[name="h-platform"]').forEach(cb => { cb.checked = plats.includes(cb.value) })
  }
  if (TX_META[type]) {
    const loc = getTagValue(tags, 'location')
    if (VALID_ALCANCES.includes(loc)) setPill('pills-tx-alcance', loc)
  }
}

function startEdit(ev) {
  const type = detectTypeFromEvent(ev)
  if (!type) { alert('Este anuncio no se puede editar desde la app (tipo desconocido).'); return }

  // Formulario limpio antes de precargar: populateFormFromEvent() solo
  // escribe los campos que el anuncio trae, así que un valor residual de otro
  // formulario a medias (una imagen, un contacto) se publicaría dentro de
  // ESTE anuncio al guardar.
  resetFormsAfterSuccess()
  editingDTag = getTagValue(ev.tags, 'd')
  editingOriginal = ev
  // PROT-002: conservar el published_at original (si no existe, created_at)
  const pubAtRaw = Number(getTagValue(ev.tags, 'published_at'))
  editingPublishedAt = (Number.isInteger(pubAtRaw) && pubAtRaw > 0) ? pubAtRaw : ev.created_at
  populateFormFromEvent(ev, type)
  navigateTo(type)
}

/** ADS-001 — Duplicar: parte de un anuncio propio (activo o no) para publicar
 * uno NUEVO con los mismos datos. A diferencia de Editar, nunca hereda el
 * d-tag ni el published_at original — es una publicación distinta, no una
 * revisión de la existente. */
function startDuplicar(ev) {
  const type = detectTypeFromEvent(ev)
  if (!type) { alert('Este anuncio no se puede duplicar desde la app (tipo desconocido).'); return }
  resetFormsAfterSuccess()   // mismo motivo que en startEdit(): sin restos de otro formulario
  populateFormFromEvent(ev, type)
  // skipDraft: los campos ya vienen rellenados desde el anuncio original —
  // si navigateTo() aplicara aquí su restauración de borrador (UX-002) podría
  // pisarlos con un borrador viejo sin relación.
  navigateTo(type, { skipDraft: true })
}

/** Marcar vendido: NO encola kind 5 (a diferencia de Retirar) — el anuncio
 * conserva su d-tag y sigue siendo consultable, solo deja de listarse como
 * activo (addEvent() en app.js ya retira status:sold del mercado en vivo). */
function startMarcarVendido(ev) {
  if (!confirm('¿Marcar este anuncio como vendido? Dejará de aparecer como activo en el mercado.')) return
  const soldEvent = {
    kind: ev.kind,
    created_at: newerThan(ev),
    tags: ev.tags.map(t => t[0] === 'status' ? ['status', 'sold'] : t),
    content: ev.content,
    pubkey: userPubkey,
  }
  if (!soldEvent.tags.some(t => t[0] === 'status')) soldEvent.tags.push(['status', 'sold'])
  signAndPublish(soldEvent, { type: 'marcar-vendido' })
}

/** Retirada: republica con status:inactive y encola el kind 5 (dos firmas). */
function startRetirada(ev) {
  if (!confirm('¿Retirar este anuncio? Se marcará como inactivo y se pedirá su borrado a los relays.')) return
  const dTag = getTagValue(ev.tags, 'd')

  const inactiveEvent = {
    kind: ev.kind,
    created_at: newerThan(ev),
    tags: ev.tags.map(t => t[0] === 'status' ? ['status', 'inactive'] : t),
    content: ev.content,
    pubkey: userPubkey,
  }
  if (!inactiveEvent.tags.some(t => t[0] === 'status')) inactiveEvent.tags.push(['status', 'inactive'])

  const del = buildRetirada({ kind: ev.kind, dTag, eventId: ev.id }, userPubkey)
  const queue = del.ok ? [del.unsignedEvent] : []

  signAndPublish(inactiveEvent, { type: 'retirada' }, queue)
}

// ── Snapshot del formulario (F6: no perder datos al saltar a Amber) ──────────

function takeFormSnapshot() {
  const snap = { fields: {}, pills: {}, checks: [] }
  for (const id of FORM_FIELD_IDS) {
    const el = $(id)
    if (!el) continue
    if (el.type === 'checkbox') { if (el.checked) snap.checks.push(id) }
    else snap.fields[id] = el.value
  }
  document.querySelectorAll('.pills').forEach(group => {
    const active = group.querySelector('.pill.active')
    if (active && group.id) snap.pills[group.id] = active.getAttribute('data-value')
  })
  snap.platforms = Array.from(document.querySelectorAll('input[name="h-platform"]:checked')).map(cb => cb.value)
  snap.selectedType = selectedType
  snap.editingDTag = editingDTag
  snap.editingPublishedAt = editingPublishedAt
  return snap
}

function restoreFormSnapshot(snap) {
  if (!snap) return
  for (const [id, v] of Object.entries(snap.fields || {})) { const el = $(id); if (el) el.value = v }
  for (const id of (snap.checks || [])) { const el = $(id); if (el) el.checked = true }
  for (const [groupId, value] of Object.entries(snap.pills || {})) {
    document.querySelector(`#${groupId} .pill[data-value="${CSS.escape(value)}"]`)?.classList.add('active')
  }
  for (const p of (snap.platforms || [])) {
    const cb = document.querySelector(`input[name="h-platform"][value="${CSS.escape(p)}"]`)
    if (cb) cb.checked = true
  }
  syncNegociarState()
  selectedType = VALID_TYPES.includes(snap.selectedType) ? snap.selectedType : null
  editingDTag = snap.editingDTag || null
  editingPublishedAt = (Number.isInteger(snap.editingPublishedAt) && snap.editingPublishedAt > 0)
    ? snap.editingPublishedAt : null
}

function resetFormsAfterSuccess() {
  for (const id of FORM_FIELD_IDS) {
    const el = $(id)
    if (!el) continue
    if (el.type === 'checkbox') el.checked = false
    else if (el.tagName === 'SELECT') el.selectedIndex = 0
    else el.value = ''
  }
  document.querySelectorAll('.pill.active').forEach(p => p.classList.remove('active'))
  document.querySelectorAll('input[name="h-platform"]').forEach(cb => { cb.checked = false })
  syncNegociarState()
  editingDTag = null
  editingPublishedAt = null
  editingOriginal = null
  selectedType = null
}

// ── Helpers UI (port del mini-app) ───────────────────────────────────────────

function setupCounter(fieldId, max) {
  const input = $(fieldId)
  const cnt = $(`cnt-${fieldId}`)
  if (!input || !cnt) return
  input.addEventListener('input', () => {
    const len = input.value.length
    cnt.textContent = `${len}/${max}`
    cnt.classList.toggle('over', len > max)
  })
}

const NEGOCIAR_GROUPS = [['s-negociar', 's-price', 's-currency'], ['tx-negociar', 'tx-price', 'tx-currency']]

function setupNegociar(checkId, priceId, currId) {
  const cb = $(checkId)
  const price = $(priceId)
  const curr = $(currId)
  if (!cb || !price || !curr) return
  cb.addEventListener('change', () => {
    price.disabled = cb.checked
    curr.disabled = cb.checked
    if (cb.checked) { price.value = ''; price.classList.remove('invalid') }
  })
}

/** Marcar/desmarcar "A negociar" por código (reset tras publicar, restaurar un
 * borrador) no dispara 'change': sin esto, precio y moneda se quedaban
 * deshabilitados para la siguiente publicación. */
function syncNegociarState() {
  for (const [checkId, priceId, currId] of NEGOCIAR_GROUPS) {
    const cb = $(checkId), price = $(priceId), curr = $(currId)
    if (!cb || !price || !curr) continue
    price.disabled = cb.checked
    curr.disabled = cb.checked
  }
}

/**
 * MED-001 — sube la imagen elegida a Blossom y rellena el campo de URL con
 * el resultado. Solo con NIP-07: Amber necesita un salto de página con
 * estado pendiente (igual que la firma del anuncio) que este paso
 * intermedio no implementa todavía — con Amber el input queda deshabilitado
 * y el campo de URL manual sigue siendo la vía (no se ha quitado).
 */
function setupImageUpload(prefix) {
  const fileInput = $(`${prefix}-image-file`)
  const urlInput = $(`${prefix}-image`)
  const status = $(`${prefix}-image-status`)
  if (!fileInput || !urlInput || !status) return

  if (signer.detectSigner() !== 'nip07') {
    fileInput.disabled = true
    fileInput.title = 'Subida directa solo disponible con extensión Nostr (NIP-07) — pega una URL abajo'
    return
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    status.className = 'img-upload-status'
    status.textContent = '⏳ Subiendo…'
    fileInput.disabled = true
    try {
      const url = await uploadImage(file, userPubkey, signer.nip07Sign)
      urlInput.value = url
      status.className = 'img-upload-status ok'
      status.textContent = '✅ Subida'
    } catch (e) {
      status.className = 'img-upload-status err'
      status.textContent = '❌ ' + (e?.message || 'error al subir')
    } finally {
      fileInput.disabled = false
    }
  })
}
