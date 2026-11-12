// mapa.js — pestaña Mapa: comunidades, eventos, puntos de venta, anuncios con
// zona y comercios de BTC Map, cada grupo en su capa con interruptor.
//
// Leaflet (js/vendor/leaflet, BSD-2) se carga solo al abrir la pestaña. El
// fondo son las teselas de OpenStreetMap. La posición del usuario solo se usa
// para centrar el mapa en su navegador: no se publica ni se envía a nadie
// (salvo la búsqueda de comercios cercanos a BTC Map, si esa capa está encendida,
// que recibe el centro del mapa, no la posición).

import { LAYERS, directionsLinks, btcmapPoints, btcmapSearchUrl } from './map-data.js'

const LAYER_COLORS = {
  comunidades: '#f7931a', eventos: '#bf5af2', comercios: '#30d158', anuncios: '#0a84ff', btcmap: '#ffd60a',
}
const PREFS_KEY = 'plazap2p_mapa_capas'
const SPAIN = { center: [40.2, -3.7], zoom: 6 }
const BTCMAP_MIN_ZOOM = 11

let L = null
let map = null
let groups = {}
let getPoints = () => []
let btcmapCache = new Map()
let btcmapTimer = null

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null')
    if (raw && typeof raw === 'object') return raw
  } catch { /* sin almacenamiento: valores por defecto */ }
  return Object.fromEntries(LAYERS.map(l => [l.id, l.defaultOn]))
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(Object.fromEntries(LAYERS.map(l => [l.id, map.hasLayer(groups[l.id])]))))
  } catch { /* no pasa nada */ }
}

async function ensureLeaflet() {
  if (L) return L
  if (!document.getElementById('leaflet-css')) {
    const link = document.createElement('link')
    link.id = 'leaflet-css'
    link.rel = 'stylesheet'
    link.href = 'js/vendor/leaflet/leaflet.css'
    document.head.appendChild(link)
  }
  L = await import('./vendor/leaflet/leaflet-src.esm.js')
  return L
}

function el(tag, attrs = {}, text = '') {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  if (text) node.textContent = text
  return node
}

function safeLink(url, label) {
  // Solo http(s) o geo: lo que llega de relays o APIs nunca se pone sin mirar.
  if (!/^(https?:|geo:)/i.test(url)) return null
  return el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, label)
}

/** Contenido del globo de un punto: todo con textContent, nada de HTML ajeno. */
function popupFor(p) {
  const box = el('div', { class: 'map-popup' })
  box.appendChild(el('strong', {}, p.title || ''))
  if (p.subtitle) box.appendChild(el('div', { class: 'map-popup-sub' }, p.subtitle))
  if (!p.exact) box.appendChild(el('div', { class: 'map-popup-note' }, 'Zona aproximada (unos kilómetros), no la dirección exacta.'))
  const actions = el('div', { class: 'map-popup-actions' })
  if (p.naddr) {
    const open = el('a', { href: `./#/anuncio/${p.naddr}` }, p.layer === 'eventos' ? 'Ver evento' : 'Ver anuncio')
    open.addEventListener('click', ev => {
      if (p.layer === 'eventos') return
      ev.preventDefault()
      window.openModal?.(p.naddr)
    })
    actions.appendChild(open)
  }
  for (const l of p.links || []) {
    const a = safeLink(l.url, l.label)
    if (a) actions.appendChild(a)
  }
  if (p.exact) {
    const d = directionsLinks(p.lat, p.lon, p.title)
    if (d) {
      const row = el('div', { class: 'map-popup-directions' }, '🧭 Cómo llegar: ')
      for (const [url, label] of [[d.geo, 'App de mapas'], [d.google, 'Google Maps'], [d.osm, 'OpenStreetMap']]) {
        const a = safeLink(url, label)
        if (a) { row.appendChild(a); row.appendChild(document.createTextNode(' ')) }
      }
      actions.appendChild(row)
    }
  }
  if (actions.childNodes.length) box.appendChild(actions)
  return box
}

function drawPoint(p) {
  const color = LAYER_COLORS[p.layer] || '#888'
  let shape
  if (p.exact) {
    shape = L.circleMarker([p.lat, p.lon], { radius: 7, color: '#111', weight: 1, fillColor: color, fillOpacity: 0.95 })
  } else {
    // Área del tamaño de la celda (mín. 1,5 km) en vez de un punto que parezca una dirección.
    const meters = Math.max(1500, p.latErr ? p.latErr * 111_000 : 2500)
    shape = L.circle([p.lat, p.lon], { radius: meters, color, weight: 1, fillColor: color, fillOpacity: 0.18 })
  }
  shape.bindPopup(() => popupFor(p))
  shape.bindTooltip(p.title || '', { direction: 'top' })
  return shape
}

/** Vuelve a pintar las capas locales (no BTC Map) con los datos de ahora. */
export function refreshMap() {
  if (!map) return
  for (const id of ['comunidades', 'eventos', 'comercios', 'anuncios']) groups[id].clearLayers()
  for (const p of getPoints()) {
    if (groups[p.layer] && p.layer !== 'btcmap') groups[p.layer].addLayer(drawPoint(p))
  }
  updateStatus()
}

function updateStatus() {
  const status = document.getElementById('map-status')
  if (!status || !map) return
  const counts = LAYERS.map(l => `${l.label.split(' ')[0]} ${groups[l.id].getLayers().length}`).join(' · ')
  const hint = map.hasLayer(groups.btcmap) && map.getZoom() < BTCMAP_MIN_ZOOM
    ? ' — acércate para ver los comercios de BTC Map' : ''
  status.textContent = counts + hint
}

async function loadBtcmap() {
  if (!map || !map.hasLayer(groups.btcmap)) return updateStatus()
  if (map.getZoom() < BTCMAP_MIN_ZOOM) { groups.btcmap.clearLayers(); return updateStatus() }
  const c = map.getCenter()
  const bounds = map.getBounds()
  const radiusKm = c.distanceTo(bounds.getNorthEast()) / 1000
  const url = btcmapSearchUrl(c.lat, c.lng, radiusKm)
  try {
    let points = btcmapCache.get(url)
    if (!points) {
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      points = btcmapPoints(await res.json())
      btcmapCache.set(url, points)
      if (btcmapCache.size > 30) btcmapCache.delete(btcmapCache.keys().next().value)
    }
    groups.btcmap.clearLayers()
    for (const p of points) groups.btcmap.addLayer(drawPoint(p))
  } catch {
    const status = document.getElementById('map-status')
    if (status) status.textContent = 'No se pudieron cargar los comercios de BTC Map. Prueba más tarde.'
    return
  }
  updateStatus()
}

function scheduleBtcmap() {
  clearTimeout(btcmapTimer)
  btcmapTimer = setTimeout(loadBtcmap, 500)
}

function addLocateButton() {
  const Locate = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const btn = el('button', { type: 'button', class: 'map-locate-btn', title: 'Centrar en mi ubicación', 'aria-label': 'Centrar en mi ubicación' }, '📍')
      L.DomEvent.disableClickPropagation(btn)
      btn.addEventListener('click', () => {
        if (!navigator.geolocation) return
        navigator.geolocation.getCurrentPosition(
          pos => map.setView([pos.coords.latitude, pos.coords.longitude], 13),
          () => { const s = document.getElementById('map-status'); if (s) s.textContent = 'No se pudo obtener tu ubicación.' },
          { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 }
        )
      })
      return btn
    },
  })
  map.addControl(new Locate())
}

/**
 * Abre (o refresca) el mapa en `container`. `pointsProvider` devuelve los
 * puntos locales (comunidades, eventos, anuncios) en el momento de llamarlo.
 */
export async function showMap(container, pointsProvider) {
  getPoints = pointsProvider
  if (map) { map.invalidateSize(); refreshMap(); return }
  await ensureLeaflet()
  map = L.map(container, { center: SPAIN.center, zoom: SPAIN.zoom, worldCopyJump: true })
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
  }).addTo(map)
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>')

  const prefs = loadPrefs()
  const overlays = {}
  for (const l of LAYERS) {
    groups[l.id] = L.layerGroup()
    overlays[l.label] = groups[l.id]
    if (prefs[l.id] ?? l.defaultOn) groups[l.id].addTo(map)
  }
  // En pantallas estrechas el panel de capas empieza plegado para no tapar el mapa.
  L.control.layers(null, overlays, { collapsed: window.innerWidth < 700 }).addTo(map)
  addLocateButton()
  map.on('overlayadd overlayremove', () => { savePrefs(); scheduleBtcmap() })
  map.on('moveend', scheduleBtcmap)
  refreshMap()
  scheduleBtcmap()
}
