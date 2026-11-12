#!/usr/bin/env node
// Verifica en Nostr las comunidades de data/comunidades-2140.json que tienen
// npub: su perfil (kind 0), su lista de relays (kind 10002) y su última
// actividad; después prueba cada relay que usan (NIP-11 y una consulta real).
// Solo LEE: no publica nada. Escribe un informe en docs/relays-comunidades.md.
//
//   node tools/verificar-relays-comunidades.mjs
//
// Sirve para decidir, con datos, qué relays de la comunidad podrían añadirse a
// la configuración (eso lo decide y firma el mantenedor; este script no toca
// data/config.json).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeNpub } from '../js/nostr.js'
import { normalizeRelayUrl } from '../js/outbox.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const config = JSON.parse(fs.readFileSync(path.join(root, 'data/config.json'), 'utf8'))
const communities = JSON.parse(fs.readFileSync(path.join(root, 'data/comunidades-2140.json'), 'utf8')).comunidades
const LOOKUP = config.relays
const now = Math.floor(Date.now() / 1000)

function req(url, filter, ms = 7000) {
  return new Promise(resolve => {
    const out = []
    const t0 = Date.now()
    let ws
    let eose = false
    let closed = null
    const done = () => { try { ws.close() } catch { /* ya cerrado */ } resolve({ events: out, eose, ms: Date.now() - t0, closed }) }
    const timer = setTimeout(done, ms)
    try { ws = new WebSocket(url) } catch { clearTimeout(timer); return resolve({ events: [], eose: false, ms: 0, closed: 'no conecta' }) }
    ws.onopen = () => ws.send(JSON.stringify(['REQ', 'v', filter]))
    ws.onmessage = m => {
      let d
      try { d = JSON.parse(m.data) } catch { return }
      if (d[0] === 'EVENT') out.push(d[2])
      if (d[0] === 'EOSE') { eose = true; clearTimeout(timer); done() }
      if (d[0] === 'CLOSED') { closed = String(d[2] || 'cerrado'); clearTimeout(timer); done() }
      if (d[0] === 'AUTH') closed = closed || 'pide AUTH'
    }
    ws.onerror = () => { clearTimeout(timer); closed = closed || 'error de conexión'; done() }
  })
}

async function newest(filter) {
  let best = null
  for (const r of LOOKUP) {
    const { events } = await req(r, filter)
    for (const e of events) if (!best || e.created_at > best.created_at) best = e
  }
  return best
}

async function nip11(url) {
  try {
    const res = await fetch(url.replace(/^wss:/, 'https:'), { headers: { Accept: 'application/nostr+json' }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

const days = ts => ts ? Math.round((now - ts) / 86400) : null

console.log(`Comunidades con npub: ${communities.filter(c => c.npub).length} de ${communities.length}`)
const rows = []
const relayUse = new Map()
for (const c of communities.filter(c => c.npub)) {
  let pk
  try { pk = decodeNpub(c.npub) } catch { pk = null }
  if (!pk) { rows.push({ c, error: 'npub ilegible' }); continue }
  const profile = await newest({ kinds: [0], authors: [pk], limit: 1 })
  const list = await newest({ kinds: [10002], authors: [pk], limit: 1 })
  const note = await newest({ kinds: [1], authors: [pk], limit: 1 })
  let meta = {}
  try { meta = JSON.parse(profile?.content || '{}') } catch { /* perfil raro */ }
  const relays = (list?.tags || []).filter(t => t[0] === 'r').map(t => ({ url: normalizeRelayUrl(t[1]), mode: t[2] || 'lectura y escritura' })).filter(r => r.url)
  for (const r of relays) {
    if (!relayUse.has(r.url)) relayUse.set(r.url, new Set())
    relayUse.get(r.url).add(c.nombre)
  }
  rows.push({ c, pk, name: meta.name || meta.display_name || null, nip05: meta.nip05 || null, relays, lastNote: note?.created_at || null, hasProfile: !!profile })
  console.log(`· ${c.nombre}: perfil ${profile ? 'sí' : 'no'}, ${relays.length} relays, última nota hace ${days(note?.created_at) ?? '—'} días`)
}

const ours = new Set(config.relays.map(normalizeRelayUrl))
const relayRows = []
for (const [url, users] of [...relayUse.entries()].sort((a, b) => b[1].size - a[1].size)) {
  const info = await nip11(url)
  let probe = await req(url, { kinds: [1], limit: 1 }, 8000)
  // Muchos relays limitan conexiones seguidas desde la misma IP: un segundo intento tras una pausa.
  if (!probe.eose) { await new Promise(r => setTimeout(r, 3000)); probe = await req(url, { kinds: [1], limit: 1 }, 8000) }
  const lim = info?.limitation || {}
  relayRows.push({
    url, users: [...users], ours: ours.has(url),
    software: info?.software ? String(info.software).replace(/^.*\//, '').slice(0, 40) : '—',
    name: info?.name ? String(info.name).slice(0, 40) : '—',
    auth: !!lim.auth_required || /auth/i.test(probe.closed || ''),
    payment: !!lim.payment_required,
    restricted: !!lim.restricted_writes,
    answers: probe.eose, ms: probe.ms, closed: probe.closed,
  })
  console.log(`  ${url}: ${probe.eose ? `responde (${probe.ms} ms)` : `no responde (${probe.closed || 'sin EOSE'})`}`)
}

const candidate = r => !r.ours && r.answers && !r.auth && !r.payment && !r.restricted && r.users.length >= 2
const md = []
md.push('# Relays de las comunidades Bitcoin de España')
md.push('')
md.push(`Generado el ${new Date().toISOString().slice(0, 10)} con \`node tools/verificar-relays-comunidades.mjs\` (solo lectura). Fuente de las comunidades: [2140meetups.com](https://2140meetups.com/comunidades/).`)
md.push('')
md.push('## Comunidades con cuenta Nostr')
md.push('')
md.push('| Comunidad | Ciudad | Perfil | NIP-05 | Relays en su lista | Última nota |')
md.push('|---|---|---|---|---|---|')
for (const r of rows) {
  if (r.error) { md.push(`| ${r.c.nombre} | ${r.c.ciudad || ''} | ${r.error} | | | |`); continue }
  md.push(`| ${r.c.nombre} | ${r.c.ciudad || ''} | ${r.hasProfile ? (r.name || 'sí') : 'no encontrado'} | ${r.nip05 || '—'} | ${r.relays.length || 'sin lista'} | ${r.lastNote ? `hace ${days(r.lastNote)} días` : '—'} |`)
}
md.push('')
md.push('## Relays que usan')
md.push('')
md.push('«No responde» puede ser momentáneo: varios relays limitan las conexiones seguidas desde una misma IP. Un relay que falla en una pasada y responde en otra está operativo.')
md.push('')
md.push('| Relay | Comunidades | Ya en PlazaP2P | Responde | Pide autenticación | De pago | Escritura restringida | Software |')
md.push('|---|---|---|---|---|---|---|---|')
const yes = b => (b ? 'sí' : 'no')
for (const r of relayRows) {
  md.push(`| \`${r.url}\` | ${r.users.length} | ${yes(r.ours)} | ${r.answers ? `sí (${r.ms} ms)` : `no${r.closed ? ` (${r.closed})` : ''}`} | ${yes(r.auth)} | ${yes(r.payment)} | ${yes(r.restricted)} | ${r.software} |`)
}
md.push('')
md.push('## Candidatos para ampliar la red')
md.push('')
md.push('Relays que no están ya en PlazaP2P, responden, no piden autenticación ni pago, no restringen la escritura y los usa más de una comunidad:')
md.push('')
const cands = relayRows.filter(candidate)
if (cands.length) for (const r of cands) md.push(`- \`${r.url}\` — ${r.users.length} comunidades (${r.users.join(', ')}), ${r.ms} ms.`)
else md.push('- Ninguno cumple todo. Ver la tabla de arriba.')
md.push('')
md.push('Añadir uno es decisión del mantenedor: se pone en `data/config.json → relays` (o como relay solo de lectura) y se vuelve a firmar la configuración. Un relay nuevo solo amplía dónde se lee y se publica; cada evento sigue verificándose por su firma.')
md.push('')
const out = path.join(root, 'docs', 'relays-comunidades.md')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, md.join('\n'))
console.log(`\nInforme: ${path.relative(process.cwd(), out)} — ${cands.length} candidatos.`)
process.exit(0)
