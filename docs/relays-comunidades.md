# Relays de las comunidades Bitcoin de España

Generado el 2026-11-12 con `node tools/verificar-relays-comunidades.mjs` (solo lectura). Fuente de las comunidades: [2140meetups.com](https://2140meetups.com/comunidades/).

## Comunidades con cuenta Nostr

| Comunidad | Ciudad | Perfil | NIP-05 | Relays en su lista | Última nota |
|---|---|---|---|---|---|
| Alicante Bitcoin Plebs 🍊💊 | Alicante | Alicante Bitcoin Plebs 🍊💊 | — | 5 | hace 172 días |
| Alkarria BTC | Guadalajara | AlkarriaBTC | — | 7 | hace 322 días |
| Barcelona Bitcoin Only | Barcelona | bitcoinbarcelona@primal.net | bitcoinbarcelona@primal.net | 7 | hace 101 días |
| Bitcanario | Las Palmas de Gran Canaria | Bitcanario | — | sin lista | hace 176 días |
| Bitcoin Tuesday | Madrid | no encontrado | — | sin lista | hace 244 días |
| BTC CADIZ | San Fernando | BTC_CADIZ | — | sin lista | hace 549 días |
| León Bitcoin 2140 | León | no encontrado | — | sin lista | — |
| Málaga 2140 | Málaga | no encontrado | — | 3 | hace 19 días |
| Pontevedra _2140_ | Pontevedra | Pontevedra_2140 | valor_pontevedra_2140@getalby.com | 3 | hace 15 días |
| SanviBitcoin | Sant Vicenç dels Horts | no encontrado | — | sin lista | — |
| Vagabonds | Los Abrigos | Undervan | — | 9 | hace 27 días |

## Relays que usan

«No responde» puede ser momentáneo: varios relays limitan las conexiones seguidas desde una misma IP. Un relay que falla en una pasada y responde en otra está operativo.

| Relay | Comunidades | Ya en PlazaP2P | Responde | Pide autenticación | De pago | Escritura restringida | Software |
|---|---|---|---|---|---|---|---|
| `wss://nos.lol` | 6 | sí | sí (374 ms) | no | no | no | — |
| `wss://nostr.bitcoiner.social` | 4 | sí | sí (734 ms) | no | no | no | strfry.git |
| `wss://relay.damus.io` | 3 | sí | no (error de conexión) | no | no | no | strfry.git |
| `wss://eden.nostr.land` | 3 | no | sí (243 ms) | sí | sí | no | NFDB |
| `wss://nostr.wine` | 2 | no | sí (275 ms) | no | sí | sí | nostr.wine |
| `wss://nostr.mom` | 2 | sí | sí (289 ms) | no | no | no | strfry.git |
| `wss://nostr.256k1.dev` | 1 | no | no (error de conexión) | no | no | no | — |
| `wss://relay.jabato.space` | 1 | no | sí (1125 ms) | no | no | no | nostr-rs-relay |
| `wss://relay.nostr.band` | 1 | no | no (error de conexión) | no | no | no | — |
| `wss://nostr-01.yakihonne.com` | 1 | no | sí (678 ms) | no | no | no | strfry.git |
| `wss://nostr-pub.wellorder.net` | 1 | no | no (error de conexión) | no | no | no | — |
| `wss://relay.kilombino.com` | 1 | no | sí (104 ms) | no | no | no | strfry.git |
| `wss://relay.minibolt.info` | 1 | no | sí (152 ms) | no | no | no | nostr-rs-relay |
| `wss://frens.nostr1.com` | 1 | no | sí (238 ms) | no | no | no | strfry.git |
| `wss://soloco.nl` | 1 | no | sí (212 ms) | no | no | no | strfry.git |
| `wss://relay.snort.social` | 1 | no | sí (250 ms) | no | no | no | memlay |
| `wss://no.str.cr` | 1 | no | sí (743 ms) | no | no | no | strfry.git |
| `wss://slick.mjex.me` | 1 | no | sí (487 ms) | no | no | no | strfry.git |
| `wss://nostr-relay.derekross.me` | 1 | no | no (error de conexión) | no | no | no | — |
| `wss://nostr.ownscale.org` | 1 | no | no (error de conexión) | no | no | no | — |

## Candidatos para ampliar la red

Relays que no están ya en PlazaP2P, responden, no piden autenticación ni pago, no restringen la escritura y los usa más de una comunidad:

- Ninguno cumple todo. Ver la tabla de arriba.

Añadir uno es decisión del mantenedor: se pone en `data/config.json → relays` (o como relay solo de lectura) y se vuelve a firmar la configuración. Un relay nuevo solo amplía dónde se lee y se publica; cada evento sigue verificándose por su firma.
