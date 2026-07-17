// comunidad.js — Wizard de publicación de comunidades en PlazaP2P
// Publica kind 30402 con tag #plazap2p-comunidad en todos los modos de identidad

import { InlineKeyboard } from 'grammy'
import { publishComunidad } from '../publish.js'
import { uploadPhoto } from '../upload.js'
import { escMd } from '../utils.js'

const CANCELAR = '/cancelar'
const SALTAR   = '/saltar'

const PLATAFORMAS = [
  { id: 'telegram',  label: '✈️ Telegram'  },
  { id: 'nostr',     label: '🟣 Nostr'     },
  { id: 'matrix',    label: '🔷 Matrix'    },
  { id: 'discord',   label: '💜 Discord'   },
  { id: 'otro',      label: '🔧 Otro'      },
]

export async function comunidadConversation(conversation, ctx, opts) {
  const userId = ctx.from?.id
  if (!userId) return

  const modoLabel = ctx.session?.mode === 'perfil' ? '🔵 Modo Perfil' : '⚪ Modo Seudónimo'

  // Paso 1: nombre
  await ctx.reply(
    `🏘 *Publicar Comunidad — Paso 1/5*\n${escMd(modoLabel)}\n\n` +
    '¿Nombre de la comunidad?\n\n_Escribe /cancelar en cualquier momento para salir\\._',
    { parse_mode: 'MarkdownV2' }
  )
  let title
  while (true) {
    const msgCtx = await conversation.waitFor('message:text')
    const raw = msgCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw.length < 3)  { await ctx.reply('⚠️ Nombre demasiado corto \\(mínimo 3 caracteres\\)\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length > 80) { await ctx.reply('⚠️ Nombre demasiado largo \\(máx 80 caracteres\\)\\.', { parse_mode: 'MarkdownV2' }); continue }
    title = raw; break
  }

  // Paso 2: descripción
  await ctx.reply(
    '📝 *Paso 2/5* — Describe la comunidad\\.\n\nSobre qué trata, quién puede unirse, qué tipo de contenido comparten\\.',
    { parse_mode: 'MarkdownV2' }
  )
  let desc
  while (true) {
    const msgCtx = await conversation.waitFor('message:text')
    const raw = msgCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw.length < 20)   { await ctx.reply('⚠️ Descripción demasiado corta \\(mínimo 20 caracteres\\)\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length > 800)  { await ctx.reply('⚠️ Demasiado larga \\(máx 800 caracteres\\)\\.', { parse_mode: 'MarkdownV2' }); continue }
    desc = raw; break
  }

  // Paso 3: plataforma (botones)
  const platKb = new InlineKeyboard()
  PLATAFORMAS.forEach((p, i) => {
    platKb.text(p.label, `com_plat_${p.id}`)
    if (i % 2 === 1) platKb.row()
  })
  await ctx.reply('🌐 *Paso 3/5* — ¿Dónde está la comunidad?', { parse_mode: 'MarkdownV2', reply_markup: platKb })
  const platCtx = await conversation.waitFor('callback_query:data')
  await platCtx.answerCallbackQuery()
  const platId    = platCtx.callbackQuery.data.replace('com_plat_', '')
  const platLabel = PLATAFORMAS.find(p => p.id === platId)?.label ?? platId

  // Paso 4: enlace de acceso (obligatorio para comunidades)
  await ctx.reply(
    '🔗 *Paso 4/5* — Enlace de acceso a la comunidad\\.\n\nEj: `https://t\\.me/micomunidad`, `https://primal\\.net/p/npub1\\.\\.\\.`\n\n' +
    '_Escribe /saltar si prefieres no incluirlo\\._',
    { parse_mode: 'MarkdownV2' }
  )
  let accessUrl = null
  while (true) {
    const msgCtx = await conversation.waitFor('message:text')
    const raw = msgCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw === SALTAR) break
    // Validación básica de URL
    try {
      const url = new URL(raw)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        await ctx.reply('⚠️ Solo se aceptan URLs con https:// o http://\\.', { parse_mode: 'MarkdownV2' }); continue
      }
      if (url.href.length > 512) {
        await ctx.reply('⚠️ URL demasiado larga \\(máx\\. 512 caracteres\\)\\.', { parse_mode: 'MarkdownV2' }); continue
      }
      accessUrl = url.href; break
    } catch {
      await ctx.reply('⚠️ Formato de URL no válido\\. Ej: `https://t\\.me/micomunidad`\nEscribe /saltar para omitir\\.', { parse_mode: 'MarkdownV2' }); continue
    }
  }

  // Paso 5: foto/banner (opcional)
  await ctx.reply(
    '📸 *Paso 5/5* — Foto o banner \\(opcional\\)\n\nEnvía una imagen o escribe /saltar\\.',
    { parse_mode: 'MarkdownV2' }
  )
  let imageUrl = null
  while (true) {
    const inp = await conversation.waitFor(['message:photo', 'message:text'])
    if (inp.message?.photo) {
      const photo = inp.message.photo[inp.message.photo.length - 1]
      await ctx.reply('📸 Procesando imagen\\.\\.\\.', { parse_mode: 'MarkdownV2' })
      imageUrl = await conversation.external(() => uploadPhoto(photo, opts.botToken))
      await ctx.reply(imageUrl ? '✅ Imagen guardada\\.' : '⚠️ No se pudo guardar\\. Continuando sin foto\\.', { parse_mode: 'MarkdownV2' })
      break
    }
    const text = inp.message?.text?.trim() ?? ''
    if (text === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (text === SALTAR) break
    await ctx.reply('⚠️ Envía una imagen o escribe /saltar\\.', { parse_mode: 'MarkdownV2' })
  }

  // Resumen y confirmación
  let summary = '📋 *Resumen de la comunidad:*\n\n'
  summary += `📌 *Nombre:* ${escMd(title)}\n`
  summary += `📝 *Descripción:* ${escMd(desc.slice(0, 150))}${desc.length > 150 ? '\\.\\.\\.' : ''}\n`
  summary += `🌐 *Plataforma:* ${escMd(platLabel)}\n`
  if (accessUrl) summary += `🔗 *Enlace:* ${escMd(accessUrl)}\n`
  if (imageUrl)  summary += `📸 *Imagen:* ✅ incluida\n`
  summary += '\n_Se publicará en Nostr con la cuenta del bot\\._\n\n¿Publicar?'

  await ctx.reply(summary, {
    parse_mode: 'MarkdownV2',
    reply_markup: new InlineKeyboard().text('✅ Publicar', 'com_confirm').text('❌ Cancelar', 'com_cancel')
  })

  const confirmCtx = await conversation.waitFor('callback_query:data')
  await confirmCtx.answerCallbackQuery()
  if (confirmCtx.callbackQuery.data === 'com_cancel') {
    await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return
  }

  const rlOk = await conversation.external(() => opts.checkRateLimit(userId))
  if (!rlOk) {
    await ctx.reply('⚠️ Has alcanzado el límite de 5 publicaciones por día\\. Vuelve mañana\\.', { parse_mode: 'MarkdownV2' }); return
  }

  await ctx.reply('⏳ Publicando en Nostr\\.\\.\\. un momento\\.', { parse_mode: 'MarkdownV2' })

  const isPerfilMode = ctx.session?.mode === 'perfil' && ctx.session?.linked_npub_verified
  const userPubHex   = isPerfilMode ? ctx.session.linked_npub_hex : null

  const data = { type: 'comunidad', title, desc, platId, accessUrl, imageUrl }
  const result = await conversation.external(() =>
    publishComunidad(data, opts.botNsec, opts.env, userId, userPubHex)
  )

  const errKb = new InlineKeyboard().text('🏪 Menú principal', 'back_to_menu')
  if (!result.ok) {
    await ctx.reply(`❌ Error al publicar: ${escMd(result.error ?? 'Error desconocido')}`, { parse_mode: 'MarkdownV2', reply_markup: errKb })
    return
  }
  const backKb = new InlineKeyboard()
  if (result.naddr) backKb.url('🔗 Ver en Nostr', `https://njump.me/${result.naddr}`).row()
  backKb.text('🏪 Menú principal', 'back_to_menu')
  const reply = `✅ *Comunidad publicada en ${result.published}/${result.total} relays*`
  await ctx.reply(reply, { parse_mode: 'MarkdownV2', reply_markup: backKb })
}
