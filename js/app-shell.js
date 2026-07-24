// app-shell.js — Barra móvil de 5 destinos (Plaza · Explorar · Publicar · Actividad · Perfil)
// MOB-003 (ver txt/PLAN_VERIFICACION_APP_PURA.md §19). Agrupa las 16 pestañas
// existentes sin sustituir la navegación de escritorio (.main-nav) ni el
// cambio de tab ya implementado en app.js — reutiliza window.switchTab().
//
// "Actividad" enlaza a publicar.html (Mis anuncios) porque ese flujo aún no
// está portado a index.html — no se simula una función que no existe.

export const GROUPS = {
  plaza:     { tabs: ['mercado', 'intercambio', 'directorio', 'vendedores', 'conversor'], default: 'mercado' },
  explorar:  { tabs: ['feed', 'articulos', 'eventos', 'comunidades', 'herramientas', 'multimedia', 'bitcoin'], default: 'feed' },
  publicar:  { tabs: ['publicar'], default: 'publicar' },
  actividad: { external: 'publicar.html' },
  perfil:    { tabs: ['acerca', 'nostr', 'relays'], default: 'acerca' },
};

const CHIP_LABELS = {
  mercado: '🛒 Mercado', intercambio: '🔄 Intercambio', directorio: '📒 Directorio',
  vendedores: '👥 Vendedores', conversor: '💱 Conversor',
  feed: '💬 Feed', articulos: '📄 Artículos', eventos: '📅 Eventos', comunidades: '🏘 Comunidades',
  herramientas: '🔧 Herramientas', multimedia: '🎙 Multimedia', bitcoin: '₿ Bitcoin',
  acerca: '📋 Acerca', nostr: '⚡ Nostr', relays: '🔗 Relays',
};

const ALL_TABS = Object.values(GROUPS).flatMap(g => g.tabs || []);

export function tabToDest(tab) {
  for (const [dest, g] of Object.entries(GROUPS)) {
    if (g.tabs && g.tabs.includes(tab)) return dest;
  }
  return null;
}

function setActiveDest(dest) {
  document.querySelectorAll('.mbn-btn').forEach(btn => {
    const isActive = btn.dataset.dest === dest;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
}

function renderChips(dest, activeTab) {
  const wrap = document.getElementById('mbn-chips');
  if (!wrap) return;
  const g = GROUPS[dest];
  if (!g || !g.tabs || g.tabs.length < 2) { wrap.hidden = true; wrap.innerHTML = ''; return; }
  wrap.innerHTML = g.tabs.map(t =>
    `<button class="mbn-chip${t === activeTab ? ' active' : ''}" data-tab="${t}" type="button">${CHIP_LABELS[t] || t}</button>`
  ).join('');
  wrap.hidden = false;
}

function onShellNav(dest) {
  const g = GROUPS[dest];
  if (!g) return;
  if (g.external) { window.location.href = g.external; return; }
  window.switchTab(g.default);
}

export function initAppShell() {
  const bar = document.getElementById('mobile-bottom-nav');
  if (!bar) return; // shell no presente en esta página (p.ej. publicar.html)

  bar.querySelectorAll('.mbn-btn').forEach(btn => {
    btn.addEventListener('click', () => onShellNav(btn.dataset.dest));
  });

  document.getElementById('mbn-chips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.mbn-chip');
    if (!chip) return;
    window.switchTab(chip.dataset.tab);
  });

  // Envuelve el switchTab ya definido en app.js: mantiene el shell sincronizado
  // sin reimplementar el cambio de tab (funciona igual si el usuario navega
  // desde la barra de escritorio, el footer o cualquier enlace interno).
  const original = window.switchTab;
  if (typeof original === 'function') {
    window.switchTab = function (tab, options) {
      original(tab, options);
      const dest = tabToDest(tab);
      if (dest) { setActiveDest(dest); renderChips(dest, tab); }
    };
  }

  // Estado inicial: misma validación que initTabFromUrl() en app.js, sin
  // depender de si ese init (dentro de un init() async) ya corrió o no.
  const urlTab = new URLSearchParams(window.location.search).get('tab');
  const initialTab = ALL_TABS.includes(urlTab) ? urlTab : 'mercado';
  const initialDest = tabToDest(initialTab) || 'plaza';
  setActiveDest(initialDest);
  renderChips(initialDest, initialTab);
}
