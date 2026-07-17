// mis-anuncios.js — Anuncios propios: query a relays por author (sin KV)
//
// Sustituye al /misanuncios del bot (que guardaba un resumen en Cloudflare KV):
// aquí la fuente de verdad son los propios relays. Ventajas: sin límite de 10,
// sin TTL de 90 días, y con editar/retirar (kinds addressable).
//
// Dedupe por (kind, pubkey, dTag) quedándose el created_at mayor — semántica
// de eventos addressable NIP-01.

import { getTagValue } from './nostr.js'

const SUB_ID = 'mis-anuncios'

let deps = null           // { pool, getPubkey, listEl, statusEl, onEdit, onRetirar }
let items = new Map()     // `${kind}:${dTag}` → evento más reciente
let eoseSeen = false

export function initMisAnuncios(dependencies) {
  deps = dependencies
}

/** Llamar al desconectar identidad: cierra la suscripción si quedó abierta
 * (si no, sigue consumiendo relay/ancho de banda para el pubkey ya desconectado
 * hasta que el usuario vuelva a entrar en "Mis anuncios"). */
export function stopMisAnuncios() {
  deps?.pool()?.unsubscribe(SUB_ID)
  items = new Map()
  eoseSeen = false
}

/** (Re)lanza la query de anuncios propios. Llamar al entrar en la sección. */
export function refreshMisAnuncios() {
  const pool = deps.pool()
  const pubkey = deps.getPubkey()
  if (!pool || !pubkey) return

  items = new Map()
  eoseSeen = false
  deps.statusEl().textContent = 'Buscando tus anuncios en los relays…'
  deps.listEl().replaceChildren()

  pool.unsubscribe(SUB_ID)
  pool.subscribe(SUB_ID, [{ kinds: [30402, 31922, 31923], authors: [pubkey], '#t': ['plazap2p'], limit: 50 }], {
    onEvent(ev) {
      if (ev.pubkey !== pubkey) return   // defensa: relay malicioso
      const dTag = getTagValue(ev.tags, 'd')
      if (!dTag) return
      const key = `${ev.kind}:${dTag}`
      const prev = items.get(key)
      if (!prev || ev.created_at > prev.created_at) {
        items.set(key, ev)
        render()
      }
    },
    onEose() {
      eoseSeen = true
      render()
    },
  })

  // Si en 8s no hay nada, informar (relays lentos o sin anuncios)
  setTimeout(() => { if (items.size === 0) render(true) }, 8000)
}

function render(timedOut = false) {
  const list = deps.listEl()
  const status = deps.statusEl()
  list.replaceChildren()

  const sorted = [...items.values()].sort((a, b) => b.created_at - a.created_at)

  if (sorted.length === 0) {
    status.textContent = (eoseSeen || timedOut)
      ? 'No se encontraron anuncios publicados con tu clave.'
      : 'Buscando tus anuncios en los relays…'
    return
  }
  status.textContent = `${sorted.length} anuncio${sorted.length === 1 ? '' : 's'} encontrado${sorted.length === 1 ? '' : 's'}`

  for (const ev of sorted) {
    const status_ = getTagValue(ev.tags, 'status') || 'active'
    const inactive = status_ === 'inactive' || status_ === 'sold'

    const item = document.createElement('div')
    item.className = 'ma-item' + (inactive ? ' inactive' : '')

    const title = document.createElement('div')
    title.className = 'ma-title'
    title.textContent = getTagValue(ev.tags, 'title') || '(sin título)'
    item.appendChild(title)

    const meta = document.createElement('div')
    meta.className = 'ma-meta'
    const tipo = (ev.tags.find(t => t[0] === 't' && t[1]?.startsWith('plazap2p-'))?.[1] || '').replace('plazap2p-', '')
    const fecha = new Date(ev.created_at * 1000).toLocaleDateString('es-ES')
    meta.textContent = `${tipo || 'anuncio'} · ${fecha}` + (inactive ? ` · ${status_ === 'sold' ? 'vendido' : 'retirado'}` : '')
    item.appendChild(meta)

    if (!inactive) {
      const actions = document.createElement('div')
      actions.className = 'ma-actions'

      const edit = document.createElement('button')
      edit.type = 'button'
      edit.textContent = '✏️ Editar'
      edit.addEventListener('click', () => deps.onEdit(ev))

      const del = document.createElement('button')
      del.type = 'button'
      del.className = 'danger'
      del.textContent = '🗑 Retirar'
      del.addEventListener('click', () => deps.onRetirar(ev))

      actions.append(edit, del)
      item.appendChild(actions)
    }
    list.appendChild(item)
  }
}
