# Screenshots para el manifest de la PWA

Con capturas, Chrome en Android muestra un prompt de instalación enriquecido
(«rich install UI») con vista previa de la app. Sin ellas funciona el prompt
básico. Pasos para añadirlas:

## 1. Tomar las capturas

En Chrome de escritorio con la app servida (GitHub Pages o servidor local):

1. Abrir DevTools → *Toggle device toolbar* (Ctrl+Shift+M).
2. Elegir el dispositivo **Pixel 7** (o dimensiones 412×915, DPR 2.6 ≈ 1080×2340 px reales).
3. Navegar a cada pantalla y usar el menú `⋮` de DevTools → **Capture screenshot**:
   - Tab **Mercado** (`/?tab=mercado`) → guardar como `mercado.png`
   - Tab **Bitcoin** (`/?tab=bitcoin`) → guardar como `bitcoin.png`
   - **publicar.html** (pantalla de selección de tipo) → guardar como `publicar.png`
4. Guardar los tres PNG en esta carpeta (`screenshots/`).

Requisitos de Chrome: mismas dimensiones en las 3 (relación entre 1:2.3 y 2.3:1),
mínimo 320 px, máximo 3840 px por lado.

## 2. Añadir al manifest.json

Pegar esta clave en `manifest.json` (al nivel de `"icons"`):

```json
"screenshots": [
  {
    "src": "screenshots/mercado.png",
    "sizes": "1080x2340",
    "type": "image/png",
    "form_factor": "narrow",
    "label": "Mercado P2P — anuncios en vivo desde Nostr"
  },
  {
    "src": "screenshots/bitcoin.png",
    "sizes": "1080x2340",
    "type": "image/png",
    "form_factor": "narrow",
    "label": "Panel Bitcoin — precio, red y mercado en tiempo real"
  },
  {
    "src": "screenshots/publicar.png",
    "sizes": "1080x2340",
    "type": "image/png",
    "form_factor": "narrow",
    "label": "Publica firmando con tu propia clave (NIP-07 / Amber)"
  }
]
```

Ajustar `"sizes"` al tamaño real de los PNG generados.

## Notas

- **No** añadir los PNG al precache de `sw.js`: solo los usa el instalador
  del navegador y engordarían la caché ~500 KB.
- Verificación: DevTools → Application → Manifest → sección *Screenshots*
  debe mostrarlas sin warnings.
