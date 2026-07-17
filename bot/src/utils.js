// utils.js — Shared utilities for the PlazaP2P Telegram bot

/**
 * Escapa caracteres especiales para Telegram MarkdownV2.
 * El backslash (\) debe escaparse primero — de lo contrario, los escapes
 * generados para otros caracteres quedarían doble-escapados.
 * Lista completa según la especificación de Telegram:
 * \ _ * [ ] ( ) ~ ` > # + - = | { } . !
 */
export function escMd(str) {
  return String(str)
    .replace(/\\/g, '\\\\')   // backslash primero — siempre antes que el resto
    .replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&')
}

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
 * Compute a SHA-256 hash of a Telegram user ID.
 * Used as a stable, non-reversible fingerprint across sessions.
 * The salt "plazap2p:" prevents rainbow table lookups for small IDs.
 */
export async function hashTelegramId(userId) {
  const encoder = new TextEncoder()
  const data = encoder.encode('plazap2p:' + String(userId))
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
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

/**
 * Generate a random hex challenge code for npub verification.
 * Returns 12-char uppercase hex string.
 */
export function generateChallenge() {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}
