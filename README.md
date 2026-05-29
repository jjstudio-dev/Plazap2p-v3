# PlazaP2P — Ventana Comunitaria Nostr

> Vista pública de eventos en la red Nostr. Bitcoin, economía circular y actividad P2P — sin registro, sin intermediarios, sin custodiar datos.

[![GitHub Pages](https://img.shields.io/badge/desplegado-GitHub%20Pages-0a0a0a?style=flat&logo=github)](https://jjstudio-dev.github.io/plazap2p/)
[![Licencia MIT](https://img.shields.io/badge/licencia-MIT-f7931a?style=flat)](LICENSE)
[![Nostr](https://img.shields.io/badge/protocolo-Nostr-8b5cf6?style=flat)](https://nostr.com)

---

## ¿Qué es PlazaP2P?

PlazaP2P es un **reflejo de solo lectura** de la red Nostr. Muestra en tiempo real anuncios, posts y artículos publicados por sus autores en relays públicos con el tag `#plazap2p`.

**No es** una plataforma, marketplace ni intermediario. No almacena datos, no tiene servidor propio, no requiere cuenta.

## Características

- **Mercado en tiempo real** — eventos `kind:30402` (NIP-99) con tag `#plazap2p`
- **Feed** — posts `kind:1` de la comunidad
- **Artículos** — contenido largo `kind:30023`
- **Eventos, Comunidades, Herramientas, Multimedia** — directorios curados vía JSON en este repositorio
- **Conversor BTC/sats/fiat** con precio en tiempo real
- **PWA** — instalable en móvil y escritorio
- **Zero dependencias externas** — Vanilla JS ES Modules

## Cómo publicar un anuncio

No publiques directamente aquí. Usa un cliente Nostr compatible con NIP-99:

| Cliente | Plataforma | Tipo |
|---|---|---|
| [Plebeian Market](https://plebeian.market) | Web | Anuncios `kind:30402` |
| [Shopstr](https://shopstr.store) | Web | Marketplace Lightning |
| [Primal](https://primal.net) | Web / iOS / Android | Posts `kind:1` |
| [Amethyst](https://amethyst.social) | Android | Todos los NIPs |
| [YakiHonne](https://yakihonne.com) | Web | Artículos `kind:30023` |

Incluye el tag `#plazap2p` en tu publicación para que aparezca en esta vista.

## Contribuir contenido estático

Los tabs de Eventos, Comunidades, Herramientas y Multimedia se gestionan mediante **GitHub Issues**. Usa las plantillas disponibles:

- [Proponer un Evento](.github/ISSUE_TEMPLATE/evento.yml)
- [Proponer una Comunidad](.github/ISSUE_TEMPLATE/comunidad.yml)
- [Proponer una Herramienta](.github/ISSUE_TEMPLATE/herramienta.yml)
- [Proponer contenido Multimedia](.github/ISSUE_TEMPLATE/multimedia.yml)

Los JSONs en [`data/`](data/) se actualizan manualmente tras revisar cada propuesta.

## Despliegue propio (fork)

1. Haz fork de este repositorio
2. Activa **GitHub Pages** desde `Settings → Pages → Deploy from branch: main / root`
3. Edita [`data/config.json`](data/config.json):
   - Añade tus relays preferidos en `relays`
   - Opcional: pon tu `maintainer_pubkey` (hex) para publicar listas curadas NIP-51
4. Actualiza las URLs en `index.html` (canonical, og:url), `robots.txt` y `sitemap.xml` con tu dominio

## Estructura del proyecto

```
plazap2p/
├── index.html          # SPA principal
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker (cache-first)
├── robots.txt
├── sitemap.xml
├── css/
│   └── style.css       # Tema cyberpunk dark
├── js/
│   ├── app.js          # Lógica principal
│   ├── nostr.js        # Bech32 / NIP-19 sin dependencias
│   ├── relay-pool.js   # WebSocket pool NIP-01
│   ├── btc-stats.js    # Precio BTC en tiempo real
│   ├── btc-chart.js    # Gráfico de precio
│   └── converter.js    # Conversor BTC/sats/fiat
├── data/
│   ├── config.json     # Relays, pubkey, canales
│   ├── eventos.json
│   ├── comunidades.json
│   ├── herramientas.json
│   └── multimedia.json
├── icons/
└── .github/
    └── ISSUE_TEMPLATE/ # Plantillas para contribuciones
```

## Licencia

MIT © [jjstudio-dev](https://github.com/jjstudio-dev) — libre para usar, modificar y redistribuir **manteniendo el aviso de copyright**.
