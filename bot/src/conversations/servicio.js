import { InlineKeyboard } from 'grammy'
import { publishServicio } from '../publish.js'
import { uploadPhoto } from '../upload.js'
import { escMd, sanitizeContact } from '../utils.js'

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

/**
 * Wizard de publicación de servicio profesional.
 * @param {object} opts.checkRateLimit — función async de rate limit KV
 * @param {string} opts.botToken       — token Telegram para descargar fotos
 * @param {string} opts.botNsec        — clave nsec del bot para firmar eventos Nostr
 */
export async function servicioConversation(conversation, ctx, opts) {
  // Paso 1: nombre del servicio (obligatorio)
  await ctx.reply(
    '🔧 *Publicar Servicio — Paso 1/8*\n\n¿Nombre del servicio?\n\n_Escribe /cancelar en cualquier momento para salir\\._',
    { parse_mode: 'MarkdownV2' }
  )
  let title
  while (true) {
    const titleCtx = await conversation.waitFor('message:text')
    const raw = titleCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw === SALTAR)   { await ctx.reply('⚠️ El nombre es obligatorio\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length < 5)   { await ctx.reply('⚠️ Nombre demasiado corto \\(mínimo 5 caracteres\\)\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length > MAX_TITLE) { await ctx.reply(`⚠️ Nombre demasiado largo \\(máx ${MAX_TITLE} caracteres\\)\\.`, { parse_mode: 'MarkdownV2' }); continue }
    title = raw; break
  }

  // Paso 2: descripción (obligatorio)
  await ctx.reply(
    '📝 *Paso 2/8* — Describe el servicio\\.\n\nQué ofreces, tu experiencia, proceso y plazos\\.',
    { parse_mode: 'MarkdownV2' }
  )
  let desc
  while (true) {
    const descCtx = await conversation.waitFor('message:text')
    const raw = descCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw === SALTAR)   { await ctx.reply('⚠️ La descripción es obligatoria\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length < 10)  { await ctx.reply('⚠️ Descripción demasiado corta \\(mínimo 10 caracteres\\)\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length > MAX_DESC) { await ctx.reply(`⚠️ Demasiado larga \\(máx ${MAX_DESC} caracteres\\)\\.`, { parse_mode: 'MarkdownV2' }); continue }
    desc = raw; break
  }

  // Paso 3: categoría (botones obligatorios)
  const catKeyboard = new InlineKeyboard()
  CATEGORIAS.forEach((c, i) => {
    catKeyboard.text(c.label, `cat_${c.id}`)
    if (i % 2 === 1) catKeyboard.row()
  })
  await ctx.reply('🗂 *Paso 3/8* — Elige una categoría:', { parse_mode: 'MarkdownV2', reply_markup: catKeyboard })
  const catCtx = await conversation.waitFor('callback_query:data')
  await catCtx.answerCallbackQuery()
  const catId    = catCtx.callbackQuery.data.replace('cat_', '')
  const catLabel = CATEGORIAS.find(c => c.id === catId)?.label ?? catId

  // Paso 4: foto del servicio o portfolio (opcional)
  await ctx.reply(
    '📸 *Paso 4/8* — Foto o imagen del servicio \\(portfolio, muestra\\) \\(opcional\\)\n\nEnvía una imagen o escribe /saltar\\.',
    { parse_mode: 'MarkdownV2' }
  )

  let imageUrl = null
  while (true) {
    const photoOrText = await conversation.waitFor(['message:photo', 'message:text'])

    if (photoOrText.message?.photo) {
      const photo = photoOrText.message.photo[photoOrText.message.photo.length - 1]
      await ctx.reply('📸 Procesando imagen\\.\\.\\. un momento\\.', { parse_mode: 'MarkdownV2' })

      // conversation.external() garantiza que el upload solo ocurre una vez aunque la
      // conversación se repita (patrón correcto de @grammyjs/conversations v1)
      imageUrl = await conversation.external(() => uploadPhoto(photo, opts.botToken))

      const msg = imageUrl ? '✅ Imagen guardada\\.' : '⚠️ No se pudo guardar la imagen\\. Continuando sin foto\\.'
      await ctx.reply(msg, { parse_mode: 'MarkdownV2' })
      break
    }

    const text = photoOrText.message?.text?.trim() ?? ''
    if (text === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (text === SALTAR) break
    await ctx.reply('⚠️ Envía una imagen o escribe /saltar\\.', { parse_mode: 'MarkdownV2' })
  }

  // Paso 5: precio (opcional)
  await ctx.reply(
    '💰 *Paso 5/8* — ¿Precio o tarifa?\n\nEscribe solo el número \\(ej: `50`, `200`, `0\\.001`\\)\nEscribe /saltar para omitir\\.',
    { parse_mode: 'MarkdownV2' }
  )
  let price = null
  while (true) {
    const priceCtx = await conversation.waitFor('message:text')
    const raw = priceCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw === SALTAR) break
    const num = parseFloat(raw.replace(',', '.'))
    if (isNaN(num) || num < 0) {
      await ctx.reply('⚠️ Número no válido \\(ej: `50`, `200`, `0\\.001`\\) o /saltar para omitir\\.', { parse_mode: 'MarkdownV2' })
      continue
    }
    price = raw.slice(0, 50); break
  }

  // Paso 5b: moneda — sub-paso de precio, solo si el usuario indicó un importe
  let currency = null
  if (price) {
    const monedaKeyboard = new InlineKeyboard()
    MONEDAS.forEach(m => monedaKeyboard.text(m.label, `moneda_s_${m.code}`))
    await ctx.reply('💱 ¿En qué moneda?', { parse_mode: 'MarkdownV2', reply_markup: monedaKeyboard })
    const monedaCtx = await conversation.waitFor('callback_query:data')
    await monedaCtx.answerCallbackQuery()
    currency = monedaCtx.callbackQuery.data.replace('moneda_s_', '')
  }

  // Paso 6: nombre/alias para atribución (opcional)
  await ctx.reply(
    '👤 *Paso 6/8* — ¿Cómo quieres que te mencionen en la publicación?\n\nEj: `@pepito`, `Pepito García`, `Bitcoin Max`\\.\nEscribe /saltar para publicar de forma anónima\\.\n\n⚠️ _Este nombre será visible en la red Nostr \\(público y permanente\\)\\._',
    { parse_mode: 'MarkdownV2' }
  )
  const aliasCtx = await conversation.waitFor('message:text')
  const aliasRaw = aliasCtx.message.text.trim()
  if (aliasRaw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
  const alias = aliasRaw !== SALTAR ? aliasRaw.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100) : null

  // Paso 7: contacto (opcional) — se sanitiza para eliminar URLs (anti-phishing)
  await ctx.reply(
    '📞 *Paso 7/8* — ¿Contacto para contratar el servicio? \\(opcional\\)\n\nEj: `@usuario`, `npub1\\.\\.\\.`, `tu@email\\.com`\nEscribe /saltar para omitir\\.',
    { parse_mode: 'MarkdownV2' }
  )
  const contactCtx = await conversation.waitFor('message:text')
  const contactRaw = contactCtx.message.text.trim()
  if (contactRaw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
  const contact = contactRaw !== SALTAR ? sanitizeContact(contactRaw, 200) : null

  // Paso 8: resumen y confirmación
  let summary = '📋 *Resumen del servicio — Confirmar \\(Paso 8/8\\):*\n\n'
  summary += `📌 *Nombre:* ${escMd(title)}\n`
  summary += `📝 *Descripción:* ${escMd(desc.slice(0, 200))}${desc.length > 200 ? '\\.\\.\\.' : ''}\n`
  summary += `🗂 *Categoría:* ${escMd(catLabel)}\n`
  if (imageUrl) summary += `📸 *Imagen:* ✅ incluida\n`
  if (price && currency) summary += `💰 *Precio:* ${escMd(price)} ${escMd(currency)}\n`
  else if (price)        summary += `💰 *Precio:* ${escMd(price)}\n`
  if (alias)   summary += `👤 *Nombre:* ${escMd(alias)}\n`
  if (contact) summary += `📞 *Contacto:* ${escMd(contact)}\n`
  summary += '\n_Se publicará en Nostr con la cuenta del bot\\._\n\n¿Publicar?'

  const keyboard = new InlineKeyboard()
    .text('✅ Publicar', 'servicio_confirm').text('❌ Cancelar', 'servicio_cancel')

  await ctx.reply(summary, { parse_mode: 'MarkdownV2', reply_markup: keyboard })

  const confirmCtx = await conversation.waitFor('callback_query:data')
  await confirmCtx.answerCallbackQuery()

  if (confirmCtx.callbackQuery.data === 'servicio_cancel') {
    await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return
  }

  // Rate limit — dentro de external() para que grammyjs no lo incremente en cada replay
  const rlOk = await conversation.external(() => opts.checkRateLimit(ctx.from.id))
  if (!rlOk) {
    await ctx.reply('⚠️ Has alcanzado el límite de 5 publicaciones por día\\. Vuelve mañana\\.', { parse_mode: 'MarkdownV2' })
    return
  }

  await ctx.reply('⏳ Publicando en Nostr\\.\\.\\. un momento\\.', { parse_mode: 'MarkdownV2' })

  const isPerfilMode = ctx.session?.mode === 'perfil' && ctx.session?.linked_npub_verified
  const userPubHex   = isPerfilMode ? ctx.session.linked_npub_hex : null

  const data = { type: 'servicio', title, desc, catId, imageUrl, price, currency, alias, contact }
  const result = await conversation.external(() =>
    publishServicio(data, opts.botNsec, opts.env, ctx.from.id, userPubHex)
  )

  const errKb = new InlineKeyboard().text('🏪 Menú principal', 'back_to_menu')
  if (!result.ok) {
    await ctx.reply(`❌ Error al publicar: ${escMd(result.error ?? 'Error desconocido')}`, { parse_mode: 'MarkdownV2', reply_markup: errKb })
    return
  }
  const backKb = new InlineKeyboard()
  if (result.naddr) backKb.url('🔗 Ver en Nostr', `https://njump.me/${result.naddr}`).row()
  backKb.text('🏪 Menú principal', 'back_to_menu')
  const reply = `✅ *Servicio publicado en ${result.published}/${result.total} relays*\n\nAparecerá en el Mercado en breve\\.`
  await ctx.reply(reply, { parse_mode: 'MarkdownV2', reply_markup: backKb })
}
