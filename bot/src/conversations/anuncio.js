import { InlineKeyboard } from 'grammy'
import { publishEvent } from '../nostr.js'
import { uploadPhoto } from '../upload.js'
import { escMd, sanitizeContact } from '../utils.js'

const CANCELAR = '/cancelar'
const SALTAR   = '/saltar'
const MAX_TITLE = 200
const MAX_DESC  = 2000

const MONEDAS = [
  { code: 'EUR',  label: '€ Euro'     },
  { code: 'USD',  label: '$ Dólar'    },
  { code: 'BTC',  label: '₿ Bitcoin'  },
  { code: 'SATS', label: '⚡ Satoshi' },
]

/**
 * Wizard de publicación de anuncio de compra o venta.
 * @param {object} opts.checkRateLimit — función async de rate limit KV
 * @param {string} opts.botToken       — token Telegram para descargar fotos
 * @param {string} opts.botNsec        — clave nsec del bot para firmar eventos Nostr
 */
export async function anuncioConversation(conversation, ctx, opts) {
  // Paso 1: tipo de anuncio
  const tipoKeyboard = new InlineKeyboard()
    .text('📦 Quiero vender', 'tipo_venta')
    .text('🛒 Quiero comprar', 'tipo_compra')

  await ctx.reply(
    '📢 *Publicar Anuncio — Paso 1/8*\n\n¿Qué tipo de anuncio quieres publicar?\n\n_Escribe /cancelar en cualquier momento para salir\\._',
    { parse_mode: 'MarkdownV2', reply_markup: tipoKeyboard }
  )

  const tipoCtx = await conversation.waitFor('callback_query:data')
  await tipoCtx.answerCallbackQuery()

  const esVenta = tipoCtx.callbackQuery.data === 'tipo_venta'
  const tipoTag = esVenta ? 'plazap2p-venta' : 'plazap2p-compra'
  const tipoLabel = esVenta ? '📦 Venta' : '🛒 Compra'

  // Paso 2: título del artículo
  await ctx.reply(
    `✅ *${escMd(tipoLabel)} seleccionada*\n\n📝 *Paso 2/8* — ¿Qué artículo o producto es?`,
    { parse_mode: 'MarkdownV2' }
  )

  let title
  while (true) {
    const titleCtx = await conversation.waitFor('message:text')
    const raw = titleCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw.length < 3)   { await ctx.reply('⚠️ Título demasiado corto \\(mínimo 3 caracteres\\)\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length > MAX_TITLE) { await ctx.reply(`⚠️ Título demasiado largo \\(máx ${MAX_TITLE} caracteres\\)\\.`, { parse_mode: 'MarkdownV2' }); continue }
    title = raw; break
  }

  // Paso 3: descripción
  await ctx.reply(
    '📝 *Paso 3/8* — Describe el artículo\\.\n\nEstado, características, por qué lo vendes/buscas, condiciones\\.',
    { parse_mode: 'MarkdownV2' }
  )

  let desc
  while (true) {
    const descCtx = await conversation.waitFor('message:text')
    const raw = descCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw.length < 10)  { await ctx.reply('⚠️ Descripción demasiado corta \\(mínimo 10 caracteres\\)\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length > MAX_DESC) { await ctx.reply(`⚠️ Demasiado larga \\(máx ${MAX_DESC} caracteres\\)\\.`, { parse_mode: 'MarkdownV2' }); continue }
    desc = raw; break
  }

  // Paso 4: foto (opcional)
  await ctx.reply(
    '📸 *Paso 4/8* — Foto del artículo \\(opcional\\)\n\nEnvía una foto o escribe /saltar\\.',
    { parse_mode: 'MarkdownV2' }
  )

  let imageUrl = null
  while (true) {
    const photoOrText = await conversation.waitFor(['message:photo', 'message:text'])

    if (photoOrText.message?.photo) {
      const photo = photoOrText.message.photo[photoOrText.message.photo.length - 1]
      await ctx.reply('📸 Procesando imagen\\.\\.\\. un momento\\.', { parse_mode: 'MarkdownV2' })

      // conversation.external() garantiza que el upload solo ocurre una vez aunque la
      // conversación se repita en memoria (patrón correcto de @grammyjs/conversations)
      imageUrl = await conversation.external(() => uploadPhoto(photo, opts.botToken))

      const msg = imageUrl
        ? '✅ Foto guardada\\.'
        : '⚠️ No se pudo guardar la foto\\. Continuando sin imagen\\.'
      await ctx.reply(msg, { parse_mode: 'MarkdownV2' })
      break
    }

    const text = photoOrText.message?.text?.trim() ?? ''
    if (text === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (text === SALTAR) break
    await ctx.reply('⚠️ Envía una foto o escribe /saltar\\.', { parse_mode: 'MarkdownV2' })
  }

  // Paso 5: precio
  const precioPregunta = esVenta
    ? '💰 *Paso 5/8* — ¿Precio de venta?\n\nEscribe solo el número \\(ej: `150`, `0\\.005`\\)\\. Escribe /saltar para omitir\\.'
    : '💰 *Paso 5/8* — ¿Presupuesto máximo o precio objetivo? \\(opcional\\)\n\nEscribe /saltar para omitir\\.'

  await ctx.reply(precioPregunta, { parse_mode: 'MarkdownV2' })

  let price = null
  while (true) {
    const priceCtx = await conversation.waitFor('message:text')
    const raw = priceCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw === SALTAR) break
    const num = parseFloat(raw.replace(',', '.'))
    if (isNaN(num) || num < 0) {
      await ctx.reply('⚠️ Número no válido \\(ej: `150`, `0\\.005`\\) o /saltar para omitir\\.', { parse_mode: 'MarkdownV2' })
      continue
    }
    price = raw.slice(0, 50); break
  }

  // Paso 6: moneda (solo si hay precio)
  let currency = null
  if (price) {
    const monedaKeyboard = new InlineKeyboard()
    MONEDAS.forEach(m => monedaKeyboard.text(m.label, `moneda_a_${m.code}`))
    await ctx.reply('💱 ¿En qué moneda?', { parse_mode: 'MarkdownV2', reply_markup: monedaKeyboard })
    const monedaCtx = await conversation.waitFor('callback_query:data')
    await monedaCtx.answerCallbackQuery()
    currency = monedaCtx.callbackQuery.data.replace('moneda_a_', '')
  }

  // Paso 7: ubicación
  await ctx.reply(
    '📍 *Paso 6/8* — ¿Ubicación o zona de envío? \\(opcional\\)\n\nEj: `Madrid`, `Toda España`, `Online`\\. Escribe /saltar para omitir\\.',
    { parse_mode: 'MarkdownV2' }
  )
  const locationCtx = await conversation.waitFor('message:text')
  const locationRaw = locationCtx.message.text.trim()
  if (locationRaw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
  // Sanear caracteres de control que podrían alterar el formato de eventos Nostr
  const location = locationRaw !== SALTAR
    ? locationRaw.replace(/[\r\n\t]/g, ' ').trim().slice(0, 200)
    : null

  // Paso 8: nombre/alias para atribución
  await ctx.reply(
    '👤 *Paso 7/8* — ¿Cómo quieres que te mencionen en la publicación?\n\nEj: `@pepito`, `Pepito García`, `Bitcoin Max`\\.\nEscribe /saltar para publicar de forma anónima\\.\n\n⚠️ _Este nombre será visible en la red Nostr \\(público y permanente\\)\\._',
    { parse_mode: 'MarkdownV2' }
  )
  const aliasCtx = await conversation.waitFor('message:text')
  const aliasRaw = aliasCtx.message.text.trim()
  if (aliasRaw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
  // Escapar chars que podrían generar formato involuntario en clientes Nostr con Markdown
  const alias = aliasRaw !== SALTAR
    ? aliasRaw.replace(/[\r\n\t`*_[\]]/g, ' ').trim().slice(0, 100)
    : null

  // Paso 8: contacto
  await ctx.reply(
    '📞 *Paso 8/8* — ¿Cómo te contactan los interesados? \\(opcional\\)\n\nEj: `@usuario`, `npub1\\.\\.\\.`, `tu@email\\.com`, `⚡ tu@wallet\\.com`\\.\nEscribe /saltar para omitir\\.',
    { parse_mode: 'MarkdownV2' }
  )
  const contactCtx = await conversation.waitFor('message:text')
  const contactRaw = contactCtx.message.text.trim()
  if (contactRaw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
  // sanitizeContact (mismo que servicio.js/evento.js): elimina URLs para prevenir phishing
  const contact = contactRaw !== SALTAR ? sanitizeContact(contactRaw, 200) : null

  // Resumen
  let summary = `📋 *Resumen del anuncio \\(${escMd(tipoLabel)}\\):*\n\n`
  summary += `📌 *Artículo:* ${escMd(title)}\n`
  summary += `📝 *Descripción:* ${escMd(desc.slice(0, 200))}${desc.length > 200 ? '\\.\\.\\.' : ''}\n`
  if (imageUrl) summary += `📸 *Foto:* ✅ incluida\n`
  if (price && currency) summary += `💰 *Precio:* ${escMd(price)} ${escMd(currency)}\n`
  else if (price)        summary += `💰 *Precio:* ${escMd(price)}\n`
  if (location) summary += `📍 *Ubicación:* ${escMd(location)}\n`
  if (alias)    summary += `👤 *Nombre:* ${escMd(alias)}\n`
  if (contact)  summary += `📞 *Contacto:* ${escMd(contact)}\n`
  summary += '\n_Se publicará en Nostr con la cuenta del bot\\._\n\n¿Publicar?'

  const keyboard = new InlineKeyboard()
    .text('✅ Publicar', 'anuncio_confirm').text('❌ Cancelar', 'anuncio_cancel')

  await ctx.reply(summary, { parse_mode: 'MarkdownV2', reply_markup: keyboard })

  const confirmCtx = await conversation.waitFor('callback_query:data')
  await confirmCtx.answerCallbackQuery()

  if (confirmCtx.callbackQuery.data === 'anuncio_cancel') {
    await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return
  }

  // Rate limit — se comprueba justo antes de publicar (las cancelaciones no consumen cuota)
  if (!await opts.checkRateLimit(ctx.from.id)) {
    await ctx.reply('⚠️ Has alcanzado el límite de 5 publicaciones por día\\. Vuelve mañana\\.', { parse_mode: 'MarkdownV2' })
    return
  }

  await ctx.reply('⏳ Publicando en Nostr\\.\\.\\. un momento\\.', { parse_mode: 'MarkdownV2' })

  // Construir content con footer de atribución
  let content = desc
  content += alias
    ? `\n\n---\n📢 Publicado vía PlazaP2P Bot · de parte de ${alias}`
    : '\n\n---\n📢 Publicado vía PlazaP2P Bot'

  // Construir tags (kind 30402 — NIP-99 classified listing)
  const tags = [
    ['title',   title],
    ['summary', desc],
    ['t',       'plazap2p'],
    ['t',       tipoTag],
    ['client',  'PlazaP2P Bot', 'https://jjstudio-dev.github.io/Plazap2p-v3/'],
  ]
  if (imageUrl)          tags.push(['image',    imageUrl])
  if (price && currency) tags.push(['price',    price, currency])
  else if (price)        tags.push(['price',    price])
  if (location)          tags.push(['location', location])
  if (contact)           tags.push(['contact',  contact])
  if (alias)             tags.push(['proxy',    alias, 'plazap2p-bot'])

  const backKb = new InlineKeyboard().text('🏪 Menú principal', 'back_to_menu')

  try {
    const { published, total, naddr } = await publishEvent(opts.botNsec, tags, content, 30402)
    let reply = `✅ *Anuncio publicado en ${published}/${total} relays*\n\nAparecerá en PlazaP2P en el Mercado en breve\\.`
    if (naddr) reply += `\n\n🔗 Ver: https://njump\\.me/${escMd(naddr)}`
    await ctx.reply(reply, { parse_mode: 'MarkdownV2', reply_markup: backKb })

    // Guardar en lista del usuario para /misanuncios
    if (naddr && opts.env?.KV_BOT) {
      await conversation.external(async () => {
        try {
          const key = `pub:${ctx.from.id}`
          const raw = await opts.env.KV_BOT.get(key)
          const list = raw ? JSON.parse(raw) : []
          list.unshift({ naddr, title: title.slice(0, 60), ts: Date.now(), kind: 30402 })
          if (list.length > 10) list.splice(10)
          await opts.env.KV_BOT.put(key, JSON.stringify(list), { expirationTtl: 7776000 })
        } catch (e) { console.warn('[misanuncios] Error guardando anuncio:', e.message) }
      })
    }
  } catch (err) {
    await ctx.reply(`❌ Error al publicar: ${escMd(err.message)}`, { parse_mode: 'MarkdownV2', reply_markup: backKb })
  }
}
