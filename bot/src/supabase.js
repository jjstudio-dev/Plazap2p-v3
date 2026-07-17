// supabase.js — Capa de acceso a Supabase para reputación de vendedores
// Compatible con Cloudflare Workers: @supabase/supabase-js v2 usa Fetch API nativo
// auth: { persistSession: false } evita intentar acceder a localStorage (no disponible en Workers)

import { createClient } from '@supabase/supabase-js'

function getClient(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL o SUPABASE_SERVICE_KEY no configurados')
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
}

function isValidPubkey(hex) {
  return typeof hex === 'string' && /^[0-9a-f]{64}$/.test(hex)
}

/**
 * Lee los datos de reputación de un vendedor.
 * @returns {object|null}
 */
export async function getSellerRating(pubkeyHex, env) {
  if (!isValidPubkey(pubkeyHex)) return null
  const sb = getClient(env)
  const { data, error } = await sb
    .from('seller_ratings')
    .select('*')
    .eq('pubkey_hex', pubkeyHex)
    .maybeSingle()
  if (error) {
    console.error('[supabase] getSellerRating error:', error.message)
    return null
  }
  return data
}

/**
 * Actualiza (o crea) los datos de reputación de un vendedor usando el stored procedure
 * increment_seller_rating(), que ejecuta el UPDATE de forma atómica sin race conditions.
 *
 * También inserta un registro en seller_reviews para audit trail.
 *
 * @param {string} pubkeyHex
 * @param {{ overall: number, aspects: Record<string,number|null> }} scores
 * @param {string} reviewerToken — SHA-256(userId:sellerHex) truncado a 24 chars
 * @param {string|null} nostrEventId — id del evento kind 1985 publicado, o null
 * @param {object} env
 * @param {string|null} comentario — comentario ya sanitizado (máx 300 chars)
 * @returns {{ ok: boolean, newAvg: number, newN: number }}
 */
export async function updateSellerRating(pubkeyHex, scores, reviewerToken, nostrEventId, env, comentario = null) {
  if (!isValidPubkey(pubkeyHex)) return { ok: false, newAvg: 0, newN: 0 }
  if (!Number.isInteger(scores.overall) || scores.overall < 1 || scores.overall > 5) {
    return { ok: false, newAvg: 0, newN: 0 }
  }

  const sb = getClient(env)

  // Construir el JSONB de aspectos para el stored procedure
  // Solo incluimos los aspectos con valor válido (null → columna omitida en SQL)
  const aspectsJson = {}
  const ASPECT_KEYS = ['comunicacion', 'cumplimiento', 'precio_justo', 'rapidez', 'confianza']
  for (const key of ASPECT_KEYS) {
    const v = scores.aspects?.[key]
    if (Number.isInteger(v) && v >= 1 && v <= 5) {
      aspectsJson[key] = v
    }
    // Si null/undefined → no incluir → el stored proc lo trata como "no votado"
  }

  // Llamar al stored procedure atómico (elimina race condition)
  const { data, error } = await sb.rpc('increment_seller_rating', {
    p_pubkey:  pubkeyHex,
    p_overall: scores.overall,
    p_aspects: aspectsJson,
  })

  if (error) {
    console.error('[supabase] increment_seller_rating error:', error.message)
    return { ok: false, newAvg: 0, newN: 0 }
  }

  const newAvg = Number(data?.avg_overall ?? 0)
  const newN   = Number(data?.review_count ?? 0)

  // Insertar en seller_reviews para audit trail
  // No es bloqueante — si falla, el rating ya fue guardado por el stored proc
  try {
    await sb.from('seller_reviews').insert({
      ratee_hex:      pubkeyHex,
      reviewer_token: reviewerToken,
      overall:        scores.overall,
      comunicacion:   aspectsJson.comunicacion   ?? null,
      cumplimiento:   aspectsJson.cumplimiento   ?? null,
      precio_justo:   aspectsJson.precio_justo   ?? null,
      rapidez:        aspectsJson.rapidez        ?? null,
      confianza:      aspectsJson.confianza       ?? null,
      comentario:     comentario ?? null,
      nostr_event_id: nostrEventId ?? null,
    })
  } catch (e) {
    console.warn('[supabase] seller_reviews insert error:', e.message)
  }

  return { ok: true, newAvg, newN }
}

/**
 * Keep-alive: query liviana para evitar que Supabase pausa el proyecto por inactividad.
 */
export async function ping(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return
  try {
    const sb = getClient(env)
    await sb.from('seller_ratings').select('pubkey_hex').limit(1)
  } catch (e) {
    console.warn('[supabase] ping error:', e.message)
  }
}
