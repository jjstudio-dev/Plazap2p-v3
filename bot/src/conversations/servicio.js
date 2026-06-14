import { InlineKeyboard } from 'grammy'
import { publishEvent } from '../nostr.js'
import { escMd } from '../utils.js'

const CANCELAR = '/cancelar'
const SALTAR   = '/saltar'
const MAX_TITLE = 200
const MAX_DESC  = 2000

const CATEGORIAS = [
  { id: 'consultoria', label: '💡 Consultoría' },
  { id: 'diseno',      label: '🎨 Diseño' },
  { id: 'desarrollo',  label: '💻 Desarrollo' },
  { id: 'educacion',   label: '📚 Educación' },
  { id: 'marketing',   label: '📣 Marketing' },
  { id: 'otros',       label: '🔧 Otros' },
]

const MONEDAS = [
  { code: 'EUR',  label: '€ Euro'     },
  { code: 'USD',  label: '$ Dólar'    },
  { code: 'BTC',  label: '₿ Bitcoin'  },
  { code: 'SATS', label: '⚡ Satoshi' },
]

export async function servicioConversation(conversation, ctx, checkRateLimit) {
  // Paso 1: nombre (obligatorio)
  await ctx.reply(
    '🔧 *Publicar Servicio — Paso 1/6*\n\n¿Nombre del servicio?\n\n_Escribe /cancelar en cualquier momento para salir\\._',
    { parse_mode: 'MarkdownV2' }
  )
  let title
  while (true) {
    const titleCtx = await conversation.waitFor('message:text')
    const raw = titleCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw === SALTAR)   { await ctx.reply('⚠️ El nombre es obligatorio\\. Por favor escríbelo\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length < 5)   { await ctx.reply('⚠️ Nombre demasiado corto \\(mínimo 5 caracteres\\)\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length > MAX_TITLE) { await ctx.reply(`⚠️ Nombre demasiado largo \\(máx ${MAX_TITLE} caracteres\\)\\.`, { parse_mode: 'MarkdownV2' }); continue }
    title = raw; break
  }

  // Paso 2: descripción (obligatorio)
  await ctx.reply('📝 *Paso 2/6* — Describe el servicio: qué ofreces, experiencia, proceso, plazos\\.', { parse_mode: 'MarkdownV2' })
  let desc
  while (true) {
    const descCtx = await conversation.waitFor('message:text')
    const raw = descCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw === SALTAR)   { await ctx.reply('⚠️ La descripción es obligatoria\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length < 10)  { await ctx.reply('⚠️ Descripción demasiado corta \\(mínimo 10 caracteres\\)\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length > MAX_DESC) { await ctx.reply(`⚠️ Descripción demasiado larga \\(máx ${MAX_DESC} caracteres\\)\\.`, { parse_mode: 'MarkdownV2' }); continue }
    desc = raw; break
  }

  // Paso 3: categoría (botones)
  const catKeyboard = new InlineKeyboard()
  CATEGORIAS.forEach((c, i) => {
    catKeyboard.text(c.label, `cat_${c.id}`)
    if (i % 2 === 1) catKeyboard.row()
  })
  await ctx.reply('🗂 *Paso 3/6* — Elige una categoría:', { parse_mode: 'MarkdownV2', reply_markup: catKeyboard })
  const catCtx = await conversation.waitFor('callback_query:data')
  await catCtx.answerCallbackQuery()
  const catId    = catCtx.callbackQuery.data.replace('cat_', '')
  const catLabel = CATEGORIAS.find(c => c.id === catId)?.label ?? catId

  // Paso 4: precio (opcional)
  await ctx.reply(
    '💰 *Paso 4/6* — ¿Precio o importe?\n\nEscribe solo el número \\(ej: `50`, `200`, `0\\.001`\\)\nEscribe /saltar para omitir\\.',
    { parse_mode: 'MarkdownV2' }
  )
  let price = null
  while (true) {
    const priceCtx = await conversation.waitFor('message:text')
    const priceRaw = priceCtx.message.text.trim()
    if (priceRaw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (priceRaw === SALTAR) break
    const num = parseFloat(priceRaw.replace(',', '.'))
    if (isNaN(num) || num < 0) {
      await ctx.reply(
        '⚠️ Introduce un número válido \\(ej: `50`, `200`, `0\\.001`\\) o /saltar para omitir\\.',
        { parse_mode: 'MarkdownV2' }
      )
      continue
    }
    price = priceRaw.slice(0, 50)
    break
  }

  // Paso 5: moneda (solo si hay precio)
  let currency = null
  if (price) {
    const monedaKeyboard = new InlineKeyboard()
    MONEDAS.forEach(m => monedaKeyboard.text(m.label, `moneda_${m.code}`))
    await ctx.reply('💱 *Paso 5/6* — ¿En qué moneda?', { parse_mode: 'MarkdownV2', reply_markup: monedaKeyboard })
    const monedaCtx = await conversation.waitFor('callback_query:data')
    await monedaCtx.answerCallbackQuery()
    currency = monedaCtx.callbackQuery.data.replace('moneda_', '') // stores the code (EUR, BTC...)
  } else {
    await ctx.reply('_Sin precio — continuando\\.\\.\\._', { parse_mode: 'MarkdownV2' })
  }

  // Paso 6: contacto (opcional)
  await ctx.reply(
    '📞 *Paso 6/6* — ¿Contacto?\n\nEjemplo: `⚡ tu@wallet\\.com`, `@usuario`, `npub1\\.\\.\\.`\nEscribe /saltar para omitir\\.',
    { parse_mode: 'MarkdownV2' }
  )
  const contactCtx = await conversation.waitFor('message:text')
  const contactRaw = contactCtx.message.text.trim()
  if (contactRaw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
  const contact = contactRaw !== SALTAR ? contactRaw.slice(0, 300) : null

  // Resumen
  let summary = '📋 *Resumen del servicio:*\n\n'
  summary += `📌 *Nombre:* ${escMd(title)}\n`
  summary += `📝 *Descripción:* ${escMd(desc.slice(0, 200))}${desc.length > 200 ? '\\.\\.\\.' : ''}\n`
  summary += `🗂 *Categoría:* ${escMd(catLabel)}\n`
  if (price && currency) summary += `💰 *Precio:* ${escMd(price)} ${escMd(currency)}\n`
  else if (price)        summary += `💰 *Precio:* ${escMd(price)}\n`
  if (contact)           summary += `📞 *Contacto:* ${escMd(contact)}\n`
  summary += '\n¿Publicar en Nostr?'

  const keyboard = new InlineKeyboard()
    .text('✅ Publicar', 'servicio_confirm').text('❌ Cancelar', 'servicio_cancel')

  await ctx.reply(summary, { parse_mode: 'MarkdownV2', reply_markup: keyboard })

  const confirmCtx = await conversation.waitFor('callback_query:data')
  await confirmCtx.answerCallbackQuery()

  if (confirmCtx.callbackQuery.data === 'servicio_cancel') {
    await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' })
    return
  }

  // Verificar rate limit justo antes de publicar
  if (checkRateLimit && !checkRateLimit(ctx.from.id)) {
    await ctx.reply('⚠️ Has alcanzado el límite de 5 publicaciones por día\\. Vuelve mañana\\.', { parse_mode: 'MarkdownV2' })
    return
  }

  await ctx.reply('⏳ Publicando en Nostr\\.\\.\\. un momento\\.', { parse_mode: 'MarkdownV2' })

  const tags = [
    ['title',        title],
    ['summary',      desc],
    ['t',            'plazap2p'],
    ['t',            'plazap2p-servicio'],
    ['service_type', catId],
  ]
  if (price && currency) tags.push(['price', price, currency])
  else if (price)        tags.push(['price', price])
  if (contact)           tags.push(['contact', contact])

  const content = desc

  try {
    const { published, total, naddr } = await publishEvent(tags, content, 30402)
    let reply = `✅ *Servicio publicado en ${published}/${total} relays*\n\nAparecerá en PlazaP2P en el Mercado en breve\\.`
    if (naddr) reply += `\n\n🔗 Ver: https://njump\\.me/${escMd(naddr)}`
    await ctx.reply(reply, { parse_mode: 'MarkdownV2' })
  } catch (err) {
    await ctx.reply(`❌ Error al publicar: ${escMd(err.message)}`, { parse_mode: 'MarkdownV2' })
  }
}
