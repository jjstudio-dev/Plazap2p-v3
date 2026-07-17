// upload.js — descarga foto de Telegram y la sube a Telegra.ph
// Usa únicamente Web APIs nativas (fetch, FormData, Blob) — compatible con Cloudflare Workers

/**
 * Descarga una foto de Telegram y la sube a Telegra.ph.
 * @param {object} photo  — objeto de la foto de Telegram (mayor resolución del array)
 * @param {string} botToken — token del bot para acceder a la API de Telegram
 * @returns {Promise<string|null>} URL pública de Telegra.ph, o null si falla
 */
export async function uploadPhoto(photo, botToken) {
  try {
    const fileResp = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${photo.file_id}`
    )
    const fileData = await fileResp.json()
    if (!fileData.ok || !fileData.result?.file_path) return null

    const imgResp = await fetch(
      `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`
    )
    if (!imgResp.ok) return null
    const imgBuffer = await imgResp.arrayBuffer()

    const form = new FormData()
    form.append('file', new Blob([imgBuffer], { type: 'image/jpeg' }), 'photo.jpg')

    const upResp = await fetch('https://telegra.ph/upload', { method: 'POST', body: form })
    if (!upResp.ok) return null

    const upData = await upResp.json()
    const src = upData[0]?.src
    if (!Array.isArray(upData) || typeof src !== 'string' || !src.startsWith('/')) return null

    return 'https://telegra.ph' + src
  } catch {
    return null
  }
}
