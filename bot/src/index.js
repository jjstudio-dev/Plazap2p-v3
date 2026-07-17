import { Bot, session, InlineKeyboard } from 'grammy'
import { conversations, createConversation } from '@grammyjs/conversations'
import { createServer } from 'http'
import { eventoConversation }   from './conversations/evento.js'
import { servicioConversation } from './conversations/servicio.js'
import { fetchOffers, formatOffer } from './nostr.js'

// ── Validación de entorno ───────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN
const BOT_NSEC  = process.env.BOT_NSEC

if (!BOT_TOKEN) { console.error('ERROR: BOT_TOKEN no configurado'); process.exit(1) }
if (!BOT_NSEC)  { console.error('ERROR: BOT_NSEC no configurado');  process.exit(1) }

// ── Rate limit: máx 5 publicaciones por usuario/día ───────────
// NOTE: Increments only when checkRateLimit is called inside a conversation,
// at actual publish time — so cancellations don't consume quota.
const rateLimitMap = new Map() // userId → { count, date }

function checkRateLimit(userId) {
  const today = new Date().toDateString()
  const entry = rateLimitMap.get(userId)
  if (!entry || entry.date !== today) {
    rateLimitMap.set(userId, { count: 1, date: today })
    return true
  }
  if (entry.count >= 5) return false
  entry.count++
  return true
}

// Remove stale entries hourly (users from previous days)
setInterval(() => {
  const today = new Date().toDateString()
  for (const [id, entry] of rateLimitMap) {
    if (entry.date !== today) rateLimitMap.delete(id)
  }
}, 60 * 60 * 1000)

// ── /ofertas cooldown: 15s per user ───────────────────────────
const ofertasCooldown = new Map() // userId → timestamp

// ── Bot setup ──────────────────────────────────────────────────
const bot = new Bot(BOT_TOKEN)

bot.use(session({ initial: () => ({ disclaimerSeen: false }) }))
bot.use(conversations())

// Wrap conversations to pass checkRateLimit without mutating grammY's call signature
bot.use(createConversation((conv, ctx) => eventoConversation(conv, ctx, checkRateLimit),   'evento'))
bot.use(createConversation((conv, ctx) => servicioConversation(conv, ctx, checkRateLimit), 'servicio'))

// ── Menú principal ─────────────────────────────────────────────
function mainMenu() {
  return new InlineKeyboard()
    .text('📅 Publicar Evento',   'menu_evento')
    .text('🔧 Publicar Servicio', 'menu_servicio').row()
    .text('🛒 Ver Ofertas',       'menu_ofertas')
    .text('❓ Ayuda',             'menu_ayuda')
}

const WELCOME = `🏪 *Bienvenido a PlazaP2P*

Red P2P de economía circular sobre Nostr\\. Publica eventos y servicios directamente en la red, o consulta las ofertas disponibles\\. Sin intermediarios\\.

¿Qué quieres hacer?`

bot.command('start', async (ctx) => {
  await ctx.reply(WELCOME, { parse_mode: 'MarkdownV2', reply_markup: mainMenu() })
})

bot.command('ayuda', async (ctx) => {
  await ctx.reply(AYUDA, { parse_mode: 'MarkdownV2' })
})

// ── Comandos directos ──────────────────────────────────────────
// Rate limit is NOT checked here — it runs inside the conversation at publish time
// so that cancellations do not consume quota.
bot.command('evento', async (ctx) => {
  await ctx.conversation.enter('evento')
})

bot.command('servicio', async (ctx) => {
  await ctx.conversation.enter('servicio')
})

bot.command('ofertas', async (ctx) => {
  await handleOfertas(ctx)
})

bot.command('cancelar', async (ctx) => {
  await ctx.conversation.exit()
  await ctx.reply('❌ Conversación cancelada\\.',  { parse_mode: 'MarkdownV2' })
})

// ── Callbacks del menú inline ──────────────────────────────────
bot.callbackQuery('menu_evento', async (ctx) => {
  await ctx.answerCallbackQuery()
  await ctx.conversation.enter('evento')
})

bot.callbackQuery('menu_servicio', async (ctx) => {
  await ctx.answerCallbackQuery()
  await ctx.conversation.enter('servicio')
})

bot.callbackQuery('menu_ofertas', async (ctx) => {
  await ctx.answerCallbackQuery()
  await handleOfertas(ctx)
})

bot.callbackQuery('menu_ayuda', async (ctx) => {
  await ctx.answerCallbackQuery()
  await ctx.reply(AYUDA, { parse_mode: 'MarkdownV2' })
})

// ── Handler de ofertas ─────────────────────────────────────────
async function handleOfertas(ctx) {
  const userId = ctx.from?.id
  if (userId) {
    const last = ofertasCooldown.get(userId)
    if (last && Date.now() - last < 15_000) {
      await ctx.reply('⏱ Espera unos segundos antes de volver a consultar\\.', { parse_mode: 'MarkdownV2' })
      return
    }
    ofertasCooldown.set(userId, Date.now())
  }

  const DISCLAIMER =
    '⚠️ *Aviso importante*\n\n' +
    'PlazaP2P solo muestra información pública de Nostr\\. ' +
    'No verificamos ofertas ni actuamos como intermediarios\\. ' +
    'Toda transacción es P2P y ocurre directamente entre las partes, ' +
    'bajo su propia responsabilidad\\.'

  if (!ctx.session?.disclaimerSeen) {
    await ctx.reply(DISCLAIMER, { parse_mode: 'MarkdownV2' })
    if (ctx.session) ctx.session.disclaimerSeen = true
  }
  await ctx.reply('🔍 Buscando ofertas recientes en los relays\\.\\.\\.',  { parse_mode: 'MarkdownV2' })

  try {
    const offers = await fetchOffers(10)

    if (offers.length === 0) {
      await ctx.reply('No se encontraron ofertas recientes con los tags \\#plazap2p\\-venta o \\#plazap2p\\-compra\\.', { parse_mode: 'MarkdownV2' })
      return
    }

    await ctx.reply(`📦 *${offers.length} ofertas encontradas:*`, { parse_mode: 'MarkdownV2' })

    for (const offer of offers) {
      try {
        await ctx.reply(formatOffer(offer), { parse_mode: 'MarkdownV2' })
      } catch (e) {
        console.error('formatOffer failed for event', offer?.id, e.message)
      }
    }

    await ctx.reply(
      '─────────────────\n🔗 Ver más en: https://jjstudio\\-dev\\.github\\.io/Plazap2p\\-v3/',
      { parse_mode: 'MarkdownV2' }
    )
  } catch (err) {
    await ctx.reply(`❌ Error al consultar relays: ${err.message}`)
  }
}

// ── Texto de ayuda ─────────────────────────────────────────────
const AYUDA = `❓ *Ayuda — PlazaP2P Bot*

*¿Qué es PlazaP2P?*
Una plaza digital P2P sobre la red Nostr\\. Sin intermediarios, sin empresa detrás\\.

*¿Qué puedo hacer aquí?*
📅 /evento — Publicar un meetup, conferencia o actividad
🔧 /servicio — Publicar un servicio profesional
🛒 /ofertas — Consultar anuncios de compra/venta \\(solo lectura\\)
🏪 /start — Volver al menú principal

*¿Cómo funcionan las publicaciones?*
El bot publica en Nostr usando la cuenta oficial de PlazaP2P\\. Tu contenido queda en la red descentralizada y aparecerá en el sitio web en breve\\.

*Límites*
Máximo 5 publicaciones por usuario por día\\.

*Web*
https://jjstudio\\-dev\\.github\\.io/Plazap2p\\-v3/`

// ── Arranque ───────────────────────────────────────────────────

// Health check HTTP para Fly.io (no afecta al bot)
createServer((_, res) => { res.writeHead(200); res.end('ok') }).listen(3000)

bot.start({
  onStart: () => console.log('PlazaP2P Bot arrancado en modo polling'),
})

bot.catch((err) => {
  console.error('Error en el bot:', err.message)
})
