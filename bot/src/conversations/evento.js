import { InlineKeyboard } from 'grammy'
import { publishEvent } from '../nostr.js'
import { escMd, parseEventDate } from '../utils.js'

const CANCELAR = '/cancelar'
const SALTAR   = '/saltar'
const MAX_TITLE = 200
const MAX_DESC  = 2000

export async function eventoConversation(conversation, ctx, checkRateLimit) {
  // Paso 1: título (obligatorio)
  await ctx.reply(
    '📅 *Publicar Evento — Paso 1/5*\n\n¿Cuál es el título del evento?\n\n_Escribe /cancelar en cualquier momento para salir\\._',
    { parse_mode: 'MarkdownV2' }
  )
  let title
  while (true) {
    const titleCtx = await conversation.waitFor('message:text')
    const raw = titleCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw === SALTAR)   { await ctx.reply('⚠️ El título es obligatorio\\. Por favor escribe un título\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length < 5)   { await ctx.reply('⚠️ Título demasiado corto \\(mínimo 5 caracteres\\)\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length > MAX_TITLE) { await ctx.reply(`⚠️ Título demasiado largo \\(máx ${MAX_TITLE} caracteres\\)\\.`, { parse_mode: 'MarkdownV2' }); continue }
    title = raw; break
  }

  // Paso 2: descripción (obligatorio)
  await ctx.reply('📝 *Paso 2/5* — Describe el evento: quién organiza, qué se hará, por qué asistir\\.', { parse_mode: 'MarkdownV2' })
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

  // Paso 3: fecha (opcional)
  await ctx.reply(
    '📅 *Paso 3/5* — ¿Fecha y hora?\n\nFormato: `2025\\-07\\-12 18:00`\nEscribe /saltar para omitir\\.',
    { parse_mode: 'MarkdownV2' }
  )
  let dateTs = null
  let dateRaw = SALTAR
  while (true) {
    const dateCtx = await conversation.waitFor('message:text')
    dateRaw = dateCtx.message.text.trim()
    if (dateRaw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (dateRaw === SALTAR) break
    dateTs = parseEventDate(dateRaw)
    if (!dateTs) {
      await ctx.reply(
        '⚠️ Formato no reconocido\\. Usa `2025\\-07\\-12` o `2025\\-07\\-12 18:00`\\. Escribe /saltar para omitir\\.',
        { parse_mode: 'MarkdownV2' }
      )
      continue
    }
    break
  }

  // Paso 4: lugar (opcional)
  await ctx.reply('📍 *Paso 4/5* — ¿Lugar o ubicación?\n\nEscribe /saltar para omitir\\.', { parse_mode: 'MarkdownV2' })
  const locationCtx = await conversation.waitFor('message:text')
  const locationRaw = locationCtx.message.text.trim()
  if (locationRaw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
  const location = locationRaw !== SALTAR ? locationRaw.slice(0, 200) : null

  // Paso 5: contacto (opcional)
  await ctx.reply(
    '📞 *Paso 5/5* — ¿Contacto o URL del evento?\n\nEjemplo: `⚡ tu@wallet\\.com`, `@usuario`, `npub1\\.\\.\\.`\nEscribe /saltar para omitir\\.',
    { parse_mode: 'MarkdownV2' }
  )
  const contactCtx = await conversation.waitFor('message:text')
  const contactRaw = contactCtx.message.text.trim()
  if (contactRaw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
  const contact = contactRaw !== SALTAR ? contactRaw.slice(0, 300) : null

  // Resumen
  let summary = '📋 *Resumen del evento:*\n\n'
  summary += `📌 *Título:* ${escMd(title)}\n`
  summary += `📝 *Descripción:* ${escMd(desc.slice(0, 200))}${desc.length > 200 ? '\\.\\.\\.' : ''}\n`
  if (dateTs)    summary += `📅 *Fecha:* ${escMd(new Date(dateTs * 1000).toLocaleDateString('es-ES', { dateStyle: 'long' }))}\n`
  if (location)  summary += `📍 *Lugar:* ${escMd(location)}\n`
  if (contact)   summary += `📞 *Contacto:* ${escMd(contact)}\n`
  summary += '\n¿Publicar en Nostr?'

  const keyboard = new InlineKeyboard()
    .text('✅ Publicar', 'evento_confirm').text('❌ Cancelar', 'evento_cancel')

  await ctx.reply(summary, { parse_mode: 'MarkdownV2', reply_markup: keyboard })

  const confirmCtx = await conversation.waitFor('callback_query:data')
  await confirmCtx.answerCallbackQuery()

  if (confirmCtx.callbackQuery.data === 'evento_cancel') {
    await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' })
    return
  }

  // Verificar rate limit justo antes de publicar (no al entrar en el flujo)
  if (checkRateLimit && !checkRateLimit(ctx.from.id)) {
    await ctx.reply('⚠️ Has alcanzado el límite de 5 publicaciones por día\\. Vuelve mañana\\.', { parse_mode: 'MarkdownV2' })
    return
  }

  await ctx.reply('⏳ Publicando en Nostr\\.\\.\\. un momento\\.', { parse_mode: 'MarkdownV2' })

  // Construir tags para kind:31922 (NIP-52 calendar event)
  const tags = [
    ['title',   title],
    ['summary', desc],
    ['t',       'plazap2p'],
    ['t',       'plazap2p-evento'],
  ]
  if (dateTs)                       tags.push(['start', String(dateTs)])
  if (location)                     tags.push(['location', location])
  if (contact)                      tags.push(['contact', contact])

  const content = desc

  try {
    const { event, published, total, naddr } = await publishEvent(tags, content, 31922)
    let reply = `✅ *Evento publicado en ${published}/${total} relays*\n\nAparecerá en PlazaP2P en el tab Eventos en breve\\.`
    if (naddr) reply += `\n\n🔗 Ver: https://njump\\.me/${escMd(naddr)}`
    await ctx.reply(reply, { parse_mode: 'MarkdownV2' })
  } catch (err) {
    await ctx.reply(`❌ Error al publicar: ${escMd(err.message)}`, { parse_mode: 'MarkdownV2' })
  }
}
