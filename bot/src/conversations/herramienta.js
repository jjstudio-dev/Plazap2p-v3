// herramienta.js — Wizard de publicación de herramientas/recursos en PlazaP2P
// Publica kind 30402 con tag #plazap2p-herramienta

import { InlineKeyboard } from 'grammy'
import { publishHerramienta } from '../publish.js'
import { escMd, validateUrl } from '../utils.js'

const CANCELAR = '/cancelar'
const SALTAR   = '/saltar'

const CATEGORIAS = [
  { id: 'wallet',     label: '💰 Wallet'        },
  { id: 'nostr',      label: '🟣 Cliente Nostr'  },
  { id: 'seguridad',  label: '🔐 Seguridad'      },
  { id: 'lightning',  label: '⚡ Lightning'       },
  { id: 'educacion',  label: '📚 Educación'       },
  { id: 'otro',       label: '🔧 Otro'            },
]

const PLATAFORMAS_OPTS = [
  { id: 'web',     label: 'Web 🌐'     },
  { id: 'android', label: 'Android 🤖' },
  { id: 'ios',     label: 'iOS 🍎'     },
  { id: 'desktop', label: 'Desktop 💻' },
]

export async function herramientaConversation(conversation, ctx, opts) {
  const userId = ctx.from?.id
  if (!userId) return

  const modoLabel = ctx.session?.mode === 'perfil' ? '🔵 Modo Perfil' : '⚪ Modo Seudónimo'

  // Paso 1: nombre
  await ctx.reply(
    `🔧 *Publicar Herramienta — Paso 1/5*\n${escMd(modoLabel)}\n\n` +
    '¿Nombre de la herramienta o recurso?\n\n_Escribe /cancelar para salir\\._',
    { parse_mode: 'MarkdownV2' }
  )
  let title
  while (true) {
    const msgCtx = await conversation.waitFor('message:text')
    const raw = msgCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw.length < 2)  { await ctx.reply('⚠️ Nombre demasiado corto\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length > 80) { await ctx.reply('⚠️ Nombre demasiado largo \\(máx 80 chars\\)\\.', { parse_mode: 'MarkdownV2' }); continue }
    title = raw; break
  }

  // Paso 2: descripción
  await ctx.reply(
    '📝 *Paso 2/5* — Describe la herramienta\\.\n\nQué hace, para qué sirve, a quién va dirigida, si es de código abierto\\.',
    { parse_mode: 'MarkdownV2' }
  )
  let desc
  while (true) {
    const msgCtx = await conversation.waitFor('message:text')
    const raw = msgCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw.length < 20)  { await ctx.reply('⚠️ Descripción muy corta \\(mínimo 20 caracteres\\)\\.', { parse_mode: 'MarkdownV2' }); continue }
    if (raw.length > 800) { await ctx.reply('⚠️ Demasiado larga \\(máx 800 chars\\)\\.', { parse_mode: 'MarkdownV2' }); continue }
    desc = raw; break
  }

  // Paso 3: categoría (botones)
  const catKb = new InlineKeyboard()
  CATEGORIAS.forEach((c, i) => {
    catKb.text(c.label, `her_cat_${c.id}`)
    if (i % 2 === 1) catKb.row()
  })
  await ctx.reply('🗂 *Paso 3/5* — Categoría:', { parse_mode: 'MarkdownV2', reply_markup: catKb })
  const catCtx = await conversation.waitFor('callback_query:data')
  await catCtx.answerCallbackQuery()
  const catId    = catCtx.callbackQuery.data.replace('her_cat_', '')
  const catLabel = CATEGORIAS.find(c => c.id === catId)?.label ?? catId

  // Paso 4: URL oficial (obligatoria para herramientas)
  await ctx.reply(
    '🔗 *Paso 4/5* — URL oficial de la herramienta\\.\n\nEj: `https://github\\.com/usuario/repo` o `https://app\\.com`\n\nEscribe /saltar para omitir\\.',
    { parse_mode: 'MarkdownV2' }
  )
  let officialUrl = null
  while (true) {
    const msgCtx = await conversation.waitFor('message:text')
    const raw = msgCtx.message.text.trim()
    if (raw === CANCELAR) { await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return }
    if (raw === SALTAR) break
    const url = validateUrl(raw)
    if (!url) {
      await ctx.reply('⚠️ URL no válida\\. Debe empezar por https:// o http://\\.', { parse_mode: 'MarkdownV2' }); continue
    }
    officialUrl = url; break
  }

  // Paso 5: plataformas (multi-selección con botones toggle)
  // Usamos un approach simple: un botón por plataforma + confirmar
  await ctx.reply(
    '💻 *Paso 5/5* — ¿En qué plataformas está disponible?\n\nSelecciona las plataformas y pulsa *Listo* cuando acabes\\.',
    { parse_mode: 'MarkdownV2' }
  )

  const selectedPlats = new Set()

  const buildPlatKb = () => {
    const kb = new InlineKeyboard()
    PLATAFORMAS_OPTS.forEach((p, i) => {
      const selected = selectedPlats.has(p.id)
      kb.text(`${selected ? '✅' : '⬜'} ${p.label}`, `her_plat_${p.id}`)
      if (i % 2 === 1) kb.row()
    })
    kb.row().text('✅ Listo', 'her_plat_done')
    return kb
  }

  const platMsg = await ctx.reply('Selecciona plataformas:', { reply_markup: buildPlatKb() })

  // Loop de selección de plataformas
  while (true) {
    const cbCtx = await conversation.waitFor('callback_query:data')
    await cbCtx.answerCallbackQuery()
    const data = cbCtx.callbackQuery.data

    if (data === 'her_plat_done') break

    if (data.startsWith('her_plat_')) {
      const platId = data.replace('her_plat_', '')
      if (!PLATAFORMAS_OPTS.find(p => p.id === platId)) continue
      if (selectedPlats.has(platId)) selectedPlats.delete(platId)
      else selectedPlats.add(platId)

      // Actualizar el teclado inline con el nuevo estado
      try {
        await conversation.external(() =>
          ctx.api.editMessageReplyMarkup(
            cbCtx.callbackQuery.message.chat.id,
            cbCtx.callbackQuery.message.message_id,
            { reply_markup: buildPlatKb() }
          )
        )
      } catch {}
    }
  }

  const platsLabel = selectedPlats.size > 0
    ? Array.from(selectedPlats).map(id => PLATAFORMAS_OPTS.find(p => p.id === id)?.label ?? id).join(', ')
    : 'No especificado'

  // Resumen y confirmación
  let summary = '📋 *Resumen de la herramienta:*\n\n'
  summary += `📌 *Nombre:* ${escMd(title)}\n`
  summary += `📝 *Descripción:* ${escMd(desc.slice(0, 150))}${desc.length > 150 ? '\\.\\.\\.' : ''}\n`
  summary += `🗂 *Categoría:* ${escMd(catLabel)}\n`
  if (officialUrl) summary += `🔗 *URL:* ${escMd(officialUrl)}\n`
  summary += `💻 *Plataformas:* ${escMd(platsLabel)}\n`
  summary += '\n_Se publicará en Nostr con la cuenta del bot\\._\n\n¿Publicar?'

  await ctx.reply(summary, {
    parse_mode: 'MarkdownV2',
    reply_markup: new InlineKeyboard().text('✅ Publicar', 'her_confirm').text('❌ Cancelar', 'her_cancel')
  })

  const confirmCtx = await conversation.waitFor('callback_query:data')
  await confirmCtx.answerCallbackQuery()
  if (confirmCtx.callbackQuery.data === 'her_cancel') {
    await ctx.reply('❌ Publicación cancelada\\.', { parse_mode: 'MarkdownV2' }); return
  }

  const rlOk = await conversation.external(() => opts.checkRateLimit(userId))
  if (!rlOk) {
    await ctx.reply('⚠️ Has alcanzado el límite de 5 publicaciones por día\\. Vuelve mañana\\.', { parse_mode: 'MarkdownV2' }); return
  }

  await ctx.reply('⏳ Publicando en Nostr\\.\\.\\. un momento\\.', { parse_mode: 'MarkdownV2' })

  const isPerfilMode = ctx.session?.mode === 'perfil' && ctx.session?.linked_npub_verified
  const userPubHex   = isPerfilMode ? ctx.session.linked_npub_hex : null

  const data = { type: 'herramienta', title, desc, catId, officialUrl, platforms: Array.from(selectedPlats) }
  const result = await conversation.external(() =>
    publishHerramienta(data, opts.botNsec, opts.env, userId, userPubHex)
  )

  const errKb = new InlineKeyboard().text('🏪 Menú principal', 'back_to_menu')
  if (!result.ok) {
    await ctx.reply(`❌ Error al publicar: ${escMd(result.error ?? 'Error desconocido')}`, { parse_mode: 'MarkdownV2', reply_markup: errKb })
    return
  }
  const backKb = new InlineKeyboard()
  if (result.naddr) backKb.url('🔗 Ver en Nostr', `https://njump.me/${result.naddr}`).row()
  backKb.text('🏪 Menú principal', 'back_to_menu')
  const reply = `✅ *Herramienta publicada en ${result.published}/${result.total} relays*`
  await ctx.reply(reply, { parse_mode: 'MarkdownV2', reply_markup: backKb })
}
