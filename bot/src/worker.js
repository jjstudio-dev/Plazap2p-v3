// worker.js — Entry point para Cloudflare Workers
// Usa webhooks (Telegram empuja updates) en lugar de long-polling
// Todos los secrets llegan vía env (nunca process.env)

import { Bot, session, InlineKeyboard, webhookCallback } from 'grammy'
import { conversations, createConversation } from '@grammyjs/conversations'
import { CloudflareKVAdapter } from '@grammyjs/storage-cloudflare'
import { eventoConversation }      from './conversations/evento.js'
import { servicioConversation }    from './conversations/servicio.js'
import { comunidadConversation }   from './conversations/comunidad.js'
import { herramientaConversation } from './conversations/herramienta.js'
import { transaccionConversation } from './conversations/transaccion.js'
import { vincularConversation }    from './conversations/vincular.js'
import { valorarConversation }     from './conversations/valorar.js'
import { redirectGuide }           from './conversations/redirect-guide.js'
import { fetchOffers, formatOffer, checkNpubAge } from './nostr.js'
import { getSellerRating, ping as supabasePing } from './supabase.js'
import { nip19 } from 'nostr-tools'
import { escMd, formatStars } from './utils.js'
import {
  publishServicio, publishEvento, publishComunidad,
  publishHerramienta, publishTransaccion,
} from './publish.js'

// ── Textos estáticos ────────────────────────────────────────────

const PRIVACY_NOTICE = `🔒 *Aviso de privacidad — lee antes de continuar*

Lo que escribas se publicará en la red *Nostr* \\(descentralizada y permanente\\)\\. Ten en cuenta:

• Tu ID de Telegram *nunca* se incluye en la publicación
• Puedes usar un pseudónimo en el campo nombre
• El contacto que indiques lo verán todos los usuarios de Nostr
• Una vez publicado, no podemos borrarlo de todos los relays

_Si continúas, aceptas que el contenido quedará en la red Nostr\\._`

const FAQ_TEXT = `❓ *Preguntas frecuentes — PlazaP2P*

*¿Qué es PlazaP2P?*
Una plaza digital P2P sobre la red Nostr\\. Sin intermediarios, sin empresa detrás\\. El bot publica en Nostr directamente\\.

*¿Qué es Nostr?*
Un protocolo descentralizado de comunicación\\. Los datos son tuyos, no de ninguna plataforma\\. Nadie puede censurarte ni borrarte la cuenta\\.

*¿Qué diferencia hay entre Modo Seudónimo y Modo Perfil?*
• *Seudónimo* \\(por defecto\\): Publicas con un alias\\. Puedes publicar servicios, eventos, comunidades y herramientas\\.
• *Perfil*: Vinculas tu cuenta Nostr con /vincular\\. Verificación criptográfica real\\. Además puedes publicar ventas, compras e intercambios\\.

*¿Por qué necesito vincular mi npub para ventas/compras?*
Las transacciones requieren identidad trazable\\. Si alguien hace scam, su npub queda en los relays Nostr para siempre y la comunidad puede valorarle negativamente\\.

*¿Cómo funciona la verificación de npub?*
El bot genera un código único\\. Tú publicas ese código como nota en Nostr firmada con tu clave\\. El bot verifica en los relays que esa nota existe y está firmada por tu npub\\. Así se prueba que controlas esa clave sin compartirla\\.

*¿El bot guarda mi clave privada?*
Nunca\\. El bot solo necesita tu npub \\(clave pública\\)\\. Tu nsec \\(clave privada\\) nunca sale de tu dispositivo\\.

*¿Cómo protegerme en intercambios P2P?*
• Verifica la reputación con /reputacion antes de operar
• Nunca pagues primero sin garantías
• Para importes altos, usa un escrow o intermediario de confianza
• PlazaP2P no actúa como intermediario — toda transacción es P2P

*¿Puedo borrar un anuncio publicado?*
Los datos en Nostr son permanentes en los relays\\. Puedes marcar un anuncio como expirado pero los datos quedan distribuidos en la red\\.

*¿Por qué el npub debe tener 30 días de antigüedad para ventas?*
Reduce el riesgo de cuentas creadas expresamente para scam\\. Un npub con historial de 30\\+ días tiene más credibilidad comunitaria\\.`

const APRENDE_TEXT = `📚 *Aprende sobre Nostr*

Nostr es un protocolo descentralizado para redes sociales y comunicación\\. Aquí tienes recursos para empezar:

🌐 *Guías y documentación:*
• nostr\\.how — Guía oficial en español e inglés
• usenostr\\.org — Recursos para usuarios
• nostr\\-resources\\.com — Lista curada de recursos

📱 *Clientes Nostr recomendados:*
• Primal \\(iOS/Android/Web\\)
• Amethyst \\(Android\\)
• Damus \\(iOS\\)
• Nostrudel \\(Web, avanzado\\)
• Snort\\.social \\(Web\\)

🔑 *Para empezar necesitas:*
1\\. Instalar un cliente Nostr
2\\. Crear tu keypair \\(o importar el existente\\)
3\\. Publicar tu primer mensaje
4\\. Explorar y seguir otras cuentas

_La curva de aprendizaje es pequeña\\. En 10 minutos ya puedes estar publicando\\._`

const PLATAFORMAS_TEXT = `🌐 *Clientes y plataformas Nostr*

Usa cualquiera de estos clientes para publicar, explorar y conectar en Nostr:

*Web:*
• 🟣 Primal\\.net — Completo, fácil de usar
• 🔵 Nostrudel\\.ninja — Avanzado, muy personalizable
• ⚡ Snort\\.social — Rápido y limpio

*Móvil:*
• 📱 Primal \\(iOS \\+ Android\\) — Mejor para empezar
• 🤖 Amethyst \\(Android\\) — Potente, muchas funciones
• 🍎 Damus \\(iOS\\) — El pionero, muy popular

*Para explorar anuncios de PlazaP2P en Nostr:*
Busca el hashtag *\\#plazap2p* en cualquiera de estos clientes`

// ── Función principal que construye el bot ─────────────────────
// Se crea en cada request para que env esté disponible en closures

function makeBot(env) {
  // Validación de secrets al arranque — falla rápido con mensaje claro
  const REQUIRED_SECRETS = ['BOT_TOKEN', 'BOT_NSEC', 'WEBHOOK_SECRET', 'KV_BOT', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY']
  for (const key of REQUIRED_SECRETS) {
    if (!env[key]) throw new Error(`[startup] Secret requerido no encontrado: ${key}`)
  }

  // URL de la Mini App — configurar en wrangler.toml como [vars] MINI_APP_URL
  if (!env.MINI_APP_URL) {
    console.warn('[startup] MINI_APP_URL no configurada — usando fallback de desarrollo. Configura esta variable en wrangler.toml antes de producción.')
  }
  const MINI_APP_URL = env.MINI_APP_URL || 'https://jjstudio-dev.github.io/Plazap2p-v3/'

  const bot = new Bot(env.BOT_TOKEN)

  // ── Sesión con KV (persiste entre requests y restarts) ─────────
  bot.use(session({
    initial: () => ({
      publishNoticeSeen:    false,
      disclaimerSeen:       false,
      pendingConversation:  null,
      mode:                 'seudónimo',
      linked_npub:          null,
      linked_npub_hex:      null,
      linked_npub_verified: false,
    }),
    storage: new CloudflareKVAdapter(env.KV_BOT, { prefix: 'sess:', expirationTtl: 2592000 }),
  }))

  bot.use(conversations())

  // ── Rate limit: KV con TTL 24h — fecha UTC explícita ──────────
  // Fecha ISO "2026-06-19" evita ambigüedades de timezone vs toDateString()
  const todayUTC = () => new Date().toISOString().slice(0, 10)

  const checkRateLimit = async (userId) => {
    const key   = `rl:${userId}:${todayUTC()}`
    const raw   = await env.KV_BOT.get(key)
    const count = raw ? parseInt(raw, 10) : 0
    if (count >= 5) return false
    await env.KV_BOT.put(key, String(count + 1), { expirationTtl: 86400 })
    return true
  }

  const convOpts = { checkRateLimit, botToken: env.BOT_TOKEN, botNsec: env.BOT_NSEC, env }

  bot.use(createConversation((conv, ctx) => eventoConversation(conv, ctx, convOpts),       'evento'))
  bot.use(createConversation((conv, ctx) => servicioConversation(conv, ctx, convOpts),     'servicio'))
  bot.use(createConversation((conv, ctx) => comunidadConversation(conv, ctx, convOpts),    'comunidad'))
  bot.use(createConversation((conv, ctx) => herramientaConversation(conv, ctx, convOpts),  'herramienta'))
  bot.use(createConversation((conv, ctx) => transaccionConversation(conv, ctx, { ...convOpts, tipoTag: 'plazap2p-venta' }),       'transaccion-venta'))
  bot.use(createConversation((conv, ctx) => transaccionConversation(conv, ctx, { ...convOpts, tipoTag: 'plazap2p-compra' }),      'transaccion-compra'))
  bot.use(createConversation((conv, ctx) => transaccionConversation(conv, ctx, { ...convOpts, tipoTag: 'plazap2p-intercambio' }), 'transaccion-intercambio'))
  bot.use(createConversation((conv, ctx) => vincularConversation(conv, ctx, convOpts),     'vincular'))
  bot.use(createConversation((conv, ctx) => valorarConversation(conv, ctx, convOpts),      'valorar'))

  // Ignorar mensajes de otros bots
  bot.on('message', async (ctx, next) => {
    if (ctx.from?.is_bot) return
    return next()
  })

  // ── Reply Keyboard persistente (Nivel 1 UX) ───────────────────
  // Se envía una vez con /start y permanece visible en el teclado del usuario.
  // Los botones se enrutan via bot.hears() cuando no hay conversación activa.
  function replyKeyboard() {
    return {
      keyboard: [
        [{ text: '📢 Publicar' }, { text: '🔍 Ver ofertas' }, { text: '⭐ Valorar' }],
        [{ text: '👤 Mi cuenta' },                            { text: '❓ Ayuda' }],
      ],
      resize_keyboard: true,
      persistent: true,
    }
  }

  // ── Menú inline principal (compacto, 6 botones) ───────────────
  function mainMenu() {
    return new InlineKeyboard()
      .text('📢 Publicar',     'submenu_publicar')
      .text('🔍 Ver ofertas',  'menu_ofertas').row()
      .text('⭐ Valorar',      'menu_valorar')
      .text('📋 Mis anuncios', 'menu_misanuncios').row()
      .text('👤 Mi cuenta',    'submenu_cuenta')
      .text('❓ FAQ',          'menu_faq')
  }

  function welcomeText(session) {
    const isPerfilMode = session?.mode === 'perfil' && session?.linked_npub_verified
    const modoLine = isPerfilMode
      ? `🔵 *Modo Perfil* — identidad verificada`
      : `⚪ *Modo Seudónimo* — sin identidad vinculada`
    let text = `🏪 *PlazaP2P* — Red P2P sobre Nostr\n━━━━━━━━━━━━━━━━━━━━\n${modoLine}`
    if (isPerfilMode && session?.linked_npub) {
      text += `\n📎 \`${escMd(session.linked_npub.slice(0, 18) + '…')}\``
    }
    text += '\n\n_Usa los botones para navegar\\._'
    return text
  }

  // ── Submenu Publicar — abre Mini App por tipo ─────────────────
  async function showPublicarSubmenu(ctx) {
    const isPerfilMode = ctx.session?.mode === 'perfil' && ctx.session?.linked_npub_verified
    const mode = isPerfilMode ? '&mode=perfil' : ''

    const kb = new InlineKeyboard()
      .webApp('🔧 Servicio',    `${MINI_APP_URL}?type=servicio${mode}`)
      .webApp('📅 Evento',      `${MINI_APP_URL}?type=evento${mode}`).row()
      .webApp('🏘 Comunidad',   `${MINI_APP_URL}?type=comunidad${mode}`)
      .webApp('🛠 Herramienta', `${MINI_APP_URL}?type=herramienta${mode}`).row()

    if (isPerfilMode) {
      kb.webApp('📦 Vender',      `${MINI_APP_URL}?type=venta${mode}`)
        .webApp('🛒 Comprar',     `${MINI_APP_URL}?type=compra${mode}`).row()
        .webApp('🔄 Intercambio', `${MINI_APP_URL}?type=intercambio${mode}`).row()
    } else {
      kb.text('🔒 Vender / Comprar / Intercambio', 'goto_vincular').row()
    }
    kb.text('◀ Volver', 'back_to_menu')

    const txt = isPerfilMode
      ? '📢 *¿Qué quieres publicar?*'
      : '📢 *¿Qué quieres publicar?*\n\n_Vender, Comprar e Intercambiar requieren Modo Perfil \\(/vincular\\)\\._'
    await ctx.reply(txt, { parse_mode: 'MarkdownV2', reply_markup: kb })
  }

  // ── Submenu Mi Cuenta ─────────────────────────────────────────
  async function showCuentaSubmenu(ctx) {
    const isPerfilMode = ctx.session?.mode === 'perfil' && ctx.session?.linked_npub_verified
    const kb = new InlineKeyboard()
      .text('👤 Mi perfil',    'cmd_miperfil')
      .text('📋 Mis anuncios', 'menu_misanuncios').row()
    if (isPerfilMode) {
      const npubShort = escMd(ctx.session.linked_npub?.slice(0, 14) + '…')
      kb.text(`🔵 Perfil: \`${npubShort}\``, 'menu_modo').row()
    } else {
      kb.text('🔗 Vincular mi npub', 'goto_vincular').row()
      kb.text('⚪ Modo Seudónimo',   'menu_modo').row()
    }
    kb.text('◀ Volver', 'back_to_menu')
    await ctx.reply('👤 *Tu cuenta en PlazaP2P*', { parse_mode: 'MarkdownV2', reply_markup: kb })
  }

  // ── Aviso de privacidad (primera vez antes de publicar) ────────
  async function ensurePrivacyNotice(ctx, conversationName = null) {
    if (ctx.session?.publishNoticeSeen) return true
    if (ctx.session && conversationName) ctx.session.pendingConversation = conversationName
    const keyboard = new InlineKeyboard()
      .text('✅ Entendido, continuar', 'privacy_ok')
      .text('❌ Cancelar',            'privacy_cancel')
    await ctx.reply(PRIVACY_NOTICE, { parse_mode: 'MarkdownV2', reply_markup: keyboard })
    return false
  }

  // ── Ayudante: entrar a transacción según modo ──────────────────
  async function enterTransaccion(ctx, tipoTag) {
    const isPerfilMode = ctx.session?.mode === 'perfil' && ctx.session?.linked_npub_verified
    if (!isPerfilMode) {
      const tipo = tipoTag.replace('plazap2p-', '')
      await redirectGuide(ctx, tipo)
      return
    }
    if (!await ensurePrivacyNotice(ctx, `transaccion-${tipoTag.replace('plazap2p-', '')}`)) return
    await ctx.conversation.enter(`transaccion-${tipoTag.replace('plazap2p-', '')}`)
  }

  // ── Handler de Mi Perfil ──────────────────────────────────────
  async function handleMiPerfil(ctx) {
    const userId = ctx.from?.id
    if (!userId) return
    const isPerfilMode = ctx.session?.mode === 'perfil' && ctx.session?.linked_npub_verified

    let pubs = []
    try {
      const raw = await env.KV_BOT.get(`pub:${userId}`)
      if (raw) {
        const parsed = JSON.parse(raw)
        pubs = Array.isArray(parsed) ? parsed : []
      }
    } catch {}

    let text = `👤 *Mi perfil en PlazaP2P*\n\n`
    text += isPerfilMode
      ? `🔵 *Modo:* Perfil \\(identidad verificada\\)\n📎 *Npub:* \`${escMd(ctx.session.linked_npub?.slice(0, 18) + '…')}\`\n`
      : `⚪ *Modo:* Seudónimo\n`
    text += `\n📊 *Actividad:*\n`
    text += `• Publicaciones guardadas: ${pubs.length}\n`
    if (pubs.length > 0) {
      text += `• Primera publicación: ${escMd(new Date(pubs[pubs.length - 1].ts).toLocaleDateString('es-ES'))}\n`
    }
    text += `\n_Para ver tu reputación: /reputacion \\<tu\\_npub\\>_`

    const kb = new InlineKeyboard()
    if (!isPerfilMode) kb.text('🔗 Vincular Nostr', 'goto_vincular').row()
    kb.text('🏪 Menú principal', 'back_to_menu')

    await ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: kb })
  }

  // ── Handler de Mis Anuncios ───────────────────────────────────
  async function handleMisAnuncios(ctx) {
    const userId = ctx.from?.id
    if (!userId) return

    let list = []
    try {
      const raw = await env.KV_BOT.get(`pub:${userId}`)
      if (raw) {
        const parsed = JSON.parse(raw)
        list = Array.isArray(parsed) ? parsed : []
      }
    } catch {}

    if (list.length === 0) {
      await ctx.reply(
        '📋 No tienes publicaciones recientes registradas\\.\n\nUsa el menú para publicar un servicio, evento, comunidad o herramienta\\.',
        { parse_mode: 'MarkdownV2', reply_markup: new InlineKeyboard().text('🏪 Menú', 'back_to_menu') }
      )
      return
    }

    let text = '📋 *Tus publicaciones recientes:*\n\n'
    const kb  = new InlineKeyboard()
    list.forEach((pub, i) => {
      const date = new Date(pub.ts).toLocaleDateString('es-ES')
      const icon = pub.kind === 31922 ? '📅' : '📦'
      text += `${icon} *${escMd(pub.title.slice(0, 50))}* \\(${escMd(date)}\\)\n`
      // Solo añadir fila si hay botón — kb.row() sin botón previo genera filas vacías
      if (pub.naddr) { kb.url(`🔗 Ver #${i + 1}`, `https://njump.me/${pub.naddr}`); kb.row() }
    })
    kb.text('🏪 Menú principal', 'back_to_menu')
    await ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: kb })
  }

  // ── Comando /start ─────────────────────────────────────────────
  bot.command('start', async (ctx) => {
    // Enviar reply keyboard persistente + mensaje de bienvenida con menú inline
    await ctx.reply(welcomeText(ctx.session), {
      parse_mode: 'MarkdownV2',
      reply_markup: replyKeyboard(),
    })
    await ctx.reply('¿Qué quieres hacer?', { reply_markup: mainMenu() })
  })

  // ── Comandos de publicación ────────────────────────────────────
  bot.command('servicio', async (ctx) => {
    if (!await ensurePrivacyNotice(ctx, 'servicio')) return
    await ctx.conversation.enter('servicio')
  })
  bot.command('evento', async (ctx) => {
    if (!await ensurePrivacyNotice(ctx, 'evento')) return
    await ctx.conversation.enter('evento')
  })
  bot.command('comunidad', async (ctx) => {
    if (!await ensurePrivacyNotice(ctx, 'comunidad')) return
    await ctx.conversation.enter('comunidad')
  })
  bot.command('herramienta', async (ctx) => {
    if (!await ensurePrivacyNotice(ctx, 'herramienta')) return
    await ctx.conversation.enter('herramienta')
  })
  bot.command('vender',      async (ctx) => { await enterTransaccion(ctx, 'plazap2p-venta') })
  bot.command('comprar',     async (ctx) => { await enterTransaccion(ctx, 'plazap2p-compra') })
  bot.command('intercambio', async (ctx) => { await enterTransaccion(ctx, 'plazap2p-intercambio') })

  // ── Comando /vincular — con rate limit para prevenir flooding ──
  bot.command('vincular', async (ctx) => {
    if (ctx.from?.is_bot) return
    const userId = ctx.from?.id
    if (!userId) return

    const rlKey  = `rl_vincular:${userId}:${new Date().toISOString().slice(0, 13)}` // ventana horaria UTC
    const raw    = await env.KV_BOT.get(rlKey)
    const count  = parseInt(raw || '0', 10)
    if (count >= 5) {
      await ctx.reply('⚠️ Demasiados intentos de vinculación\\. Espera una hora e inténtalo de nuevo\\.', { parse_mode: 'MarkdownV2' })
      return
    }
    await env.KV_BOT.put(rlKey, String(count + 1), { expirationTtl: 3600 })
    await ctx.conversation.enter('vincular')
  })

  // ── Comando /modo ─────────────────────────────────────────────
  bot.command('modo', async (ctx) => {
    const isPerfilMode = ctx.session?.mode === 'perfil' && ctx.session?.linked_npub_verified
    const npubShort    = ctx.session?.linked_npub ? escMd(ctx.session.linked_npub.slice(0, 18) + '…') : null
    let text
    if (isPerfilMode) {
      text = `🔵 *Modo Perfil activo*\n\n📎 Npub vinculado: \`${npubShort}\`\n\n✅ Puedes publicar ventas, compras e intercambios\\.`
    } else {
      text = `⚪ *Modo Seudónimo activo*\n\nPublicas sin identidad Nostr vinculada\\.\n\nPara activar el *Modo Perfil* y publicar transacciones:\nUsa /vincular para vincular tu npub\\.`
    }
    const kb = new InlineKeyboard()
    if (!isPerfilMode) kb.text('🔗 Vincular mi npub', 'goto_vincular').row()
    kb.text('🏪 Menú principal', 'back_to_menu')
    await ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: kb })
  })

  // ── Comando /miperfil ─────────────────────────────────────────
  bot.command('miperfil', async (ctx) => {
    if (ctx.from?.is_bot) return
    await handleMiPerfil(ctx)
  })

  // ── Comandos informativos ─────────────────────────────────────
  bot.command('faq',        async (ctx) => ctx.reply(FAQ_TEXT, { parse_mode: 'MarkdownV2', reply_markup: new InlineKeyboard().text('🏪 Menú', 'back_to_menu') }))
  bot.command('ayuda',      async (ctx) => ctx.reply(FAQ_TEXT, { parse_mode: 'MarkdownV2', reply_markup: new InlineKeyboard().text('🏪 Menú', 'back_to_menu') }))
  bot.command('aprende',    async (ctx) => ctx.reply(APRENDE_TEXT, { parse_mode: 'MarkdownV2', reply_markup: new InlineKeyboard().text('🏪 Menú', 'back_to_menu') }))
  bot.command('plataformas',async (ctx) => ctx.reply(PLATAFORMAS_TEXT, { parse_mode: 'MarkdownV2', reply_markup: new InlineKeyboard().text('🏪 Menú', 'back_to_menu') }))

  // ── Comando /valorar ──────────────────────────────────────────
  bot.command('valorar', async (ctx) => {
    if (ctx.from?.is_bot) return
    await ctx.conversation.enter('valorar')
  })

  // ── Comando /reputacion ───────────────────────────────────────
  bot.command('reputacion', async (ctx) => {
    if (ctx.from?.is_bot) return
    const arg = ctx.match?.trim()
    if (!arg) {
      await ctx.reply(
        '📊 *Consultar reputación*\n\nUso: `/reputacion npub1\\.\\.\\.` o `/reputacion <hex64>`',
        { parse_mode: 'MarkdownV2' }
      )
      return
    }

    let pubkeyHex = null
    if (/^[0-9a-fA-F]{64}$/.test(arg)) {
      pubkeyHex = arg.toLowerCase()
    } else {
      try {
        const decoded = nip19.decode(arg)
        if (decoded.type === 'npub')    pubkeyHex = decoded.data
        else if (decoded.type === 'nprofile') pubkeyHex = decoded.data.pubkey
      } catch {}
    }

    if (!pubkeyHex) {
      await ctx.reply('⚠️ Formato no reconocido\\. Envía un *npub1\\.\\.\\.* o una pubkey hex de 64 chars\\.', { parse_mode: 'MarkdownV2' })
      return
    }

    const rating = await getSellerRating(pubkeyHex, env)
    if (!rating || rating.review_count < 1) {
      const npubShort = escMd('npub1' + pubkeyHex.slice(0, 8) + '…')
      await ctx.reply(`ℹ️ *${npubShort}* no tiene valoraciones en PlazaP2P aún\\.`, { parse_mode: 'MarkdownV2' })
      return
    }

    const ASPECT_LABELS = {
      avg_comunicacion: '💬 Comunicación',
      avg_cumplimiento: '✅ Cumplimiento',
      avg_precio_justo: '💰 Precio justo',
      avg_rapidez:      '⚡ Rapidez',
      avg_confianza:    '🔐 Confianza',
    }

    const avg = Number(rating.avg_overall ?? 0)
    const n   = rating.review_count ?? 0
    let npubFull
    try { npubFull = nip19.npubEncode(pubkeyHex) } catch { npubFull = null }
    const npubDisp = escMd(npubFull ? npubFull.slice(0, 14) + '…' : pubkeyHex.slice(0, 12) + '…')

    let text = `📊 *Reputación de \`${npubDisp}\`*\n\n`
    text += `${formatStars(avg)} *${escMd(avg.toFixed(1))} / 5* \\(${n} valoración${n !== 1 ? 'es' : ''}\\)\n`

    const aspectLines = Object.entries(ASPECT_LABELS)
      .filter(([key]) => rating[key] != null)
      .map(([key, label]) => `${label}: ${formatStars(Number(rating[key]))} ${escMd(Number(rating[key]).toFixed(1))}`)
    if (aspectLines.length) text += '\n' + aspectLines.join('\n') + '\n'

    text += `\n🔍 _Verificar valoraciones en Nostr:_\n`
    if (npubFull) text += `[Ver perfil en njump\\.me](https://njump\\.me/${escMd(npubFull)})`

    await ctx.reply(text, { parse_mode: 'MarkdownV2' })
  })

  // ── Comando /cancelar ─────────────────────────────────────────
  bot.command('cancelar', async (ctx) => {
    await ctx.conversation.exit()
    await ctx.reply('❌ Conversación cancelada\\.', {
      parse_mode: 'MarkdownV2',
      reply_markup: new InlineKeyboard().text('🏪 Menú principal', 'back_to_menu'),
    })
  })

  // ── Comando /misanuncios ──────────────────────────────────────
  bot.command('misanuncios', async (ctx) => {
    if (ctx.from?.is_bot) return
    await handleMisAnuncios(ctx)
  })

  // ── Comando /ofertas ──────────────────────────────────────────
  async function showOfertasFilter(ctx) {
    const kb = new InlineKeyboard()
      .text('📦 Ventas',    'ofertas_venta')
      .text('🛒 Compras',   'ofertas_compra').row()
      .text('🔧 Servicios', 'ofertas_servicio')
      .text('🔄 Ver todas', 'ofertas_todas')
    await ctx.reply('🔍 *¿Qué tipo de publicaciones quieres ver?*', { parse_mode: 'MarkdownV2', reply_markup: kb })
  }

  bot.command('ofertas', async (ctx) => { await showOfertasFilter(ctx) })

  bot.callbackQuery('ofertas_venta',    async (ctx) => { await ctx.answerCallbackQuery(); await handleOfertas(ctx, 'plazap2p-venta') })
  bot.callbackQuery('ofertas_compra',   async (ctx) => { await ctx.answerCallbackQuery(); await handleOfertas(ctx, 'plazap2p-compra') })
  bot.callbackQuery('ofertas_servicio', async (ctx) => { await ctx.answerCallbackQuery(); await handleOfertas(ctx, 'plazap2p-servicio') })
  bot.callbackQuery('ofertas_todas',    async (ctx) => { await ctx.answerCallbackQuery(); await handleOfertas(ctx, null) })

  async function handleOfertas(ctx, tagFilter = null) {
    const userId = ctx.from?.id
    if (userId) {
      const cdKey = `cd:${userId}`
      const busy  = await env.KV_BOT.get(cdKey)
      if (busy) {
        await ctx.reply('⏱ Espera unos segundos antes de volver a consultar\\.', { parse_mode: 'MarkdownV2' })
        return
      }
      await env.KV_BOT.put(cdKey, '1', { expirationTtl: 15 })
    }

    const DISCLAIMER =
      '⚠️ *Aviso importante*\n\n' +
      'PlazaP2P solo muestra información pública de Nostr\\. ' +
      'No verificamos ofertas ni actuamos como intermediarios\\. ' +
      'Toda transacción es P2P y ocurre directamente entre las partes\\.'

    if (!ctx.session?.disclaimerSeen) {
      await ctx.reply(DISCLAIMER, { parse_mode: 'MarkdownV2' })
      if (ctx.session) ctx.session.disclaimerSeen = true
    }

    await ctx.reply('🔍 Buscando en los relays Nostr\\.\\.\\.', { parse_mode: 'MarkdownV2' })

    try {
      const offers = await fetchOffers(10, tagFilter)
      if (offers.length === 0) {
        const tagLabel = tagFilter ? `\\#${escMd(tagFilter)}` : '\\#plazap2p'
        await ctx.reply(`No se encontraron publicaciones recientes con el tag ${tagLabel}\\.`, { parse_mode: 'MarkdownV2' })
        return
      }

      await ctx.reply(`📦 *${offers.length} publicaciones encontradas:*`, { parse_mode: 'MarkdownV2' })
      for (const offer of offers) {
        try {
          await ctx.reply(formatOffer(offer), { parse_mode: 'MarkdownV2' })
        } catch (e) {
          console.error('formatOffer failed for event', offer?.id, e.message)
        }
      }
      await ctx.reply(
        '─────────────────',
        { reply_markup: new InlineKeyboard().url('🔗 Ver más en PlazaP2P', MINI_APP_URL) }
      )
    } catch (err) {
      console.error('[ofertas] relay error:', err.message)
      await ctx.reply('❌ No se pudo consultar los relays\\. Inténtalo de nuevo en unos minutos\\.', { parse_mode: 'MarkdownV2' })
    }
  }

  // ── Reply Keyboard: enrutar botones del teclado persistente ───
  // bot.hears() se ejecuta solo cuando NO hay conversación activa
  // (grammy conversations interceptan primero cuando están activas)
  bot.hears('📢 Publicar',    async (ctx) => { await showPublicarSubmenu(ctx) })
  bot.hears('🔍 Ver ofertas', async (ctx) => { await showOfertasFilter(ctx) })
  bot.hears('⭐ Valorar',     async (ctx) => { if (ctx.from?.is_bot) return; await ctx.conversation.enter('valorar') })
  bot.hears('👤 Mi cuenta',   async (ctx) => { await showCuentaSubmenu(ctx) })
  bot.hears('❓ Ayuda',       async (ctx) => {
    await ctx.reply(FAQ_TEXT, { parse_mode: 'MarkdownV2', reply_markup: new InlineKeyboard().text('🏪 Menú', 'back_to_menu') })
  })

  // ── Mini App (web_app_data) — handler para la futura app embebida ──
  // Cuando la Mini App envíe Telegram.WebApp.sendData(JSON), llega aquí.
  // Reutiliza el mismo publish.js que los wizards — sin duplicar lógica.
  bot.on(':web_app_data', async (ctx) => {
    const userId = ctx.from?.id
    if (!userId) return

    // El aviso de privacidad debe haberse aceptado en el bot antes de publicar
    if (!ctx.session?.publishNoticeSeen) {
      const backKb = new InlineKeyboard().text('🏪 Menú principal', 'back_to_menu')
      await ctx.reply(
        '⚠️ Antes de publicar debes aceptar el *aviso de privacidad*\\.\n\nVuelve al menú principal con /start y acepta el aviso\\.',
        { parse_mode: 'MarkdownV2', reply_markup: backKb }
      )
      return
    }

    let data
    try {
      data = JSON.parse(ctx.message.web_app_data.data)
    } catch {
      await ctx.reply('❌ Datos del formulario no válidos\\. Por favor inténtalo de nuevo\\.', { parse_mode: 'MarkdownV2' })
      return
    }

    if (!await checkRateLimit(userId)) {
      await ctx.reply('⚠️ Has alcanzado el límite de *5 publicaciones por día*\\. Vuelve mañana\\.', { parse_mode: 'MarkdownV2' })
      return
    }

    await ctx.reply('⏳ Procesando tu publicación\\.\\.\\. un momento\\.', { parse_mode: 'MarkdownV2' })

    const userPubHex = ctx.session?.linked_npub_verified ? ctx.session.linked_npub_hex : null
    const backKb     = new InlineKeyboard().text('🏪 Menú principal', 'back_to_menu')
    const type       = data?.type

    let result
    if (type === 'servicio') {
      result = await publishServicio(data, env.BOT_NSEC, env, userId, userPubHex)
    } else if (type === 'evento') {
      result = await publishEvento(data, env.BOT_NSEC, env, userId, userPubHex)
    } else if (type === 'comunidad') {
      result = await publishComunidad(data, env.BOT_NSEC, env, userId, userPubHex)
    } else if (type === 'herramienta') {
      result = await publishHerramienta(data, env.BOT_NSEC, env, userId, userPubHex)
    } else if (type === 'venta' || type === 'compra' || type === 'intercambio') {
      if (!ctx.session?.linked_npub_verified) {
        await ctx.reply('⚠️ Las transacciones requieren *Modo Perfil* \\(/vincular\\)\\.', { parse_mode: 'MarkdownV2', reply_markup: backKb })
        return
      }
      // Verificar antigüedad del npub: mínimo 30 días para transacciones (anti-scam)
      // null = relay no respondió → rechazar igual que el wizard (no dejar pasar por fallo de relay)
      const ageDays = await checkNpubAge(userPubHex)
      if (ageDays === null) {
        await ctx.reply(
          '⚠️ *No se pudo verificar la antigüedad del npub*\n\n' +
          '_Los relays Nostr no respondieron\\. Inténtalo de nuevo en unos minutos\\._',
          { parse_mode: 'MarkdownV2', reply_markup: backKb }
        )
        return
      }
      if (ageDays < 30) {
        await ctx.reply(
          `⚠️ *Npub demasiado reciente*\n\n` +
          `Tu cuenta Nostr tiene ${ageDays} día${ageDays !== 1 ? 's' : ''} de antigüedad\\.\n` +
          `Para publicar transacciones se requieren al menos *30 días* para reducir el riesgo de scam\\.`,
          { parse_mode: 'MarkdownV2', reply_markup: backKb }
        )
        return
      }
      // Normalizar tipoTag desde el tipo
      data.tipoTag = `plazap2p-${type}`
      result = await publishTransaccion(data, env.BOT_NSEC, env, userId, userPubHex)
    } else {
      await ctx.reply(`❌ Tipo de publicación no reconocido: ${escMd(String(type ?? 'desconocido'))}\\.`, { parse_mode: 'MarkdownV2', reply_markup: backKb })
      return
    }

    if (result.ok) {
      const okKb = new InlineKeyboard()
      if (result.naddr) okKb.url('🔗 Ver en Nostr', `https://njump.me/${result.naddr}`).row()
      okKb.text('🏪 Menú principal', 'back_to_menu')
      const reply = `✅ *Publicado en ${result.published}/${result.total} relays*`
      await ctx.reply(reply, { parse_mode: 'MarkdownV2', reply_markup: okKb })
    } else {
      await ctx.reply(`❌ Error al publicar: ${escMd(result.error ?? 'Error desconocido')}`, { parse_mode: 'MarkdownV2', reply_markup: backKb })
    }
  })

  // ── Callbacks del aviso de privacidad ─────────────────────────
  const VALID_PENDING_CONVS = ['servicio', 'evento', 'comunidad', 'herramienta',
    'transaccion-venta', 'transaccion-compra', 'transaccion-intercambio']

  bot.callbackQuery('privacy_ok', async (ctx) => {
    await ctx.answerCallbackQuery()
    if (ctx.session) ctx.session.publishNoticeSeen = true
    const pending = ctx.session?.pendingConversation ?? null
    if (ctx.session) ctx.session.pendingConversation = null
    if (pending && VALID_PENDING_CONVS.includes(pending)) {
      await ctx.conversation.enter(pending)
    } else {
      await ctx.reply('✅ Aviso aceptado\\. Usa el menú para publicar\\.', {
        parse_mode: 'MarkdownV2',
        reply_markup: mainMenu(),
      })
    }
  })

  bot.callbackQuery('privacy_cancel', async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.reply('❌ Cancelado\\. Pulsa /start para volver al menú\\.', { parse_mode: 'MarkdownV2' })
  })

  // ── Callbacks del menú principal ──────────────────────────────
  const menuEntry = (name) => async (ctx) => {
    await ctx.answerCallbackQuery()
    if (!ctx.session?.publishNoticeSeen) {
      if (!await ensurePrivacyNotice(ctx, name)) return
    }
    await ctx.conversation.enter(name)
  }

  bot.callbackQuery('menu_servicio',    menuEntry('servicio'))
  bot.callbackQuery('menu_evento',      menuEntry('evento'))
  bot.callbackQuery('menu_comunidad',   menuEntry('comunidad'))
  bot.callbackQuery('menu_herramienta', menuEntry('herramienta'))

  bot.callbackQuery('menu_vender',      async (ctx) => { await ctx.answerCallbackQuery(); await enterTransaccion(ctx, 'plazap2p-venta') })
  bot.callbackQuery('menu_comprar',     async (ctx) => { await ctx.answerCallbackQuery(); await enterTransaccion(ctx, 'plazap2p-compra') })
  bot.callbackQuery('menu_intercambio', async (ctx) => { await ctx.answerCallbackQuery(); await enterTransaccion(ctx, 'plazap2p-intercambio') })

  bot.callbackQuery('menu_ofertas',     async (ctx) => { await ctx.answerCallbackQuery(); await showOfertasFilter(ctx) })
  bot.callbackQuery('menu_valorar',     async (ctx) => { await ctx.answerCallbackQuery(); await ctx.conversation.enter('valorar') })
  bot.callbackQuery('menu_misanuncios', async (ctx) => { await ctx.answerCallbackQuery(); await handleMisAnuncios(ctx) })

  bot.callbackQuery('submenu_publicar', async (ctx) => { await ctx.answerCallbackQuery(); await showPublicarSubmenu(ctx) })
  bot.callbackQuery('submenu_cuenta',   async (ctx) => { await ctx.answerCallbackQuery(); await showCuentaSubmenu(ctx) })
  bot.callbackQuery('cmd_miperfil',     async (ctx) => { await ctx.answerCallbackQuery(); await handleMiPerfil(ctx) })

  bot.callbackQuery('menu_modo', async (ctx) => {
    await ctx.answerCallbackQuery()
    const isPerfilMode = ctx.session?.mode === 'perfil' && ctx.session?.linked_npub_verified
    const npubShort    = ctx.session?.linked_npub ? escMd(ctx.session.linked_npub.slice(0, 18) + '…') : null
    let text
    if (isPerfilMode) {
      text = `🔵 *Modo Perfil activo*\n\n📎 Npub: \`${npubShort}\`\n\n✅ Puedes publicar ventas, compras e intercambios\\.`
    } else {
      text = `⚪ *Modo Seudónimo*\n\nUsa /vincular para vincular tu identidad Nostr y activar el Modo Perfil\\.`
    }
    const kb = new InlineKeyboard()
    if (!isPerfilMode) kb.text('🔗 Vincular mi npub', 'goto_vincular').row()
    kb.text('🏪 Menú principal', 'back_to_menu')
    await ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: kb })
  })

  bot.callbackQuery('menu_faq',         async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply(FAQ_TEXT, { parse_mode: 'MarkdownV2', reply_markup: new InlineKeyboard().text('🏪 Menú', 'back_to_menu') }) })
  bot.callbackQuery('menu_aprende',     async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply(APRENDE_TEXT, { parse_mode: 'MarkdownV2', reply_markup: new InlineKeyboard().text('🏪 Menú', 'back_to_menu') }) })
  bot.callbackQuery('menu_plataformas', async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply(PLATAFORMAS_TEXT, { parse_mode: 'MarkdownV2', reply_markup: new InlineKeyboard().text('🏪 Menú', 'back_to_menu') }) })

  // ── Callbacks de navegación ───────────────────────────────────
  bot.callbackQuery('back_to_menu', async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.reply(welcomeText(ctx.session), { parse_mode: 'MarkdownV2', reply_markup: mainMenu() })
  })

  bot.callbackQuery('goto_vincular', async (ctx) => {
    await ctx.answerCallbackQuery()
    const userId = ctx.from?.id
    if (!userId) return
    // Mismo rate limit que el comando /vincular (5 por hora)
    const rlKey = `rl_vincular:${userId}:${new Date().toISOString().slice(0, 13)}`
    const raw   = await env.KV_BOT.get(rlKey)
    const count = parseInt(raw || '0', 10)
    if (count >= 5) {
      await ctx.reply('⚠️ Demasiados intentos de vinculación\\. Espera una hora e inténtalo de nuevo\\.', { parse_mode: 'MarkdownV2' })
      return
    }
    await env.KV_BOT.put(rlKey, String(count + 1), { expirationTtl: 3600 })
    await ctx.conversation.enter('vincular')
  })

  bot.catch((err) => {
    // Loguear el objeto completo para preservar el stack trace en CF Workers logs
    console.error('[bot error]', err)
  })

  return bot
}

// ── Export: handler de Cloudflare Workers ─────────────────────
export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    // Guard de tamaño: Telegram nunca envía payloads > ~4KB en producción.
    // Rechazar payloads anómalos antes de parsear (defensa en profundidad).
    // El || 0 al final maneja el caso de header malformado (parseInt devuelve NaN).
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10) || 0
    if (contentLength > 100_000) {
      return new Response('Payload Too Large', { status: 413 })
    }

    const bot = makeBot(env)

    const handleUpdate = webhookCallback(bot, 'cloudflare-mod', {
      secretToken: env.WEBHOOK_SECRET,
    })

    return handleUpdate(request)
  },

  // Cron trigger: keep-alive de Supabase (free tier pausa a los 7 días sin actividad)
  async scheduled(_event, env) {
    await supabasePing(env)
  },
}
