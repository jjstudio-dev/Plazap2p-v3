// github.js — Actualiza data/ratings.json en el repo GitHub via API REST
// Usa fetch nativo de CF Workers (sin dependencias adicionales)
// Solo escribe datos agregados y públicos (avg, n, aspectos) — nunca tokens ni datos privados

import { createClient } from '@supabase/supabase-js'

/**
 * Lee todos los ratings de Supabase, construye un snapshot mínimo y público,
 * y lo commitea en el repo GitHub (RATINGS_FILE_PATH o por defecto data/ratings.json).
 *
 * Se llama tras cada updateSellerRating exitoso.
 * Si las vars de GitHub no están configuradas, emite un warning y retorna.
 */
export async function refreshRatingsSnapshot(env) {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = env

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    console.warn('[github] GITHUB_TOKEN/OWNER/REPO no configurados — snapshot omitido')
    return
  }

  // 1. Leer todos los sellers desde Supabase
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })

  // Paginación defensiva: leer en bloques de 1000 para evitar timeout en free tier
  const PAGE_SIZE = 1000
  let sellers = []
  let page = 0
  while (true) {
    const { data, error } = await sb
      .from('seller_ratings')
      .select('pubkey_hex,avg_overall,review_count,avg_comunicacion,avg_cumplimiento,avg_precio_justo,avg_rapidez,avg_confianza,last_active')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (error) {
      console.error('[github] Error leyendo seller_ratings:', error.message)
      return
    }
    if (!data || data.length === 0) break
    sellers = sellers.concat(data)
    if (data.length < PAGE_SIZE) break
    page++
  }

  // 2. Construir snapshot público mínimo
  //    Solo datos agregados. Sin reviewer_tokens ni datos internos.
  const snapshot = {
    v: 1,
    updated_at: Math.floor(Date.now() / 1000),
    sellers: {}
  }

  for (const s of (sellers ?? [])) {
    if (!s.pubkey_hex || typeof s.pubkey_hex !== 'string') continue
    snapshot.sellers[s.pubkey_hex] = {
      avg: s.avg_overall ?? 0,
      n:   s.review_count ?? 0,
      aspects: {
        comunicacion: s.avg_comunicacion ?? null,
        cumplimiento: s.avg_cumplimiento ?? null,
        precio_justo: s.avg_precio_justo ?? null,
        rapidez:      s.avg_rapidez      ?? null,
        confianza:    s.avg_confianza    ?? null
      },
      last_active: s.last_active ?? null
    }
  }

  // 3. Ruta del archivo en el repo (configurable via env var)
  // Sanitize: only allow safe path chars; prevent path traversal
  const rawPath = (env.RATINGS_FILE_PATH || 'Plazap2p-v3/data/ratings.json').trim()
  const filePath = rawPath.replace(/[^a-zA-Z0-9/_.-]/g, '').replace(/\.\.+/g, '.') || 'Plazap2p-v3/data/ratings.json'
  const safeOwner = GITHUB_OWNER.replace(/[^a-zA-Z0-9_.-]/g, '')
  const safeRepo  = GITHUB_REPO.replace(/[^a-zA-Z0-9_.-]/g, '')

  const apiUrl  = `https://api.github.com/repos/${safeOwner}/${safeRepo}/contents/${filePath}`
  const headers = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'User-Agent':    'PlazaP2P-Bot/1.0',
    'Accept':        'application/vnd.github.v3+json',
    'Content-Type':  'application/json'
  }

  // 4–6. Obtener SHA, codificar y commitear con retry automático en 409 (SHA stale)
  const jsonStr = JSON.stringify(snapshot, null, 2)
  // Codificación UTF-8 → base64 sin usar unescape() (deprecado).
  // TextEncoder produce bytes UTF-8; String.fromCharCode convierte a latin1 para btoa.
  const utf8Bytes = new TextEncoder().encode(jsonStr)
  let binary = ''
  utf8Bytes.forEach(b => { binary += String.fromCharCode(b) })
  const content = btoa(binary)

  async function getSha() {
    try {
      const getRes = await fetch(apiUrl, { method: 'GET', headers })
      if (getRes.ok) {
        const meta = await getRes.json()
        return meta.sha ?? null
      }
      if (getRes.status !== 404) {
        console.warn('[github] GET ratings.json status:', getRes.status)
      }
    } catch (e) {
      console.warn('[github] Error obteniendo SHA:', e.message)
    }
    return null
  }

  async function commitSnapshot(sha) {
    const body = {
      message: 'chore: update ratings snapshot [bot]',
      content,
      ...(sha ? { sha } : {})
    }
    return fetch(apiUrl, { method: 'PUT', headers, body: JSON.stringify(body) })
  }

  let sha = await getSha()
  let putRes = await commitSnapshot(sha)

  // Reintentar una vez si 409: SHA stale por escritura concurrente
  if (putRes.status === 409) {
    console.warn('[github] 409 SHA stale — reintentando con SHA fresco')
    sha = await getSha()
    putRes = await commitSnapshot(sha)
  }

  if (!putRes.ok) {
    const errBody = await putRes.json().catch(() => ({}))
    console.error('[github] Error commitando ratings.json:', putRes.status, errBody.message ?? '')
  }
}
