#!/usr/bin/env node
// Verifica en Nostr las comunidades de data/comunidades-2140.json que tienen
// npub: su perfil (kind 0), su lista de relays (kind 10002) y su última
// actividad; después prueba cada relay que usan (NIP-11 y una consulta real) y
// añade lo que dicen de él los monitores NIP-66, más los relays que esos
// monitores sitúan en España.
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
// ── NIP-66: lo que dicen de cada relay los monitores que publican en Nostr ──
// Cada monitor publica un informe (kind 30166) por relay: tiempos, requisitos
// (!auth, !payment), software, país (etiqueta l «countryCode»). Se juntan los
// de varios monitores: un dato que repiten varios independientes vale más.
const MONITOR_RELAYS = ['wss://relay.nostr.watch', 'wss://history.nostr.watch', 'wss://relaypag.es', 'wss://monitorlizard.nostr1.com']
const NIP66_SINCE = now - 3 * 86400

const median = xs => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b)
  return v.length ? v[Math.floor(v.length / 2)] : null
}

async function nip66Reports(filter) {
  const byRelay = new Map()
  for (const m of MONITOR_RELAYS) {
    const { events } = await req(m, { kinds: [30166], since: NIP66_SINCE, limit: 500, ...filter }, 12000)
    for (const e of events) {
      const url = normalizeRelayUrl(e.tags.find(t => t[0] === 'd')?.[1])
      if (!url) continue
      if (!byRelay.has(url)) byRelay.set(url, new Map())
      const prev = byRelay.get(url).get(e.pubkey)
      if (!prev || e.created_at > prev.created_at) byRelay.get(url).set(e.pubkey, e)   // el último de cada monitor
    }
  }
  return byRelay
}

function summarize(url, reports) {
  const evs = [...(reports?.values() || [])]
  const tag = (e, n) => e.tags.filter(t => t[0] === n).map(t => t[1])
  const reqs = new Set(evs.flatMap(e => tag(e, 'R')))
  const country = evs.flatMap(e => e.tags.filter(t => t[0] === 'l' && t[2] === 'countryCode' && /^[A-Z]{2}$/.test(t[1])).map(t => t[1]))[0] || null
  return {
    url,
    monitors: evs.length,
    open: median(evs.map(e => Number(tag(e, 'rtt-open')[0]))),
    read: median(evs.map(e => Number(tag(e, 'rtt-read')[0]))),
    auth: reqs.has('auth'),
    payment: reqs.has('payment'),
    country,
    software: (evs.map(e => tag(e, 's')[0]).find(Boolean) || '—').replace(/^.*\//, '').replace(/\.git$/, '').slice(0, 30),
  }
}

console.log('\nNIP-66: informes de los monitores…')
const communityNip66 = await nip66Reports({ '#d': [...relayUse.keys()].flatMap(u => [u, `${u}/`]) })
const spainNip66 = await nip66Reports({ '#l': ['ES'] })
console.log(`  ${communityNip66.size} relays de las comunidades con informe; ${spainNip66.size} relays situados en España.`)

const relayRows = []
for (const [url, users] of [...relayUse.entries()].sort((a, b) => b[1].size - a[1].size)) {
  const info = await nip11(url)
  let probe = await req(url, { kinds: [1], limit: 1 }, 8000)
  // Muchos relays limitan conexiones seguidas desde la misma IP: un segundo intento tras una pausa.
  if (!probe.eose) { await new Promise(r => setTimeout(r, 3000)); probe = await req(url, { kinds: [1], limit: 1 }, 8000) }
  const lim = info?.limitation || {}
  const n66 = summarize(url, communityNip66.get(url))
  relayRows.push({
    url, users: [...users], ours: ours.has(url),
    software: info?.software ? String(info.software).replace(/^.*\//, '').slice(0, 40) : n66.software,
    auth: !!lim.auth_required || n66.auth || /auth/i.test(probe.closed || ''),
    payment: !!lim.payment_required || n66.payment,
    restricted: !!lim.restricted_writes,
    answers: probe.eose, ms: probe.ms, closed: probe.closed,
    monitors: n66.monitors, open: n66.open, country: n66.country,
  })
  console.log(`  ${url}: ${probe.eose ? `responde (${probe.ms} ms)` : `no responde (${probe.closed || 'sin EOSE'})`}, ${n66.monitors} monitores`)
}

// Relays que PlazaP2P ya probó y descartó: no se proponen otra vez.
const EXCLUIDOS = new Map([
  ['wss://relay.snort.social', 'PlazaP2P lo quitó: acepta los eventos pero no los guarda (D6)'],
])
// Software de uso concreto: no es un relay general para anuncios.
const USO_CONCRETO = new Map([
  ['haven', 'relay personal: normalmente solo publica su dueño'],
  ['nostube-server', 'relay de vídeos'],
])

const spainRows = []
for (const [url, reps] of spainNip66.entries()) {
  const r = { ...summarize(url, reps), ours: ours.has(url) }
  if (r.country !== 'ES') continue
  const lim = (await nip11(url))?.limitation || {}
  r.restricted = !!lim.restricted_writes
  r.auth = r.auth || !!lim.auth_required
  r.payment = r.payment || !!lim.payment_required
  r.note = USO_CONCRETO.get(r.software) || (r.restricted ? 'escritura restringida' : '')
  spainRows.push(r)
}
spainRows.sort((a, b) => (b.monitors - a.monitors) || ((a.open ?? 1e9) - (b.open ?? 1e9)))

// Criterio: no está ya en PlazaP2P, sin autenticación ni pago, varios monitores
// lo ven (o responde a la prueba directa) y abre la conexión en menos de 1,5 s.
const FAST_MS = 1500
const healthy = r => !r.ours && !EXCLUIDOS.has(r.url) && !r.auth && !r.payment && !r.restricted && (r.open == null || r.open < FAST_MS)
// Candidato: sano, revisado por varios monitores y de uso general, y además lo
// usan varias comunidades o está en España. El resto de los sanos, en observación.
const fromCommunities = relayRows.filter(r => healthy(r) && r.answers && r.monitors >= 2)
const fromSpain = spainRows.filter(r => healthy(r) && r.monitors >= 2 && !relayUse.has(r.url))
const candidates = [
  ...fromCommunities.filter(r => r.users.length >= 2 || r.country === 'ES')
    .map(r => ({ url: r.url, why: `lo usan ${r.users.length} comunidades (${r.users.join(', ')}); ${r.monitors} monitores; abre en ${r.open ?? r.ms} ms` })),
  ...fromSpain.filter(r => !r.note)
    .map(r => ({ url: r.url, why: `situado en España; ${r.monitors} monitores; abre en ${r.open} ms; ${r.software}` })),
]
const watching = [
  ...fromCommunities.filter(r => r.users.length < 2 && r.country !== 'ES')
    .map(r => ({ url: r.url, why: `solo lo usa ${r.users.join(', ')}; ${r.monitors} monitores; ${r.open ?? r.ms} ms` })),
  ...fromSpain.filter(r => r.note).map(r => ({ url: r.url, why: `en España, pero ${r.note}` })),
]
const excluded = [...relayUse.keys()].filter(u => EXCLUIDOS.has(u)).map(u => ({ url: u, why: EXCLUIDOS.get(u) }))

const md = []
md.push('# Relays de las comunidades Bitcoin de España')
md.push('')
md.push(`Generado el ${new Date().toISOString().slice(0, 10)} con \`node tools/verificar-relays-comunidades.mjs\` (solo lectura). Comunidades: [2140meetups.com](https://2140meetups.com/comunidades/) y [BTC Map](https://btcmap.org/communities). Salud de los relays: informes NIP-66 (kind 30166) de los monitores que publican en Nostr, más una prueba directa.`)
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
md.push('«No responde» puede ser momentáneo: varios relays limitan las conexiones seguidas desde una misma IP. «Monitores» es cuántos monitores NIP-66 independientes lo han revisado en los últimos 3 días; «Apertura» es la mediana de lo que tardan en conectar.')
md.push('')
md.push('| Relay | Comunidades | Ya en PlazaP2P | Responde | Monitores | Apertura | País | Autenticación | Pago | Software |')
md.push('|---|---|---|---|---|---|---|---|---|---|')
const yes = b => (b ? 'sí' : 'no')
for (const r of relayRows) {
  md.push(`| \`${r.url}\` | ${r.users.length} | ${yes(r.ours)} | ${r.answers ? `sí (${r.ms} ms)` : `no${r.closed ? ` (${r.closed})` : ''}`} | ${r.monitors} | ${r.open != null ? `${r.open} ms` : '—'} | ${r.country || '—'} | ${yes(r.auth)} | ${yes(r.payment)} | ${r.software} |`)
}
md.push('')
md.push('## Relays situados en España (NIP-66)')
md.push('')
if (spainRows.length) {
  md.push('| Relay | Ya en PlazaP2P | Monitores | Apertura | Lectura | Autenticación | Pago | Software | Nota |')
  md.push('|---|---|---|---|---|---|---|---|---|')
  for (const r of spainRows) {
    md.push(`| \`${r.url}\` | ${yes(r.ours)} | ${r.monitors} | ${r.open != null ? `${r.open} ms` : '—'} | ${r.read != null ? `${r.read} ms` : '—'} | ${yes(r.auth)} | ${yes(r.payment)} | ${r.software} | ${r.note || ''} |`)
  }
} else {
  md.push('- Ningún monitor ha informado de relays en España en los últimos 3 días.')
}
md.push('')
md.push('## Candidatos para ampliar la red')
md.push('')
md.push(`Relays que no están ya en PlazaP2P, no piden autenticación ni pago, no restringen la escritura, abren en menos de ${FAST_MS / 1000} s, los revisan al menos dos monitores y además los usan varias comunidades o están en España (y son de uso general):`)
md.push('')
if (candidates.length) for (const c of candidates) md.push(`- \`${c.url}\` — ${c.why}.`)
else md.push('- Ninguno cumple todo. Ver las tablas de arriba.')
md.push('')
md.push('### En observación')
md.push('')
md.push('Sanos, pero de una sola comunidad o de uso concreto:')
md.push('')
if (watching.length) for (const c of watching) md.push(`- \`${c.url}\` — ${c.why}.`)
else md.push('- Ninguno.')
md.push('')
if (excluded.length) {
  md.push('### Descartados')
  md.push('')
  for (const c of excluded) md.push(`- \`${c.url}\` — ${c.why}.`)
  md.push('')
}
md.push('Añadir uno es decisión del mantenedor: se pone en `data/config.json → relays` (o como relay solo de lectura) y se vuelve a firmar la configuración. Antes conviene dejarlo unas semanas en observación y comprobar que guarda lo que se publica. Un relay nuevo solo amplía dónde se lee y se publica; cada evento sigue verificándose por su firma.')
md.push('')
const out = path.join(root, 'docs', 'relays-comunidades.md')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, md.join('\n'))
console.log(`\nInforme: ${path.relative(process.cwd(), out)} — ${spainRows.length} relays en España, ${candidates.length} candidatos.`)
process.exit(0)
