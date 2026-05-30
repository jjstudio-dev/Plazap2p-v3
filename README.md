# PlazaP2P v3 — Economía Circular P2P en Nostr

**Directorio P2P de Economía Circular Bitcoin — España**

> La plaza abierta para mercado, comunidad y recursos Bitcoin. Economía circular P2P sobre Nostr, sin registro, sin intermediarios y 100% open source.

[![GitHub Pages](https://img.shields.io/badge/desplegado-GitHub%20Pages-0a0a0a?style=flat&logo=github)](https://github.com)
[![Licencia MIT](https://img.shields.io/badge/licencia-MIT-f7931a?style=flat)](LICENSE)
[![Nostr](https://img.shields.io/badge/protocolo-Nostr-8b5cf6?style=flat)](https://nostr.com)
[![Zero deps](https://img.shields.io/badge/dependencias-cero-00f5ff?style=flat)]()

---

## Por qué existe esto

Hay muchas formas de practicar economía circular con Bitcoin en España. Lo que no había era un mapa.

PlazaP2P nació para eso: para que una cafetería en Valencia que acepta sats pueda encontrarse con alguien en Madrid que los tiene y quiere gastarlos; para que un electricista que trabaja con Bitcoin no sea un rumor que circula por grupos de Telegram sino un nodo visible en el directorio; para que los meetups locales no sean un secreto de iniciados.

La idea era simple. La ejecución, incómoda.

Porque queríamos construir algo descentralizado, y lo seguíamos construyendo de forma centralizada. Cada versión del proyecto resolvía los síntomas sin tocar el problema de fondo.

---

**V1** demostró que la idea tenía sentido. Negocios, eventos y recursos Bitcoin en España, todo en archivos JSON versionados en GitHub. Pero publicar requería abrir un Issue con cuenta de GitHub, y alguien —el mantenedor— tenía que aprobarlo todo. El directorio era tan descentralizado como su cuello de botella humano.

**V2** suavizó la fricción: formulario web sin cuenta, Cloudflare en el edge, automatización casi completa. La experiencia mejoró notablemente. Pero cada anuncio seguía pasando por infraestructura que nosotros controlábamos y alojábamos. Si el mantenedor desaparece, el directorio se congela. Habíamos mejorado la UX de un sistema todavía centralizado.

**V3** es la respuesta honesta a esa contradicción: PlazaP2P sigue siendo la plaza de la economía circular Bitcoin, pero ahora las publicaciones viven en una red abierta.

---

Los anuncios no viven aquí. Viven en **Nostr** — un protocolo abierto de eventos firmados criptográficamente que nadie posee, nadie puede censurar y nadie puede apagar. PlazaP2P no intenta ser otra plataforma: es una plaza de lectura y descubrimiento sobre esa red.

Cualquier persona con un cliente Nostr puede publicar con el tag `#plazap2p` y aparecer aquí en segundos. Sin pedir permiso. Sin esperar aprobación. Sin depender de nosotros, ni de ningún otro intermediario.

Si este repositorio desaparece mañana, los datos siguen existiendo en los relays. Cualquiera puede levantar otra ventana idéntica. Nadie puede apagarlo porque no hay nada que apagar.

Eso es descentralización de verdad. Y vale la pena construirlo bien.

---

## Evolución del proyecto

| | V1 | V2 | V3 |
|---|---|---|---|
| **Publicación** | Issue en GitHub (requería cuenta) | Formulario web sin cuenta | Cliente Nostr (sin pasar por aquí) |
| **Aprobación** | Mantenedor añade label `aprobado` | Mantenedor revisa PR automático | Sin aprobación — protocolo abierto |
| **Backend** | Python `parse_issue.py` | Node.js `parse-issue.mjs` (0 deps) | Sin backend — WebSocket directo a relays |
| **Almacenamiento** | JSON en este repositorio | JSON en este repositorio | Los datos no son nuestros (relays Nostr) |
| **Hosting** | GitHub Pages | Cloudflare Pages + Functions + KV | GitHub Pages (HTML estático puro) |
| **Dependencias** | GitHub Actions + Python | Cloudflare + GitHub Actions | Cero. Vanilla JS. Sin npm. |
| **Tiempo real** | No | No | Sí — WebSocket a relays en vivo |
| **Censura** | Dependiente del mantenedor | Dependiente del mantenedor | Imposible desde aquí |
| **Fork y levantar** | Setup complejo | Setup Cloudflare + secrets | Fork → activar GitHub Pages → listo |
| **Si el repo desaparece** | Los datos se pierden | Los datos se pierden | Los datos siguen en los relays |

El repo V1 está archivado como referencia histórica. V2 sigue operativo como directorio curado.

---

## Qué es PlazaP2P v3

PlazaP2P es una **plaza abierta de solo lectura** para descubrir mercado, publicaciones y recursos alrededor de Bitcoin. Funciona sobre Nostr y muestra en tiempo real anuncios, posts y artículos publicados en relays públicos con el tag `#plazap2p`.

**No es** una plataforma centralizada. No custodia fondos. No intermedia acuerdos. No requiere cuenta en PlazaP2P. La publicación ocurre en Nostr; PlazaP2P facilita encontrarla.

### Qué muestra

| Tab | Tipo Nostr | Descripción |
|---|---|---|
| Mercado | `kind:30402` (NIP-99) | Anuncios de compra/venta P2P |
| Feed | `kind:1` | Posts de la comunidad |
| Artículos | `kind:30023` | Contenido largo |
| Eventos | `kind:31922/31923` (NIP-52) | Meetups y actividades de calendario |
| Comunidades | JSON local | Grupos locales curados |
| Herramientas | JSON local | Software y servicios Bitcoin |
| Multimedia | JSON local | Podcasts, vídeos y recursos |

Mercado, Feed, Artículos y Eventos leen **Nostr en tiempo real**. Comunidades, Herramientas y Multimedia siguen siendo directorios curados en este repositorio, revisados y actualizados manualmente.

---

## Cómo aparecer en PlazaP2P

No publiques aquí directamente. Publica desde un cliente Nostr compatible y añade el tag de la comunidad:

| Cliente | Plataforma | Tipo de evento |
|---|---|---|
| [Plebeian Market](https://plebeian.market) | Web | `kind:30402` (marketplace) |
| [Shopstr](https://shopstr.store) | Web | `kind:30402` (Lightning) |
| [Primal](https://primal.net) | Web / iOS / Android | `kind:1` (posts) |
| [Amethyst](https://amethyst.social) | Android | Todos los NIPs |
| [YakiHonne](https://yakihonne.com) | Web | `kind:30023` (artículos) |
| Cliente compatible NIP-52 | Web / móvil | `kind:31922/31923` (eventos) |

Incluye el tag `#plazap2p` en tu publicación. Para eventos, añade también `#plazap2p-evento` cuando el cliente lo permita. PlazaP2P podrá mostrarla en segundos, sin formularios, permisos ni aprobación previa.

---

## Cómo funciona

```
Relay Nostr (relay.damus.io, nostr.wine, nos.lol...)
    ↓  WebSocket NIP-01
relay-pool.js  →  app.js  →  render en pantalla
```

Al cargar la página, `relay-pool.js` abre conexiones WebSocket a los relays configurados en `data/config.json` y suscribe a eventos `kind:30402`, `kind:1`, `kind:30023`, `kind:31922` y `kind:31923` con los tags comunitarios configurados (`#plazap2p`, `#plazap2p-evento`, etc.). Las publicaciones llegan en tiempo real y se renderizan directamente sin pasar por ningún servidor nuestro.

Si el mantenedor configura una cuenta Nostr madre y publica una lista NIP-51 (`kind:30003`), la app la lee primero y muestra los anuncios curados. Si no, el fallback muestra cualquier evento con el tag — modo totalmente abierto.

---

## Estructura del proyecto

```
plazap2p-v3/
├── index.html              # SPA — 8 tabs, tema cyberpunk dark
├── manifest.json           # PWA (instalable en móvil y escritorio)
├── sw.js                   # Service Worker cache-first
├── robots.txt
├── sitemap.xml
├── css/
│   └── style.css           # Tema cyberpunk (heredado de V2, extendido)
├── js/
│   ├── app.js              # Lógica principal: Nostr + JSON estáticos
│   ├── nostr.js            # Bech32 / NIP-19 sin dependencias externas
│   ├── relay-pool.js       # WebSocket pool con reconexión automática
│   ├── btc-stats.js        # Precio BTC en tiempo real
│   ├── btc-chart.js        # Gráfico de precio
│   └── converter.js        # Conversor BTC / sats / fiat
├── data/
│   ├── config.json         # Relays, maintainer_pubkey, naddr lista curada
│   ├── comunidades.json
│   ├── herramientas.json   # 34+ herramientas Bitcoin
│   └── multimedia.json
├── icons/
└── .github/
    └── ISSUE_TEMPLATE/     # plantillas para contribuciones al JSON
        ├── comunidad.yml
        ├── herramienta.yml
        └── multimedia.yml
```

---

## Despliegue propio (fork)

```bash
# 1. Fork este repositorio en GitHub

# 2. Activa GitHub Pages
# Settings → Pages → Deploy from branch: main / root

# 3. Edita data/config.json con tus relays preferidos
# Opcional: añade tu maintainer_pubkey (hex) para listas curadas NIP-51

# 4. Actualiza las URLs con tu dominio
# index.html (canonical, og:url, og:image), robots.txt, sitemap.xml
```

No hay secrets, no hay tokens, no hay KV, no hay Functions. Es HTML estático que habla WebSocket. Si sabes activar GitHub Pages, sabes desplegar esto.

---

## Contribuir contenido estático

Los tabs de Comunidades, Herramientas y Multimedia se actualizan mediante **GitHub Issues**. Sin código, sin PRs, solo rellena el formulario:

- [Proponer una Comunidad](.github/ISSUE_TEMPLATE/comunidad.yml)
- [Proponer una Herramienta](.github/ISSUE_TEMPLATE/herramienta.yml)
- [Proponer contenido Multimedia](.github/ISSUE_TEMPLATE/multimedia.yml)

Los eventos ya no requieren iteraciones en el repositorio: publícalos como eventos de calendario Nostr NIP-52 (`kind:31922` o `kind:31923`) con `#plazap2p`.

Los JSONs curados en [`data/`](data/) se actualizan manualmente tras revisar cada propuesta.

---

## Tecnologías

- **HTML / CSS / JavaScript** puro — sin frameworks, sin npm, sin build step
- **Nostr** (NIP-01, NIP-19, NIP-51, NIP-99) — protocolo de datos
- **GitHub Pages** — hosting estático gratuito
- **WebSocket** — conexión directa a relays públicos

---

## Apoya el proyecto

PlazaP2P no tiene inversores, no tiene modelo de negocio y no tiene publicidad. Existe porque alguien cree que vale la pena tener una herramienta abierta para economía circular Bitcoin. Si también te resulta útil, hay varias formas elegantes de sostenerlo:

**Usa y comparte**
La forma más valiosa de apoyar este proyecto es usarlo: publica tus anuncios con `#plazap2p`, menciona la herramienta en tu comunidad local, recomiéndala a negocios que aceptan Bitcoin. Una plaza vacía no sirve de nada; una plaza viva se retroalimenta.

**Contribuye datos**
Si conoces una comunidad, una herramienta o un recurso multimedia que debería estar aquí, [abre un Issue](../../issues/new/choose). Si quieres anunciar un evento, publícalo en Nostr con `#plazap2p-evento` para evitar iteraciones en el repositorio.

**Haz fork y levanta tu instancia**
Adapta PlazaP2P a tu región, a tu comunidad o a tu caso de uso. El código es MIT — úsalo, modifícalo, mejóralo. Si introduces mejoras interesantes, un PR es bienvenido.

**Zap al mantenimiento** ⚡  
Si PlazaP2P te ayuda a encontrar comunidad, mover economía circular o publicar sin intermediarios, puedes apoyar su mantenimiento con Bitcoin o Lightning. El proyecto seguirá siendo abierto y gratuito; tu aporte ayuda a que siga vivo, cuidado y disponible.

> ⚡ `wildbobcat25@primal.net`  
> Nostr: `npub1ue6zpfsyy50xj8ht2kzg0xm84e87gat5nwwjtw8d72wch9w0h4rq8jrjvr`

*Sin suscripciones, sin mínimos y sin ventajas ocultas. Gracias por apoyar herramientas abiertas, útiles y sin intermediarios.*

---

## Licencia

MIT — libre para usar, modificar y redistribuir manteniendo el aviso de copyright.

---

*Economía circular P2P · Nostr · Sin intermediarios · Sin comisiones · Código abierto*
