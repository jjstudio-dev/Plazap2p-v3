// publish-utils.js — Utilidades puras portadas VERBATIM de bot/src/utils.js
// (misma lógica de sanitización/validación que usa el bot — mantener en sync).
// Solo se portan las funciones sin dependencia de Telegram:
// NO se portan hashTelegramId (no hay Telegram ID), escMd (MarkdownV2) ni
// generateChallenge (la app no necesita /vincular: el usuario firma sus eventos).

/**
 * Parse a free-text date string into a UNIX timestamp.
 * Accepts: "2025-07-12", "2025-07-12 18:00", "2025-07-12T18:00"
 * Returns null if parsing fails.
 */
export function parseEventDate(raw) {
  if (!raw) return null
  const normalized = raw.trim().replace(/\s+/, 'T').replace(/\s+.+$/, '')
  const ts = Date.parse(normalized)
  if (isNaN(ts)) return null
  return Math.floor(ts / 1000)
}

/**
 * Sanitize a contact field: strips URLs and limits length.
 * Prevents phishing links from appearing in published contact fields.
 */
export function sanitizeContact(raw, maxLen = 200) {
  if (!raw) return null
  let safe = String(raw)
    .replace(/[\r\n]+/g, ' ')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/wss?:\/\/\S+/gi, '[url]')
    .replace(/nostr:[^\s]+/gi, '[nostr-link]')
    .replace(/\b(?:t\.me|telegram\.me|tg\.me|discord\.gg|wa\.me|bit\.ly|tinyurl\.com|linktr\.ee|lnk\.bio|rebrand\.ly|ow\.ly|linktw\.ee|carrd\.co|solo\.to)\/\S+/gi, '[url]')
    .trim()
    .slice(0, maxLen)
  return safe || null
}

/**
 * Validate a URL string. Returns the URL if valid https/http, null otherwise.
 */
export function validateUrl(raw) {
  if (!raw) return null
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    // Rechazar URLs con userinfo (https://evil.com@legit.com/) — vector de phishing
    if (url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

/**
 * Format a star rating as emoji string.
 * @param {number} n — number 1-5 (rounded)
 */
export function formatStars(n) {
  const count = Math.max(0, Math.min(5, Math.round(n)))
  return '⭐'.repeat(count) + '☆'.repeat(5 - count)
}
