// ics-export.js — BON-006: exportar un evento del calendario (NIP-52) a .ics
//
// Función pura: recibe el mismo objeto que ya devuelve parseCalendarEvent()
// en app.js ({title, summary, location, start, end, tzid, links, naddr, kind}),
// sin tocar DOM ni red. start/end son {ts, date} | null (ts = Unix seconds).
//
// Decisiones deliberadas (ver auditoría del plan):
//  - Siempre en UTC para eventos con hora (31923) — nunca VTIMEZONE/tzid,
//    para no arrastrar reglas de horario de verano. tzid se ignora para el
//    cálculo.
//  - Eventos de todo el día (31922): VALUE=DATE con los componentes de
//    fecha LOCALES de `date` (no UTC) — coincide con cómo se construyó ese
//    Date en parseCalendarDate() (mediodía local), así se evita que la
//    conversión a UTC desplace el día en zonas horarias alejadas de UTC.
//    DTEND es exclusivo por spec: se añade +1 día.
//  - UID = naddr del evento (estable entre descargas repetidas del mismo
//    anuncio, ya que parseCalendarEvent() calcula el naddr sin relays).

const pad = (n, len = 2) => String(n).padStart(len, '0')

function utcDateTime(ts) {
  const d = new Date(ts * 1000)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

function localDateOnly(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

function addDaysLocal(date, days) {
  const d = new Date(date.getTime())
  d.setDate(d.getDate() + days)
  return d
}

/** Orden de escape RFC 5545: backslash primero, luego coma/punto y coma, luego salto de línea. */
function escapeIcsText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/** Plegado de línea a 75 octetos (UTF-8), continuaciones con un espacio inicial. */
function foldLine(line) {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const decoder = new TextDecoder()
  const chunks = []
  let start = 0
  while (start < bytes.length) {
    const limit = chunks.length === 0 ? 75 : 74 // continuaciones: 1 octeto lo ocupa el espacio inicial
    let end = Math.min(start + limit, bytes.length)
    while (end < bytes.length && (bytes[end] & 0xC0) === 0x80) end-- // no partir un carácter multibyte
    chunks.push(decoder.decode(bytes.slice(start, end)))
    start = end
  }
  return chunks.map((c, i) => (i === 0 ? c : ' ' + c)).join('\r\n')
}

function line(name, value) {
  return foldLine(`${name}:${value}`)
}

/**
 * Construye el texto .ics de un evento de calendario (kind 31922/31923).
 * @param {object} event - objeto devuelto por parseCalendarEvent() en app.js
 * @param {number} [now] - Unix seconds para DTSTAMP (inyectable para tests)
 * @returns {string} texto ICS completo (CRLF), listo para descargar
 */
export function buildIcs(event, now = Math.floor(Date.now() / 1000)) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PlazaP2P//Eventos//ES', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT']

  const uid = event.naddr ? `${event.naddr}@plazap2p` : `${now}-${Math.random().toString(36).slice(2)}@plazap2p`
  lines.push(line('UID', uid))
  lines.push(line('DTSTAMP', utcDateTime(now)))
  lines.push(line('SUMMARY', escapeIcsText(event.title)))
  if (event.summary) lines.push(line('DESCRIPTION', escapeIcsText(event.summary)))
  if (event.location) lines.push(line('LOCATION', escapeIcsText(event.location)))

  if (event.kind === 31922 && event.start?.date) {
    lines.push(line('DTSTART;VALUE=DATE', localDateOnly(event.start.date)))
    const endDate = event.end?.date ? addDaysLocal(event.end.date, 1) : addDaysLocal(event.start.date, 1)
    lines.push(line('DTEND;VALUE=DATE', localDateOnly(endDate)))
  } else if (event.start?.ts) {
    lines.push(line('DTSTART', utcDateTime(event.start.ts)))
    if (event.end?.ts) lines.push(line('DTEND', utcDateTime(event.end.ts)))
  }

  if (event.links?.[0]) lines.push(line('URL', escapeIcsText(event.links[0])))

  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}
