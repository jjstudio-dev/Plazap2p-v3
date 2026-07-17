// valorar.js — Wizard de valoración pseudónima de vendedores/compradores
// Anti-fraude: token SHA-256 por par (userId, sellerHex), TTL 30 días
// Requiere Modo Perfil: garantiza que cada rater tiene un npub Nostr verificado
// Verificabilidad pública: publica cada rating como evento Nostr kind 1985 (NIP-32)

import { InlineKeyboard } from 'grammy'
import { nip19 }          from 'nostr-tools'
import { updateSellerRating } from '../supabase.js'
import { refreshRatingsSnapshot } from '../github.js'
import { publishLabel } from '../nostr.js'
import { escMd, formatStars } from '../utils.js'

const CANCELAR = '/cancelar'

const ASPECTOS = [
  { id: 'comunicacion', label: 'Comunicación', icon: '💬' },
  { id: 'cumplimiento', label: 'Cumplimiento',  icon: '✅' },
  { id: 'precio_justo', label: 'Precio justo',  icon: '💰' },
  { id: 'rapidez',      label: 'Rapidez',        icon: '⚡' },
  { id: 'confianza',    label: 'Confianza',       icon: '🔐' },
]

// Hash irreversible para anti-duplicado: SHA-256(userId ":" sellerHex)
async function makeReviewerToken(userId, sellerHex) {
  const encoder = new TextEncoder()
  const data    = encoder.encode(String(userId) + ':' + sellerHex)
  const buf     = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24)
}

// Hash para el proof del evento Nostr (diferente salt para separar del token KV)
async function makeProofHash(userId, sellerHex) {
  const encoder = new TextEncoder()
  const data    = encoder.encode('proof:' + String(userId) + ':' + sellerHex)
  const buf     = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function parseToHex(input) {
  const trimmed = input.trim()
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed.toLowerCase()
  try {
    const decoded = nip19.decode(trimmed)
    if (decoded.type === 'npub') return decoded.data
    if (decoded.type === 'nprofile') return decoded.data.pubkey
  } catch {}
  return null
}

function starKeyboard(prefix) {
  return new InlineKeyboard()
    .text('⭐ 1', `${prefix}1`)
    .text('⭐⭐ 2', `${prefix}2`)
    .text('⭐⭐⭐ 3', `${prefix}3`)
    .row()
    .text('⭐⭐⭐⭐ 4', `${prefix}4`)
    .text('⭐⭐⭐⭐⭐ 5', `${prefix}5`)
}

function aspectKeyboard(prefix) {
  return new InlineKeyboard()
    .text('1', `${prefix}1`)
    .text('2', `${prefix}2`)
    .text('3', `${prefix}3`)
    .text('4', `${prefix}4`)
    .text('5', `${prefix}5`)
    .text('Saltar →', `${prefix}skip`)
}

// Fecha UTC ISO "2026-06-21" — consistente con worker.js
const todayUTC = () => new Date().toISOString().slice(0, 10)

/**
 * Wizard de valoración.
 * Requiere Modo Perfil activo (npub vinculado y verificado).
 * opts.env — env de CF Workers (KV_BOT, SUPABASE_URL, BOT_NSEC, etc.)
 */
export async function valorarConversation(conversation, ctx, opts) {
  const userId = ctx.from?.id
  if (!userId) return

  // Guard: requiere Modo Perfil para garantizar trazabilidad de identidad
  if (!ctx.session?.linked_npub_verified) {
    await ctx.reply(
      '🔒 *Valorar requiere Modo Perfil*\n\n' +
      'Para valorar a otros usuarios necesitas vincular tu identidad Nostr\\.\n' +
      'Esto garantiza que las valoraciones tienen trazabilidad y evita ataques de cuentas falsas\\.\n\n' +
      'Usa /vincular para vincular tu npub\\.',
      { parse_mode: 'MarkdownV2', reply_markup: new InlineKeyboard().text('🔗 Vincular mi npub', 'goto_vincular') }
    )
    return
  }

  // Rate limit pre-check (informativo, sin consumir cuota aún)
  const rlKey  = `rl_rv:${userId}:${todayUTC()}`
  const rlRaw  = await conversation.external(() => opts.env.KV_BOT.get(rlKey))
  if (parseInt(rlRaw || '0', 10) >= 3) {
    await ctx.reply(
      '⚠️ Has alcanzado el límite de *3 valoraciones por día*\\. Vuelve mañana\\.',
      { parse_mode: 'MarkdownV2' }
    )
    return
  }

  // Paso 1: ¿A quién quieres valorar?
  await ctx.reply(
    '⭐ *Valorar usuario — Paso 1/4*\n\n' +
    'Envía el *npub* o *pubkey hex* de la persona que quieres valorar\\.\n\n' +
    '_Escribe /cancelar en cualquier momento para salir\\._',
    { parse_mode: 'MarkdownV2' }
  )

  let sellerHex
  while (true) {
    const msgCtx = await conversation.waitFor('message:text')
    const raw    = msgCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Valoración cancelada\\.', { parse_mode: 'MarkdownV2' }); return }

    const hex = parseToHex(raw)
    if (!hex) {
      await ctx.reply(
        '⚠️ Formato no reconocido\\. Envía un *npub1\\.\\.\\.* o una *pubkey hex* de 64 caracteres\\.',
        { parse_mode: 'MarkdownV2' }
      )
      continue
    }

    // Anti-auto-valoración: el npub vinculado del rater no puede ser el mismo que el ratee
    if (ctx.session?.linked_npub_hex && ctx.session.linked_npub_hex === hex) {
      await ctx.reply(
        '⚠️ No puedes valorarte a ti mismo\\.\n\nEnvía el npub de otra persona\\.',
        { parse_mode: 'MarkdownV2' }
      )
      continue
    }

    sellerHex = hex
    break
  }

  // Paso 2: Valoración global (1–5)
  await ctx.reply(
    '⭐ *Paso 2/4 — Valoración global*\n\n¿Cuántas estrellas le das en general?',
    { parse_mode: 'MarkdownV2', reply_markup: starKeyboard('val_global_') }
  )

  let overall
  while (true) {
    const cbCtx = await conversation.waitFor('callback_query:data')
    await cbCtx.answerCallbackQuery()
    const data = cbCtx.callbackQuery.data
    if (!data.startsWith('val_global_')) continue
    const num = parseInt(data.replace('val_global_', ''), 10)
    if (num >= 1 && num <= 5) { overall = num; break }
  }

  // Paso 3: Aspectos (5 subpreguntas opcionales)
  await ctx.reply(
    '📊 *Paso 3/4 — Aspectos \\(opcional\\)*\n\nPuedes valorar cada aspecto o pulsar *Saltar →* para omitirlo\\.',
    { parse_mode: 'MarkdownV2' }
  )

  const aspects = {}
  for (const asp of ASPECTOS) {
    await ctx.reply(
      `${asp.icon} *${escMd(asp.label)}* — ¿Cómo lo valorarías?`,
      { parse_mode: 'MarkdownV2', reply_markup: aspectKeyboard(`val_asp_${asp.id}_`) }
    )
    while (true) {
      const cbCtx = await conversation.waitFor('callback_query:data')
      await cbCtx.answerCallbackQuery()
      const data = cbCtx.callbackQuery.data
      const prefix = `val_asp_${asp.id}_`
      if (!data.startsWith(prefix)) continue
      const val = data.replace(prefix, '')
      if (val === 'skip') { aspects[asp.id] = null; break }
      const num = parseInt(val, 10)
      if (num >= 1 && num <= 5) { aspects[asp.id] = num; break }
    }
  }

  // Paso 4: Comentario opcional
  const comentKeyboard = new InlineKeyboard()
    .text('Añadir comentario', 'val_coment_si')
    .text('Sin comentario',    'val_coment_no')

  await ctx.reply(
    '📝 *Paso 4/4 — Comentario \\(opcional\\)*\n\n' +
    '¿Quieres añadir un breve comentario? _Se publicará de forma pseudónima en Nostr\\._',
    { parse_mode: 'MarkdownV2', reply_markup: comentKeyboard }
  )

  let comentario = null
  const comentChoice = await conversation.waitFor('callback_query:data')
  await comentChoice.answerCallbackQuery()

  if (comentChoice.callbackQuery.data === 'val_coment_si') {
    await ctx.reply('✍️ Escribe tu comentario \\(máx\\. 300 caracteres\\)\\.', { parse_mode: 'MarkdownV2' })
    while (true) {
      const msgCtx = await conversation.waitFor('message:text')
      const raw    = msgCtx.message.text.trim()
      if (raw === CANCELAR) { await ctx.reply('❌ Valoración cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
      if (raw.length > 300) {
        await ctx.reply('⚠️ Demasiado largo \\(máx 300 caracteres\\)\\. Inténtalo de nuevo\\.', { parse_mode: 'MarkdownV2' })
        continue
      }
      comentario = raw
        .replace(/<[^>]*>/g, '')
        .replace(/https?:\/\/\S+/gi, '[url]')
        .replace(/nostr:[a-zA-Z0-9]+/gi, '[nostr-link]')
        .replace(/wss?:\/\/\S+/gi, '[relay]')
        .replace(/\n{3,}/g, '\n\n')
        .slice(0, 300)
      break
    }
  }

  // Resumen y confirmación
  const npubShort = 'npub1' + sellerHex.slice(0, 8) + '…'
  const aspectLines = ASPECTOS
    .filter(a => aspects[a.id] != null)
    .map(a => `${a.icon} ${escMd(a.label)}: ${formatStars(aspects[a.id])}`)
    .join('\n')

  let resumen = `📋 *Resumen de tu valoración:*\n\n`
  resumen += `👤 *Usuario:* \`${escMd(npubShort)}\`\n`
  resumen += `🌟 *Global:* ${formatStars(overall)} \\(${overall}/5\\)\n`
  if (aspectLines) resumen += `\n${aspectLines}\n`
  if (comentario)  resumen += `\n💬 ${escMd(comentario)}\n`
  resumen += '\n_¿Confirmas la valoración?_'

  await ctx.reply(resumen, {
    parse_mode: 'MarkdownV2',
    reply_markup: new InlineKeyboard().text('✅ Confirmar', 'val_confirm').text('❌ Cancelar', 'val_cancel')
  })

  const confirmCtx = await conversation.waitFor('callback_query:data')
  await confirmCtx.answerCallbackQuery()
  if (confirmCtx.callbackQuery.data === 'val_cancel') {
    await ctx.reply('❌ Valoración cancelada\\.', { parse_mode: 'MarkdownV2' })
    return
  }

  await ctx.reply('⏳ Registrando valoración\\.\\.\\.', { parse_mode: 'MarkdownV2' })

  // Side-effects en conversation.external para garantizar ejecución única
  const { allowed, alreadyReviewed, reviewerToken } = await conversation.external(async () => {
    const token    = await makeReviewerToken(userId, sellerHex)
    const tokenKey = `rv:${token}`
    const existing = await opts.env.KV_BOT.get(tokenKey)

    if (existing) return { allowed: false, alreadyReviewed: true, reviewerToken: null }

    const rlRaw2 = await opts.env.KV_BOT.get(rlKey)
    const count  = parseInt(rlRaw2 || '0', 10)
    if (count >= 3) return { allowed: false, alreadyReviewed: false, reviewerToken: null }

    // TTL 30 días — permite revalorar tras nuevas interacciones
    await opts.env.KV_BOT.put(tokenKey, '1', { expirationTtl: 2592000 })
    await opts.env.KV_BOT.put(rlKey, String(count + 1), { expirationTtl: 86400 })
    return { allowed: true, alreadyReviewed: false, reviewerToken: token }
  })

  if (alreadyReviewed) {
    await ctx.reply(
      'ℹ️ Ya has valorado a este usuario en los últimos 30 días\\.\n\nPodrás volver a valorarle después de ese período\\.',
      { parse_mode: 'MarkdownV2' }
    )
    return
  }
  if (!allowed) {
    await ctx.reply('⚠️ Has alcanzado el límite de *3 valoraciones por día*\\. Vuelve mañana\\.', { parse_mode: 'MarkdownV2' })
    return
  }

  // Publicar en Nostr como kind 1985 (NIP-32 label) para verificabilidad pública
  const nostrEventId = opts.botNsec
    ? await conversation.external(async () => {
        try {
          const proofHash = await makeProofHash(userId, sellerHex)
          const event = await publishLabel(opts.botNsec, sellerHex, overall, comentario, proofHash)
          return event?.id ?? null
        } catch (e) {
          console.warn('[valorar] Error publicando kind 1985:', e.message)
          return null
        }
      })
    : null

  // Actualizar Supabase con stored procedure atómico + insertar en seller_reviews
  const { ok, newAvg, newN } = await conversation.external(() =>
    updateSellerRating(sellerHex, { overall, aspects }, reviewerToken, nostrEventId, opts.env, comentario)
  )

  if (!ok) {
    await ctx.reply('❌ Error al registrar la valoración\\. Por favor, inténtalo más tarde\\.', { parse_mode: 'MarkdownV2' })
    return
  }

  // Actualizar snapshot público en GitHub
  await conversation.external(() => refreshRatingsSnapshot(opts.env))

  const avgFormatted  = escMd(newAvg.toFixed(1))
  const sellerDisplay = escMd(npubShort)
  await ctx.reply(
    `✅ *Valoración registrada*\n\n` +
    `${formatStars(overall)} ${overall}/5\n` +
    `📊 ${sellerDisplay} ahora tiene *${avgFormatted}★* \\(${newN} valoración${newN !== 1 ? 'es' : ''}\\)\n\n` +
    `🔍 _Verificable en Nostr: busca eventos kind 1985 del bot_\n` +
    `_Tu valoración es pseudónima — tu ID de Telegram nunca se publica\\._`,
    { parse_mode: 'MarkdownV2' }
  )
}
