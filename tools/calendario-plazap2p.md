# Calendario «PlazaP2P» (NIP-52, kind 31924) — tarea del mantenedor

Desde F7-07, cada evento que se publica desde la web o la app Android lleva esta etiqueta:

```
["a", "31924:e67420a604251e691eeb5584879b67ae4fe475749b9d25b8edf29d8b95cfbd46:plazap2p-eventos"]
```

En NIP-52 eso significa «pido entrar en este calendario». **El evento no entra solo:** el calendario
es del mantenedor y solo incluye los eventos que él añada. Mientras el calendario no exista, la
etiqueta no tiene ningún efecto.

Clientes de calendario Nostr como Flockstr, Meetstr o Plektos enseñan los calendarios y sus eventos.
Con este calendario, quien lo siga verá las quedadas de PlazaP2P en esas apps.

## 1. Crear el calendario (una vez)

Evento sin firmar (sustituir `created_at` por la hora actual):

```json
{
  "kind": 31924,
  "created_at": 0,
  "tags": [
    ["d", "plazap2p-eventos"],
    ["title", "PlazaP2P — eventos y quedadas"],
    ["summary", "Eventos de la comunidad PlazaP2P: meetups, talleres y quedadas Bitcoin."],
    ["t", "plazap2p"]
  ],
  "content": "Eventos publicados desde PlazaP2P y revisados por el mantenedor."
}
```

Firmar con la clave del mantenedor y publicar en los relays por defecto (como en
`tools/publicar-config.md`):

```
nak event --sec <nsec o bunker://…> -k 31924 -d plazap2p-eventos \
  -t title="PlazaP2P — eventos y quedadas" \
  -t summary="Eventos de la comunidad PlazaP2P: meetups, talleres y quedadas Bitcoin." \
  -t t=plazap2p \
  -c "Eventos publicados desde PlazaP2P y revisados por el mantenedor." \
  wss://nos.lol wss://relay.primal.net wss://relay.damus.io wss://nostr.bitcoiner.social wss://relay.nostr.net wss://nostr.mom
```

## 2. Ver qué eventos piden entrar

```
nak req -k 31922 -k 31923 \
  -t a=31924:e67420a604251e691eeb5584879b67ae4fe475749b9d25b8edf29d8b95cfbd46:plazap2p-eventos \
  wss://nos.lol wss://relay.primal.net
```

## 3. Añadir eventos aprobados

El calendario es reemplazable: cada vez se publica **entero**, con un `a` por evento aprobado
(`<kind>:<pubkey del autor>:<d del evento>`). Añadir eventos nuevos sin perder los anteriores:

```
nak event --sec <nsec o bunker://…> -k 31924 -d plazap2p-eventos \
  -t title="PlazaP2P — eventos y quedadas" -t t=plazap2p \
  -t a=31923:<pubkey autor>:<d evento 1> \
  -t a=31922:<pubkey autor>:<d evento 2> \
  -c "Eventos publicados desde PlazaP2P y revisados por el mantenedor." \
  wss://nos.lol wss://relay.primal.net wss://relay.damus.io wss://nostr.bitcoiner.social wss://relay.nostr.net wss://nostr.mom
```

Comprobar: `nak req -k 31924 -a e67420a6…bd46 -t d=plazap2p-eventos wss://nos.lol`.

Los eventos pasados se pueden quitar del calendario al republicarlo; no hace falta borrarlos.
