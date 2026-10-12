# Pruebas en navegador real

`tests/*.test.mjs` prueba la lógica pura. Esto prueba lo que esas no pueden: las dos páginas funcionando de verdad en Chrome (pintado, clics, formularios, wallet, Service Worker), con relays, firmante, wallet y APIs **simulados dentro de la página**. No sale a la red ni mueve dinero.

```sh
node tests/browser/run.mjs              # todo (~3 min)
node tests/browser/run.mjs 06-wallet    # solo los archivos o pruebas cuyo nombre contenga ese texto
node tests/browser/run.mjs --shots dir  # dónde dejar las capturas (por defecto, carpeta temporal)
```

Requisitos: Node 22 o superior y Chrome o Edge instalado (o la variable `CHROME_PATH`). Sin dependencias npm. No forma parte del CI (`tests/*.test.mjs` no incluye esta carpeta).

| Archivo | Qué comprueba |
|---|---|
| `01-arranque` | Carga de las dos páginas, las 17 pestañas, móvil, enlaces `?tab=` y hash, estados de carga y vacío |
| `02-inyeccion` | Texto hostil desde relays, JSON de `data/`, configuración y caché local: nada se ejecuta |
| `03-relay-hostil` | Firmas falsas, tramas basura, versiones fuera de orden, relays que no contestan o rechazan |
| `04-almacenamiento` | Caché corrupta, almacenamiento lleno o bloqueado, anuncios que ya no existen, lista de ocultos |
| `05-publicar` | Los 7 tipos del asistente de ida y vuelta, validación, editar, duplicar, vendido, retirar, borradores |
| `06-wallet-zaps` | Conectar, recibir, pagar y zaps contra una wallet NWC simulada que cifra y firma de verdad |
| `07-pwa` | Arranque sin red, actualización de versión y tamaño de la caché del Service Worker |
| `08-apis-externas` | APIs de precios caídas, lentas, con JSON roto o con texto hostil |

## Piezas

- `harness.mjs` — servidor estático en `http://[::1]:<puerto>` (el único origen donde `index.html` deja registrar el Service Worker), arranque de Chrome y cliente CDP mínimo. Cada prueba abre su página en un contexto aislado.
- `page-stubs.js` — se inyecta antes que cualquier script de la app. Sustituye `WebSocket` por un relay simulado, `fetch` externo por rutas definidas en la prueba, y opcionalmente añade un firmante NIP-07 y una wallet NWC. Todo se configura con el objeto `scenario` que se pasa a `t.open()`.
- `fixtures.mjs` — eventos firmados de verdad (mismas claves de prueba que `tests/fixtures/events.mjs`).

## Añadir una prueba

Cada `*.spec.mjs` exporta `tests = [{ name, async run(t) { … } }]`. Dentro: `t.server()` levanta el repo, `t.open({ scenario })` abre una página, y `page.goto/click/fill/type/waitFor/evaluate` la manejan. `t.appErrors(page)` devuelve las excepciones y errores de consola de la app (sin el ruido de los recursos externos bloqueados).

Un fallo que se pueda reproducir con lógica pura va mejor en `tests/*.test.mjs`: es más rápido y sí corre en el CI.
