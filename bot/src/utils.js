// utils.js — Shared utilities for the PlazaP2P Telegram bot

/** Escape special characters for Telegram MarkdownV2 */
export function escMd(str) {
  return String(str).replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&')
}

/**
 * Parse a free-text date string into a UNIX timestamp.
 * Accepts ISO-like formats: "2025-07-12", "2025-07-12 18:00", "2025-07-12T18:00"
 * Returns null if parsing fails.
 */
export function parseEventDate(raw) {
  if (!raw) return null
  // Normalize separators
  const normalized = raw.trim().replace(/\s+/, 'T').replace(/\s+.+$/, '')
  const ts = Date.parse(normalized)
  if (isNaN(ts)) return null
  return Math.floor(ts / 1000)
}
