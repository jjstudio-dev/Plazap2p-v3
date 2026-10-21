# Publicar la configuración y el directorio firmados (PZ-F1-01 / PZ-F8-02)

Desde la app Android 1.1.0 y la web r73, la configuración (`data/config.json`) y el directorio curado
(`comunidades.json`, `herramientas.json`, `multimedia.json`) solo cuentan del todo si los firma el
mantenedor como eventos Nostr **kind 30078** (NIP-78) con su clave:

| `d` | Archivo |
|---|---|
| `plazap2p-config` | `data/config.json` |
| `plazap2p-comunidades` | `data/comunidades.json` |
| `plazap2p-herramientas` | `data/herramientas.json` |
| `plazap2p-multimedia` | `data/multimedia.json` |

Autor obligatorio: `e67420a604251e691eeb5584879b67ae4fe475749b9d25b8edf29d8b95cfbd46` (va dentro del
APK y de `js/signed-config.js`; la propia configuración no puede cambiarlo).

## Qué pasa sin firma
- **App:** se usan los relays del JSON, pero el servidor de fotos, los moderadores, las instancias
  Mostro de confianza y los enlaces de soporte/donación son los incluidos en la app. El directorio se
  enseña con el aviso «no está firmada por el mantenedor».
- Si una vez llegó contenido firmado, un JSON de GitHub **distinto** de ese ya no lo sustituye
  (puede venir de quien controle la cuenta, no del mantenedor). Para cambiar algo: publicar un evento
  nuevo firmado.
- **Web:** el `config.json` servido solo aplica `intercambio.trustedMostroInstances` si es idéntico al
  último contenido firmado que vio el navegador.

## Procedimiento (cada vez que cambie un archivo de `data/`)
1. Editar el JSON y subirlo a GitHub como siempre (sirve de respaldo y para arrancar).
2. Esperar a que GitHub sirva la versión nueva y preparar los eventos **desde GitHub**:
   `node tools/preparar-eventos-firmados.mjs --desde-github > eventos-sin-firmar.json`
3. El `content` debe ser el archivo **tal como lo sirve GitHub**, byte a byte (hoy lo sirve con
   finales de línea LF; la copia del disco puede llevar CRLF). Por eso se descarga de ahí y no se lee del disco.
4. Firmar cada evento con la clave del mantenedor, sin cambiar `content` ni un byte:
   - con **nak** (firma los eventos tal cual, `content` incluido; no usar `-c "$(…)"`, que quita el salto de
     línea final): `jq -c '.[]' eventos-sin-firmar.json | nak event --sec <nsec o bunker://…> wss://nos.lol wss://relay.primal.net wss://relay.damus.io wss://nostr.bitcoiner.social wss://relay.nostr.net wss://nostr.mom`
   - con **Amber** (clave en el móvil): pegar el JSON sin firmar en un cliente que firme eventos
     arbitrarios vía NIP-55/NIP-46 (p. ej. nak con `--sec bunker://…` emparejado con Amber).
5. Comprobar: `nak req -k 30078 -a e67420a6…bd46 -t d=plazap2p-config wss://nos.lol` devuelve el
   evento y su `content` es idéntico al archivo (`diff <(nak req … | jq -j .content) <(curl -s https://raw.githubusercontent.com/jjstudio-dev/Plazap2p-v3/main/data/config.json)`).
6. Publicar en **todos** los relays por defecto (arriba); la app consulta los de lectura del usuario.

## Comprobación en la app
Configuración › «Firmada por el mantenedor de PlazaP2P». Si dice «Sin firma del mantenedor», el evento
no llegó (relays) o el `content` no es el del archivo.
