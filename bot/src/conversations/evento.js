import { InlineKeyboard } from 'grammy'
import { publishEvento } from '../publish.js'
import { uploadPhoto } from '../upload.js'
import { escMd, parseEventDate, sanitizeContact } from '../utils.js'

const CANCELAR = '/cancelar'
const SALTAR   = '/saltar'
const MAX_TITLE = 200
const MAX_DESC  = 2000

/**
 * Wizard de publicación de evento (meetup, conferencia, actividad).
 * @param {object} opts.checkRateLimit — función async de rate limit KV
 * @param {string} opts.botToken       — token Telegram para descargar fotos
 * @param {string} opts.botNsec        — clave nsec del bot para firmar eventos Nostr
 */
export async function eventoConversation(conversation, ctx, opts) {
  // Paso 1: título (obligatorio)
  await ctx.reply(
    '📅 *Publicar Evento — Paso 1/8*\n\n¿Cuál es el título del evento?\n\n_Escribe /cancelar en cualquier momento para salir\\._',
    { parse_mode: 'MarkdownV2' }
  )
  let title
  while (true) {
    const titleCtx = await conversation.waitFor('message:text')
    const raw = titleCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw === SALTAR)   { await ctx.reply('⚠️ El título es obligatorio\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length < 5)   { await ctx.reply('⚠️ Título demasiado corto \\(mínimo 5 caracteres\\)\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length > MAX_TITLE) { await ctx.reply(`⚠️ Título demasiado largo \\(máx ${MAX_TITLE} caracteres\\)\\.`, { parse_mode: 'MarkdownV2' }); continue }
    title = raw; break
  }

  // Paso 2: descripción (obligatorio)
  await ctx.reply(
    '📝 *Paso 2/8* — Describe el evento\\.\n\nQuién organiza, qué se hará, por qué asistir\\.',
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

  // Paso 3: foto/banner del evento (opcional)
  await ctx.reply(
    '📸 *Paso 3/8* — Foto o banner del evento \\(opcional\\)\n\nEnvía una imagen o escribe /saltar\\.',
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

  // Paso 4: fecha (opcional)
  await ctx.reply(
    '📅 *Paso 4/8* — ¿Fecha y hora del evento?\n\nFormato: `2025\\-07\\-12 18:00`\nEscribe /saltar para omitir\\.',
    { parse_mode: 'MarkdownV2' }
  )
  let dateTs = null
  while (true) {
    const dateCtx = await conversation.waitFor('message:text')
    const raw = dateCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw === SALTAR) break
    dateTs = parseEventDate(raw)
    if (!dateTs) {
      await ctx.reply(
        '⚠️ Formato no reconocido\\. Usa `2025\\-07\\-12` o `2025\\-07\\-12 18:00`\\. Escribe /saltar para omitir\\.',
        { parse_mode: 'MarkdownV2' }
      )
      continue
    }
    break
  }

  // Paso 5: lugar (opcional)
  await ctx.reply(
    '📍 *Paso 5/8* — ¿Lugar o ubicación?\n\nEscribe /saltar para omitir\\.',
    { parse_mode: 'MarkdownV2' }
  )
  const locationCtx = await conversation.waitFor('message:text')
  const locationRaw = locationCtx.message.text.trim()
  if (locationRaw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
  const location = locationRaw !== SALTAR ? locationRaw.replace(/[\r\n]+/g, ' ').trim().slice(0, 200) : null

  // Paso 6: nombre/alias para atribución (opcional)
  await ctx.reply(
    '👤 *Paso 6/8* — ¿Cómo quieres que te mencionen en la publicación?\n\nEj: `@pepito`, `Pepito García`, `Bitcoin Max`\\.\nEscribe /saltar para publicar de forma anónima\\.\n\n⚠️ _Este nombre será visible en la red Nostr \\(público y permanente\\)\\._',
    { parse_mode: 'MarkdownV2' }
  )
  const aliasCtx = await conversation.waitFor('message:text')
  const aliasRaw = aliasCtx.message.text.trim()
  if (aliasRaw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
  const alias = aliasRaw !== SALTAR ? aliasRaw.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100) : null

  // Paso 7: contacto (opcional)
  await ctx.reply(
    '📞 *Paso 7/8* — ¿Contacto o URL de inscripción?\n\nEj: `⚡ tu@wallet\\.com`, `@usuario`, `npub1\\.\\.\\.`\nEscribe /saltar para omitir\\.',
    { parse_mode: 'MarkdownV2' }
  )
  const contactCtx = await conversation.waitFor('message:text')
  const contactRaw = contactCtx.message.text.trim()
  if (contactRaw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
  // sanitizeContact elimina URLs (anti-phishing)
  const contact = contactRaw !== SALTAR ? sanitizeContact(contactRaw, 200) : null

  // Paso 8: resumen y confirmación
  let summary = '📋 *Resumen del evento \\(Paso 8/8\\):*\n\n'
  summary += `📌 *Título:* ${escMd(title)}\n`
  summary += `📝 *Descripción:* ${escMd(desc.slice(0, 200))}${desc.length > 200 ? '\\.\\.\\.' : ''}\n`
  if (imageUrl) summary += `📸 *Imagen:* ✅ incluida\n`
  if (dateTs)   summary += `📅 *Fecha:* ${escMd(new Date(dateTs * 1000).toLocaleDateString('es-ES', { dateStyle: 'long' }))}\n`
  if (location) summary += `📍 *Lugar:* ${escMd(location)}\n`
  if (alias)    summary += `👤 *Nombre:* ${escMd(alias)}\n`
  if (contact)  summary += `📞 *Contacto:* ${escMd(contact)}\n`
  summary += '\n_Se publicará en Nostr con la cuenta del bot\\._\n\n¿Publicar?'

  const keyboard = new InlineKeyboard()
    .text('✅ Publicar', 'evento_confirm').text('❌ Cancelar', 'evento_cancel')

  await ctx.reply(summary, { parse_mode: 'MarkdownV2', reply_markup: keyboard })

  const confirmCtx = await conversation.waitFor('callback_query:data')
  await confirmCtx.answerCallbackQuery()

  if (confirmCtx.callbackQuery.data === 'evento_cancel') {
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

  const data = { type: 'evento', title, desc, imageUrl, dateTs, location, alias, contact }
  const result = await conversation.external(() =>
    publishEvento(data, opts.botNsec, opts.env, ctx.from.id, userPubHex)
  )

  const errKb = new InlineKeyboard().text('🏪 Menú principal', 'back_to_menu')
  if (!result.ok) {
    await ctx.reply(`❌ Error al publicar: ${escMd(result.error ?? 'Error desconocido')}`, { parse_mode: 'MarkdownV2', reply_markup: errKb })
    return
  }
  const backKb = new InlineKeyboard()
  if (result.naddr) backKb.url('🔗 Ver en Nostr', `https://njump.me/${result.naddr}`).row()
  backKb.text('🏪 Menú principal', 'back_to_menu')
  const reply = `✅ *Evento publicado en ${result.published}/${result.total} relays*\n\nAparecerá en el tab Eventos en breve\\.`
  await ctx.reply(reply, { parse_mode: 'MarkdownV2', reply_markup: backKb })
}
