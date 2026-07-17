// transaccion.js — Wizard de publicación de ventas/compras/intercambios
// SOLO disponible en Modo Perfil (npub vinculado y verificado)
// Si el usuario está en Modo Seudónimo, worker.js redirige a redirect-guide.js

import { InlineKeyboard } from 'grammy'
import { checkNpubAge } from '../nostr.js'
import { publishTransaccion } from '../publish.js'
import { uploadPhoto } from '../upload.js'
import { escMd, sanitizeContact } from '../utils.js'

const CANCELAR = '/cancelar'
const SALTAR   = '/saltar'

const MONEDAS = [
  { code: 'EUR',  label: '€ Euro'     },
  { code: 'USD',  label: '$ Dólar'    },
  { code: 'BTC',  label: '₿ Bitcoin'  },
  { code: 'SATS', label: '⚡ Satoshi' },
]

const ALCANCE = [
  { id: 'local',           label: '🏙 Local'           },
  { id: 'nacional',        label: '🇪🇸 Nacional'        },
  { id: 'internacional',   label: '🌍 Internacional'    },
  { id: 'online',          label: '💻 Online'           },
]

const CONTACTO_TIPOS = [
  { id: 'telegram', label: '✈️ Telegram @usuario' },
  { id: 'nostr',    label: '🟣 Mi npub Nostr'     },
  { id: 'email',    label: '📧 Email'              },
]

/**
 * Wizard de transacción (venta/compra/intercambio).
 * Solo se registra/invoca cuando el usuario está en Modo Perfil.
 * @param {string} opts.tipoTag — 'plazap2p-venta' | 'plazap2p-compra' | 'plazap2p-intercambio'
 */
export async function transaccionConversation(conversation, ctx, opts) {
  const userId = ctx.from?.id
  if (!userId) return

  // Doble verificación de seguridad: no debe ejecutarse sin Modo Perfil
  if (ctx.session?.mode !== 'perfil' || !ctx.session?.linked_npub_verified) {
    await ctx.reply(
      '⚠️ Este wizard requiere *Modo Perfil* \\(npub verificado\\)\\.\n\nUsa /vincular para vincular tu identidad Nostr\\.',
      { parse_mode: 'MarkdownV2' }
    )
    return
  }

  const userPubHex = ctx.session.linked_npub_hex
  const userNpub   = ctx.session.linked_npub

  const tipoTag   = opts.tipoTag ?? 'plazap2p-venta'
  const tipoLabel = tipoTag === 'plazap2p-venta'       ? '📦 Venta'
                  : tipoTag === 'plazap2p-compra'      ? '🛒 Compra'
                  : tipoTag === 'plazap2p-intercambio' ? '🔄 Intercambio'
                  : 'Transacción'

  // Verificar antigüedad del npub (mínimo 30 días para transacciones)
  await ctx.reply('🔍 Verificando antigüedad de tu identidad Nostr\\.\\.\\. un momento\\.', { parse_mode: 'MarkdownV2' })

  const ageDays = await conversation.external(() => checkNpubAge(userPubHex))

  if (ageDays === null) {
    await ctx.reply(
      '⚠️ No se pudo verificar la antigüedad de tu npub\\.\n\n' +
      '_Los relays no respondieron\\. Inténtalo de nuevo en unos minutos\\._',
      { parse_mode: 'MarkdownV2', reply_markup: new InlineKeyboard().text('🏪 Menú', 'back_to_menu') }
    )
    return
  }

  if (ageDays < 30) {
    await ctx.reply(
      `⚠️ *Npub demasiado reciente*\n\n` +
      `Tu cuenta Nostr tiene ${ageDays} día${ageDays !== 1 ? 's' : ''} de antigüedad\\.\n` +
      `Para publicar transacciones se requieren al menos *30 días* para reducir el riesgo de scam\\.\n\n` +
      `_Puedes publicar servicios, eventos, comunidades y herramientas sin esta restricción\\._`,
      { parse_mode: 'MarkdownV2', reply_markup: new InlineKeyboard().text('🏪 Menú', 'back_to_menu') }
    )
    return
  }

  const ageNote = `✅ Cuenta Nostr verificada: ${ageDays} días de antigüedad`

  // Paso 1: título
  await ctx.reply(
    `${escMd(tipoLabel)} *— Paso 1/6*\n\n` +
    `🔵 *Modo Perfil* \\| Tu npub: \`${escMd(userNpub.slice(0, 18))}…\`\n` +
    `${escMd(ageNote)}\n\n` +
    '¿Título del artículo/producto?\n\n_Escribe /cancelar para salir\\._',
    { parse_mode: 'MarkdownV2' }
  )
  let title
  while (true) {
    const msgCtx = await conversation.waitFor('message:text')
    const raw = msgCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw.length < 3)   { await ctx.reply('⚠️ Título demasiado corto \\(mínimo 3 chars\\)\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length > 150) { await ctx.reply('⚠️ Título demasiado largo \\(máx 150 chars\\)\\.', { parse_mode: 'MarkdownV2' }); continue }
    title = raw; break
  }

  // Paso 2: descripción
  await ctx.reply(
    `📝 *Paso 2/6* — Descripción detallada\\.\n\nEstado, características, condiciones\\. ` +
    `Sé claro y honesto — tu reputación quedará ligada a este anuncio\\.`,
    { parse_mode: 'MarkdownV2' }
  )
  let desc
  while (true) {
    const msgCtx = await conversation.waitFor('message:text')
    const raw = msgCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw.length < 20)   { await ctx.reply('⚠️ Descripción muy corta \\(mínimo 20 chars\\)\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length > 1500) { await ctx.reply('⚠️ Demasiado larga \\(máx 1500 chars\\)\\.', { parse_mode: 'MarkdownV2' }); continue }
    desc = raw; break
  }

  // Paso 3: precio y moneda
  await ctx.reply(
    '💰 *Paso 3/6* — Precio\\.\n\nEscribe solo el número \\(ej: `150`, `0\\.005`\\)\\.\n' +
    'Escribe `negociar` para "A negociar"\\. Escribe /saltar para omitir\\.',
    { parse_mode: 'MarkdownV2' }
  )
  let price = null
  let currency = null
  while (true) {
    const msgCtx = await conversation.waitFor('message:text')
    const raw = msgCtx.message.text.trim().toLowerCase()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw === SALTAR) break
    if (raw === 'negociar' || raw === 'a negociar') { price = 'A negociar'; break }
    const num = parseFloat(raw.replace(',', '.'))
    if (isNaN(num) || num < 0) {
      await ctx.reply('⚠️ Número no válido\\. Ej: `150`, `0\\.005`, `negociar` o /saltar\\.', { parse_mode: 'MarkdownV2' })
      continue
    }
    price = raw.slice(0, 50)
    // Pedir moneda — loop para ignorar callbacks ajenos y validar código
    const monedaKb = new InlineKeyboard()
    MONEDAS.forEach(m => monedaKb.text(m.label, `tx_moneda_${m.code}`))
    await ctx.reply('💱 ¿En qué moneda?', { reply_markup: monedaKb })
    while (true) {
      const monedaCtx = await conversation.waitFor('callback_query:data')
      await monedaCtx.answerCallbackQuery()
      const cbData = monedaCtx.callbackQuery.data
      if (!cbData.startsWith('tx_moneda_')) continue
      const code = cbData.replace('tx_moneda_', '')
      if (!MONEDAS.find(m => m.code === code)) continue
      currency = code; break
    }
    break
  }

  // Paso 4: alcance/ubicación
  const alcanceKb = new InlineKeyboard()
  ALCANCE.forEach((a, i) => {
    alcanceKb.text(a.label, `tx_alcance_${a.id}`)
    if (i % 2 === 1) alcanceKb.row()
  })
  await ctx.reply('📍 *Paso 4/6* — Alcance o zona:', { parse_mode: 'MarkdownV2', reply_markup: alcanceKb })
  const alcanceCtx = await conversation.waitFor('callback_query:data')
  await alcanceCtx.answerCallbackQuery()
  const alcanceId    = alcanceCtx.callbackQuery.data.replace('tx_alcance_', '')
  const alcanceLabel = ALCANCE.find(a => a.id === alcanceId)?.label ?? alcanceId

  // Paso 5: foto (opcional)
  await ctx.reply(
    '📸 *Paso 5/6* — Foto del artículo \\(opcional\\)\n\nEnvía una foto o escribe /saltar\\.',
    { parse_mode: 'MarkdownV2' }
  )
  let imageUrl = null
  while (true) {
    const inp = await conversation.waitFor(['message:photo', 'message:text'])
    if (inp.message?.photo) {
      const photo = inp.message.photo[inp.message.photo.length - 1]
      await ctx.reply('📸 Procesando imagen\\.\\.\\.', { parse_mode: 'MarkdownV2' })
      try {
        imageUrl = await conversation.external(() => uploadPhoto(photo, opts.botToken))
        await ctx.reply(imageUrl ? '✅ Foto guardada\\.' : '⚠️ No se pudo guardar\\. Continuando sin foto\\.', { parse_mode: 'MarkdownV2' })
      } catch (e) {
        console.warn('[transaccion] uploadPhoto error:', e.message)
        await ctx.reply('⚠️ Error al procesar la foto\\. Continuando sin imagen\\.', { parse_mode: 'MarkdownV2' })
      }
      break
    }
    const text = inp.message?.text?.trim() ?? ''
    if (text === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (text === SALTAR) break
    await ctx.reply('⚠️ Envía una foto o escribe /saltar\\.', { parse_mode: 'MarkdownV2' })
  }

  // Paso 6: contacto — OPCIONES PREDEFINIDAS (anti-phishing)
  const contactKb = new InlineKeyboard()
  CONTACTO_TIPOS.forEach(c => contactKb.text(c.label, `tx_ctype_${c.id}`).row())
  await ctx.reply(
    '📞 *Paso 6/6* — ¿Cómo te contactan?\n\n' +
    '⚠️ _Solo se permiten tipos de contacto verificados para prevenir phishing\\._',
    { parse_mode: 'MarkdownV2', reply_markup: contactKb }
  )
  const ctypeCtx = await conversation.waitFor('callback_query:data')
  await ctypeCtx.answerCallbackQuery()
  const contactType = ctypeCtx.callbackQuery.data.replace('tx_ctype_', '')

  let contact = null
  if (contactType === 'telegram') {
    await ctx.reply('✈️ Escribe tu @usuario de Telegram \\(solo el alias, sin espacios\\):', { parse_mode: 'MarkdownV2' })
    while (true) {
      const msgCtx = await conversation.waitFor('message:text')
      const raw = msgCtx.message.text.trim()
      if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
      // Validar que parece un @usuario
      const alias = raw.startsWith('@') ? raw : '@' + raw
      if (!/^@[a-zA-Z0-9_]{3,32}$/.test(alias)) {
        await ctx.reply('⚠️ Alias no válido\\. Solo letras, números y _ \\(3\\-32 chars\\)\\.', { parse_mode: 'MarkdownV2' }); continue
      }
      contact = alias; break
    }
  } else if (contactType === 'nostr') {
    // Usar el npub ya vinculado (completo — bech32 es exactamente 63 chars)
    contact = userNpub
  } else if (contactType === 'email') {
    await ctx.reply('📧 Escribe tu dirección de email:', { parse_mode: 'MarkdownV2' })
    while (true) {
      const msgCtx = await conversation.waitFor('message:text')
      const raw = msgCtx.message.text.trim()
      if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
        await ctx.reply('⚠️ Email no válido\\. Ej: `usuario@dominio\\.com`', { parse_mode: 'MarkdownV2' }); continue
      }
      contact = raw.slice(0, 100); break
    }
  }

  // Resumen y confirmación
  const npubShort = escMd(userNpub.slice(0, 18) + '…')
  let summary = `📋 *Resumen de ${escMd(tipoLabel)}:*\n\n`
  summary += `📌 *Artículo:* ${escMd(title)}\n`
  summary += `📝 *Descripción:* ${escMd(desc.slice(0, 150))}${desc.length > 150 ? '\\.\\.\\.' : ''}\n`
  if (price && currency) summary += `💰 *Precio:* ${escMd(price)} ${escMd(currency)}\n`
  else if (price)         summary += `💰 *Precio:* ${escMd(price)}\n`
  summary += `📍 *Alcance:* ${escMd(alcanceLabel)}\n`
  if (imageUrl) summary += `📸 *Foto:* ✅ incluida\n`
  if (contact)  summary += `📞 *Contacto:* ${escMd(contact)}\n`
  summary += `🔵 *Tu npub:* \`${npubShort}\` \\(vinculado al anuncio\\)\n`
  summary += '\n⚠️ _Tu identidad Nostr quedará asociada permanentemente a este anuncio\\._\n\n¿Publicar?'

  await ctx.reply(summary, {
    parse_mode: 'MarkdownV2',
    reply_markup: new InlineKeyboard().text('✅ Publicar', 'tx_confirm').text('❌ Cancelar', 'tx_cancel')
  })

  const confirmCtx = await conversation.waitFor('callback_query:data')
  await confirmCtx.answerCallbackQuery()
  if (confirmCtx.callbackQuery.data === 'tx_cancel') {
    await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return
  }

  const rlOk = await conversation.external(() => opts.checkRateLimit(userId))
  if (!rlOk) {
    await ctx.reply('⚠️ Has alcanzado el límite de 5 publicaciones por día\\. Vuelve mañana\\.', { parse_mode: 'MarkdownV2' }); return
  }

  await ctx.reply('⏳ Publicando en Nostr\\.\\.\\. un momento\\.', { parse_mode: 'MarkdownV2' })

  const data = {
    type: tipoTag.replace('plazap2p-', ''),
    tipoTag, title, desc, price, currency,
    alcanceId, alcanceLabel,
    imageUrl,
    contact: contact ? sanitizeContact(contact) : null,
    ageDays,
  }
  const result = await conversation.external(() =>
    publishTransaccion(data, opts.botNsec, opts.env, userId, userPubHex)
  )

  const errKb = new InlineKeyboard().text('🏪 Menú principal', 'back_to_menu')
  if (!result.ok) {
    await ctx.reply(`❌ Error al publicar: ${escMd(result.error ?? 'Error desconocido')}`, { parse_mode: 'MarkdownV2', reply_markup: errKb })
    return
  }
  const backKb = new InlineKeyboard()
  if (result.naddr) backKb.url('🔗 Ver en Nostr', `https://njump.me/${result.naddr}`).row()
  backKb.text('🏪 Menú principal', 'back_to_menu')
  let reply = `✅ *${escMd(tipoLabel)} publicada en ${result.published}/${result.total} relays*\n\n`
  reply += `🔵 Vinculada a tu npub: \`${npubShort}\`\n`
  reply += `👥 La comunidad puede ver tu historial y valorarte con /valorar`
  await ctx.reply(reply, { parse_mode: 'MarkdownV2', reply_markup: backKb })
}
