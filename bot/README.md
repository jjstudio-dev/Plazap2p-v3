# Bot Telegram V3 — código de referencia (no desplegado)

Este directorio contiene el diseño completo del bot de Telegram para PlazaP2P
(Cloudflare Workers + grammyjs + @grammyjs/conversations + KV + Supabase + Nostr),
auditado y funcional a fecha 2026-06-25.

**Estado: no está desplegado ni en uso.** La vía activa del proyecto es la app
web (PWA) en la raíz de este repositorio, que cubre reputación, publicación y
descubrimiento directamente contra relays Nostr sin necesidad de bot ni backend.

Se publica aquí únicamente a modo informativo, por si alguien de la comunidad
quiere levantar su propia instancia del bot como puerta de entrada alternativa
(por ejemplo, para usuarios que prefieren Telegram a un cliente Nostr).

## Para desplegarlo

1. `npm install` dentro de `bot/`.
2. Copiar `.dev.vars.example` → `.dev.vars` (desarrollo) y configurar los secretos
   de producción con `wrangler secret put` (`BOT_TOKEN`, `BOT_NSEC`, `WEBHOOK_SECRET`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GITHUB_TOKEN`).
3. Crear el namespace KV: `wrangler kv namespace create KV_BOT` y añadir los IDs
   en `wrangler.toml`.
4. Aplicar las migraciones de `supabase/migrations/` (001 → 003) en el proyecto
   Supabase.
5. Configurar el webhook de Telegram apuntando a la URL del Worker.
6. `wrangler deploy`.

Entry point: `src/worker.js`. Detalle de arquitectura, modos de identidad y
anti-scam en el historial de commits de la rama `legacy-telegram` del repo
original.
