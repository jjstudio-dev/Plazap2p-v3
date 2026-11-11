// publish-utils.js — Utilidades puras, originalmente portadas VERBATIM del
// bot de Telegram V3 (retirado de este repo; ver historial de git para el
// origen exacto). Misma lógica de sanitización/validación.
// Solo se portan las funciones sin dependencia de Telegram:
// NO se portan hashTelegramId (no hay Telegram ID), escMd (MarkdownV2) ni
// generateChallenge (la app no necesita /vincular: el usuario firma sus eventos).

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
    // Direcciones sin protocolo: `www.sitio.com` y `sitio.com/pago`. Antes solo
    // se cortaban las que llevaban `https://` y una lista de acortadores (VW3-09).
    // Un correo (`ana@correo.test`) no lleva barra y se conserva.
    .replace(/\bwww\.\S+/gi, '[url]')
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\/\S*/gi, '[url]')
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

