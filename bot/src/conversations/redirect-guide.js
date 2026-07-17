// redirect-guide.js — Guía para publicar ventas/compras/intercambios en Modo Seudónimo
// El bot NO publica directamente transacciones financieras anónimas (riesgo de scam)
// En su lugar genera el texto completo listo para copiar y publicar en Nostr

import { InlineKeyboard } from 'grammy'
import { escMd } from '../utils.js'

const NOSTR_CLIENTS = [
  { label: '🟣 Primal.net',     url: 'https://primal.net' },
  { label: '🔵 Nostrudel',      url: 'https://nostrudel.ninja' },
  { label: '⚡ Snort.social',   url: 'https://snort.social' },
]

/**
 * Guía interactiva para publicar transacciones en Nostr directamente.
 * @param {'venta'|'compra'|'intercambio'} tipo
 */
export async function redirectGuide(ctx, tipo = 'venta') {
  const configs = {
    venta: {
      emoji:    '📦',
      label:    'Venta',
      tag:      'plazap2p-venta',
      ejemplo:  'Vendo iPhone 13 128GB, estado 9/10, cargador original incluido. Madrid. Precio: 450 EUR. Contacto: @mi_usuario',
    },
    compra: {
      emoji:    '🛒',
      label:    'Búsqueda de compra',
      tag:      'plazap2p-compra',
      ejemplo:  'Busco comprar: MacBook Air M2, buen estado, menos de 1000 EUR. Envío a toda España. Contacto: @mi_usuario',
    },
    intercambio: {
      emoji:    '🔄',
      label:    'Intercambio',
      tag:      'plazap2p-intercambio',
      ejemplo:  'Ofrezco: cámara Sony RX100 a cambio de: tablet Android reciente. Madrid o envío. Contacto: @mi_usuario',
    },
  }

  const cfg = configs[tipo] ?? configs.venta

  // Generar texto de anuncio de ejemplo listo para copiar
  const templateText =
    `${cfg.emoji} [TÍTULO: qué ofreces/buscas]\n\n` +
    `[DESCRIPCIÓN: estado, características, condiciones]\n\n` +
    `💰 Precio: [precio y moneda o "A negociar"]\n` +
    `📍 Zona: [tu ciudad, región o "Online"]\n` +
    `📞 Contacto: [tu @telegram, email o npub]\n\n` +
    `#plazap2p #${cfg.tag}`

  const clientKb = new InlineKeyboard()
  NOSTR_CLIENTS.forEach(c => clientKb.url(c.label, c.url).row())
  clientKb.text('🔑 Vincular mi cuenta Nostr', 'goto_vincular').row()
  clientKb.text('🏪 Volver al menú', 'back_to_menu')

  await ctx.reply(
    `${cfg.emoji} *${escMd(cfg.label)} en Nostr*\n\n` +
    `⚪ Estás en *Modo Seudónimo*\\. Para publicar transacciones de forma directa en el bot, ` +
    `necesitas vincular tu cuenta Nostr \\(*Modo Perfil*\\)\\.\n\n` +
    `*¿Por qué?*\n` +
    `Las ventas, compras e intercambios requieren que haya una identidad trazable\\. ` +
    `Así la comunidad puede valorarte y protegerse de posibles scams\\.\n\n` +
    `*Opciones:*\n` +
    `1️⃣ *Vincular mi npub* \\(/vincular\\) → publicar directamente aquí con identidad verificada\n` +
    `2️⃣ *Publicar yo mismo en Nostr* → copia la plantilla de abajo y publícala en tu cliente Nostr favorito`,
    { parse_mode: 'MarkdownV2' }
  )

  // Inside a MarkdownV2 pre block, only backticks and backslashes need escaping
  const safeTemplate = templateText.replace(/\\/g, '\\\\').replace(/`/g, '\\`')
  await ctx.reply(
    `📋 *Plantilla lista para copiar:*\n\n` +
    `\`\`\`\n${safeTemplate}\n\`\`\`\n\n` +
    `_Edita los campos entre \\[ \\] con tu información real\\._`,
    { parse_mode: 'MarkdownV2' }
  )

  await ctx.reply(
    `⚠️ *Consejos de seguridad P2P:*\n\n` +
    `• Nunca pagues primero sin verificar la reputación del vendedor\n` +
    `• Usa /reputacion \\<npub\\> antes de operar\n` +
    `• Para importes altos, busca un escrow o intermediario de confianza\n` +
    `• Si algo parece demasiado bueno para ser verdad, probablemente lo es\n` +
    `• PlazaP2P no actúa como intermediario — toda transacción es P2P`,
    { parse_mode: 'MarkdownV2', reply_markup: clientKb }
  )
}
