// vincular.js — Wizard de vinculación de identidad Nostr (challenge-response)
// Flujo: usuario envía su npub → bot genera código único → usuario publica nota en Nostr →
// bot verifica en relays que la nota existe y está firmada por ese npub → vinculación activa

import { InlineKeyboard } from 'grammy'
import { nip19 }          from 'nostr-tools'
import { verifyChallenge } from '../nostr.js'
import { generateChallenge, escMd } from '../utils.js'

const CANCELAR = '/cancelar'

function parseNpubToHex(input) {
  const trimmed = String(input).trim()
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed.toLowerCase()
  try {
    const decoded = nip19.decode(trimmed)
    if (decoded.type === 'npub') return decoded.data
    if (decoded.type === 'nprofile') return decoded.data.pubkey
  } catch {}
  return null
}

function hexToNpub(hex) {
  try { return nip19.npubEncode(hex) } catch { return hex }
}

/**
 * Wizard de vinculación de identidad Nostr.
 * Requiere que el usuario demuestre posesión de la clave privada del npub.
 *
 * opts.env — env de CF Workers (KV_BOT)
 */
export async function vincularConversation(conversation, ctx, opts) {
  const userId = ctx.from?.id
  if (!userId) return

  // Comprobar si ya tiene npub vinculado
  const existingNpub = ctx.session?.linked_npub
  if (existingNpub && ctx.session?.linked_npub_verified) {
    const kb = new InlineKeyboard()
      .text('🔄 Cambiar npub', 'vincular_cambiar')
      .text('❌ Mantener actual', 'vincular_mantener')

    const npubShort = escMd(existingNpub.slice(0, 20) + '…')
    await ctx.reply(
      `🔗 *Ya tienes un npub vinculado:*\n\`${npubShort}\`\n\n¿Quieres cambiarlo?`,
      { parse_mode: 'MarkdownV2', reply_markup: kb }
    )

    const choice = await conversation.waitFor('callback_query:data')
    await choice.answerCallbackQuery()
    if (choice.callbackQuery.data === 'vincular_mantener') {
      await ctx.reply('✅ Vinculación mantenida\\.', { parse_mode: 'MarkdownV2' })
      return
    }
  }

  // Paso 1: pedir el npub
  await ctx.reply(
    '🔗 *Vincular identidad Nostr — Paso 1/3*\n\n' +
    'Envía tu *npub1\\.\\.\\.* \\(o pubkey hex de 64 chars\\)\\.\n\n' +
    'Esto vincula tu cuenta de Telegram con tu identidad Nostr\\. ' +
    'Necesitarás demostrar que controlas esa clave\\.\n\n' +
    '_Escribe /cancelar para salir\\._',
    { parse_mode: 'MarkdownV2' }
  )

  let npubHex
  let npub
  while (true) {
    const msgCtx = await conversation.waitFor('message:text')
    const raw = msgCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Vinculación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }

    const hex = parseNpubToHex(raw)
    if (!hex) {
      await ctx.reply(
        '⚠️ Formato no reconocido\\.\n\nEnvía un *npub1\\.\\.\\.* \\(puedes copiarlo desde Primal, Damus, etc\\) o una pubkey hex de 64 caracteres\\.',
        { parse_mode: 'MarkdownV2' }
      )
      continue
    }
    npubHex = hex
    npub = raw.startsWith('npub1') ? raw : hexToNpub(hex)
    break
  }

  // Paso 2: generar challenge y dar instrucciones
  // generateChallenge() y Date.now() deben ir DENTRO de external() para que
  // grammyjs los cachee y no genere valores distintos en cada replay del worker.
  // Si quedan fuera, cada replay produce un code diferente → verifyChallenge falla.
  const { code, challengeTs } = await conversation.external(async () => {
    const c  = generateChallenge()
    const ts = Math.floor(Date.now() / 1000)
    await opts.env.KV_BOT.put(
      `challenge:${userId}`,
      JSON.stringify({ npubHex, npub, code: c, ts }),
      { expirationTtl: 900 }
    )
    return { code: c, challengeTs: ts }
  })
  const challengeText = `plazap2p-verify-${code}`

  await ctx.reply(
    '🔐 *Paso 2/3 — Publica esta nota en Nostr*\n\n' +
    'Para verificar que controlas este npub, publica la siguiente nota desde tu cliente Nostr \\(Primal, Damus, Amethyst, Nostrudel, etc\\):\n\n' +
    `\`${escMd(challengeText)}\`\n\n` +
    '⏱ _Tienes 15 minutos para publicarla\\._\n\n' +
    '1\\. Abre tu cliente Nostr\n' +
    '2\\. Crea una nueva nota con exactamente ese texto\n' +
    '3\\. Publica y vuelve aquí\n' +
    '4\\. Pulsa el botón de abajo cuando lo hayas hecho',
    { parse_mode: 'MarkdownV2', reply_markup: new InlineKeyboard().text('✅ Ya la publiqué', 'vincular_verificar') }
  )

  // Paso 3: verificar en relays
  const verifyCtx = await conversation.waitFor('callback_query:data')
  await verifyCtx.answerCallbackQuery()

  await ctx.reply('🔍 Buscando tu nota en los relays Nostr\\.\\.\\. \\(puede tardar hasta 10 segundos\\)', { parse_mode: 'MarkdownV2' })

  const found = await conversation.external(() =>
    verifyChallenge(npubHex, challengeText, challengeTs - 60)
  )

  if (!found) {
    const kb = new InlineKeyboard()
      .text('🔄 Intentar de nuevo', 'vincular_reintentar')
      .text('❌ Cancelar', 'vincular_cancelar2')

    await ctx.reply(
      '❌ *No se encontró la nota en los relays\\.*\n\n' +
      'Posibles causas:\n' +
      '• La nota aún no se propagó \\(espera 1\\-2 minutos e inténtalo de nuevo\\)\n' +
      '• El texto no era exacto \\(debe ser solo: `' + escMd(challengeText) + '`\\)\n' +
      '• Tu relay tardó en propagar\n\n' +
      '_El código expira en 15 minutos desde que fue generado\\._',
      { parse_mode: 'MarkdownV2', reply_markup: kb }
    )

    const retryCtx = await conversation.waitFor('callback_query:data')
    await retryCtx.answerCallbackQuery()

    if (retryCtx.callbackQuery.data === 'vincular_reintentar') {
      await ctx.reply('🔍 Buscando de nuevo\\.\\.\\. un momento\\.', { parse_mode: 'MarkdownV2' })
      const found2 = await conversation.external(() =>
        verifyChallenge(npubHex, challengeText, challengeTs - 60)
      )
      if (!found2) {
        await ctx.reply(
          '❌ Sigue sin encontrarse la nota\\.\n\nEspera unos minutos y usa /vincular para iniciar el proceso de nuevo\\.',
          { parse_mode: 'MarkdownV2' }
        )
        return
      }
      // Si encontró en el segundo intento, continúa normalmente
    } else {
      await ctx.reply('❌ Vinculación cancelada\\.', { parse_mode: 'MarkdownV2' })
      return
    }
  }

  // Verificación OK — guardar en sesión
  if (ctx.session) {
    ctx.session.linked_npub = npub
    ctx.session.linked_npub_hex = npubHex
    ctx.session.linked_npub_verified = true
    ctx.session.mode = 'perfil'
  }

  // Limpiar challenge de KV
  await conversation.external(() => opts.env.KV_BOT.delete(`challenge:${userId}`))

  const npubDisplay = escMd(npub.slice(0, 20) + '…')
  await ctx.reply(
    '✅ *¡Identidad Nostr verificada\\!*\n\n' +
    `🔗 *Npub vinculado:* \`${npubDisplay}\`\n` +
    '🛡 *Modo:* Perfil \\(identidad verificada\\)\n\n' +
    'Ahora puedes publicar ventas, compras e intercambios con tu identidad Nostr\\.\n\n' +
    '_Tu npub quedará asociado a las publicaciones en la red Nostr\\. ' +
    'La comunidad podrá ver tu historial y valorarte\\._',
    { parse_mode: 'MarkdownV2', reply_markup: new InlineKeyboard().text('🏪 Menú principal', 'back_to_menu') }
  )
}
