# Relays y mercados Nostr — revisión del 19-nov-2026

Consulta de solo lectura (NIP-11 + REQ) contra los relays de PlazaP2P y los que usan Shopstr, Plebeian Market y Mostro.

## Relays

| Relay | Responde | Notas |
|---|---|---|
| `wss://nos.lol` | sí (230 ms) | Mucho kind 30402 (Shopstr) y 38383 (Mostro). Guarda eventos de claves nuevas |
| `wss://relay.primal.net` | sí (2,7 s) | Muy completo, pero no guarda eventos de claves nuevas sin historial |
| `wss://relay.damus.io` | sí | Igual que Primal; además limita la lectura por IP |
| `wss://nostr.bitcoiner.social` | sí (3 s) | Poco contenido; tampoco guarda claves nuevas |
| `wss://relay.nostr.net` | sí (2,8 s) | El que más eventos `#plazap2p` tiene (92 %) |
| `wss://nostr.mom` | sí (0,6 s) | Guarda eventos de claves nuevas |
| `wss://offchain.pub` | sí (3 s) | **Añadido**. Abierto, mucho 30402 y 38383 |
| `wss://relay.ditto.pub` | sí (3 s) | Muy completo (incluye QvaPay). Candidato si hace falta otro |
| `wss://relay.plebeian.market` | sí (2,7 s) | Abierto, sin autenticación |
| `wss://relay.mostro.network` | sí (0,7 s) | Mostro y bastante 30402 |
| `wss://relay.snort.social` | sí | Es «memlay»: guarda en memoria y lo pierde. Sigue fuera (D6) |

## Mercados

| Plataforma | Qué publica | En PlazaP2P |
|---|---|---|
| Shopstr | kind 30402 con `t shopstr` | **Se lee** como mercado externo («vía Shopstr»). Web nueva: `shopstr.market` (`shopstr.store` caducó y está a la venta) |
| Plebeian Market | kind 30402 sin etiqueta `t` propia, y NIP-15 (30017/30018) | No: no se puede pedir por separado a los relays |
| Mostro y otros P2P | kind 38383 (`y=mostro`, `robosats`, `hodlhodl`…) | Sí, en Intercambio |
| QvaPay | kind 35353 con `y=qvapay`, en QUSD (saldo interno) | No, a propósito: empresa con comisiones, no es P2P real |

## Filtro de origen

El Mercado tiene un desplegable de origen: **Todos los mercados**, **Solo PlazaP2P** u **Otros mercados**. La elección se recuerda (`plazap2p_source`). Un anuncio con etiquetas `plazap2p*` cuenta siempre como de PlazaP2P, aunque lleve también `shopstr`.

## Visibilidad

El 19-nov-2026 los únicos eventos `#plazap2p` de la red eran pruebas ocultas (`hidden_pubkeys`): ningún anuncio real. Primal, Damus y bitcoiner.social no guardan eventos de claves sin perfil (kind 0), así que conviene publicar el perfil antes del primer anuncio.

Tampoco hay configuración firmada del mantenedor (kind 30078, `d=plazap2p-config`) en los relays: la web y la app usan el `config.json` de GitHub, sin sus campos sensibles.
