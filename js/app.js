import { encodeNaddr, hexToNpub, hexToNote, getTagValue, getTagValues } from './nostr.js';
import { RelayPool } from './relay-pool.js';

// ── Constants ──────────────────────────────────────────────────
const CACHE_KEY      = 'plazap2p_v3';
const CACHE_TTL      = 30 * 60 * 1000;
const PAGE_SIZE      = 12;
const SORT_PREF_KEY  = 'plazap2p_sort';
const ASSET_VERSION  = '23';

// ── State ──────────────────────────────────────────────────────
let config        = null;
let pool          = null;
let isInitialLoad = true;
let lastUpdated   = null;
let activeTab     = 'mercado';
let activeFilter   = 'all';
let activeLocation = 'all';
let searchQuery   = '';
let sortPrefs     = {};  // { [channelId]: 'newest' | 'oldest' }

const STATIC_TABS = new Set(['comunidades', 'herramientas', 'multimedia']);

const channels   = {};  // { [channelId]: Map<key, parsedItem> }
const limits     = {};  // { [channelId]: number }
const eoseCounts = {};  // { [channelId]: number } — relays that sent EOSE
const eoseSettled = {}; // { [channelId]: boolean } — UI already settled

// ── Bootstrap ──────────────────────────────────────────────────
async function init() {
  try {
    await loadConfig();
    for (const ch of config.channels) {
      channels[ch.id]    = new Map();
      limits[ch.id]      = PAGE_SIZE;
      eoseCounts[ch.id]  = 0;
      eoseSettled[ch.id] = false;
    }
    loadFromCache();
    loadSortPrefs();
    initPool();
    initUI();
    renderActiveChannel();
    updateAllBadges();
    showSkeletons(activeTab);
    isInitialLoad = true;
    subscribeAll();
    loadStaticData();
    setTimeout(() => { isInitialLoad = false; }, 6000);
    window._badgeInterval = setInterval(updateAllBadges, 30000);
  } catch (err) {
    console.error('PlazaP2P init error:', err);
  }
}

async function loadConfig() {
  try {
    const res = await fetch(versioned('data/config.json'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    config = await res.json();
  } catch (err) {
    console.error('[config] No se pudo cargar config.json, usando mínimos:', err);
    config = {
      community_tags: ['plazap2p'],
      relays: ['wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.damus.io'],
      channels: [
        { id: 'mercado',   kinds: [30402], label: 'Mercado',   icon: '🛒' },
        { id: 'feed',      kinds: [1],     label: 'Feed',      icon: '💬' },
        { id: 'articulos', kinds: [30023], label: 'Artículos', icon: '📄' },
        { id: 'eventos',   kinds: [31922, 31923], label: 'Eventos', icon: '📅' }
      ],
      refresh_interval_ms: 300000,
      categories: [
        { id: 'venta',    label: 'Venta',    color: '#00d4ff' },
        { id: 'compra',   label: 'Compra',   color: '#30d158' },
        { id: 'servicio', label: 'Servicio', color: '#bf5af2' },
        { id: 'trueque',  label: 'Trueque',  color: '#ffd60a' }
      ],
      publish_clients: [], nostr_clients: [], wallets: []
    };
  }
}

function initPool() {
  pool = new RelayPool(config.relays, {
    onConnect()    { updateRelayStatus(); },
    onDisconnect() { updateRelayStatus(); }
  });
  pool.connect();
  renderRelayList();
}

// ── Cache ──────────────────────────────────────────────────────
function saveToCache() {
  try {
    const data = {};
    for (const id of Object.keys(channels)) {
      data[id] = [...channels[id].entries()];
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

function loadSortPrefs() {
  try {
    const raw = localStorage.getItem(SORT_PREF_KEY);
    sortPrefs  = raw ? JSON.parse(raw) : {};
  } catch { sortPrefs = {}; }
}

function saveSortPrefs() {
  try { localStorage.setItem(SORT_PREF_KEY, JSON.stringify(sortPrefs)); } catch {}
}

function loadFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return false;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return false;
    for (const [id, entries] of Object.entries(data)) {
      if (!channels[id]) channels[id] = new Map();
      for (const [k, v] of entries) channels[id].set(k, v);
    }
    lastUpdated = new Date(ts);
    return true;
  } catch { return false; }
}

// ── Subscriptions ──────────────────────────────────────────────
function subscribeAll() {
  const tags       = config.community_tags || ['plazap2p'];
  const refreshMs  = config.refresh_interval_ms || 300000;
  const relayCount = config.relays.length;

  function settleChannel(chId, kinds) {
    if (eoseSettled[chId]) return;
    eoseSettled[chId] = true;
    hideSkeletons(chId);
    if (channels[chId].size === 0 && activeTab === chId) {
      if (pool && pool.connectedCount === 0) showNoRelays(chId);
      else showEmpty(chId);
    }
    const sinceTs = Math.floor(Date.now() / 1000);
    setTimeout(() => {
      if (!pool) return;
      pool.unsubscribe(chId);
      pool.subscribe(chId, [{ kinds, '#t': tags, since: sinceTs }], {
        onEvent: (ev) => addEvent(chId, ev),
        onEose:  () => {}
      });
    }, refreshMs);
  }

  for (const ch of config.channels) {
    const filters = [{ kinds: ch.kinds, '#t': tags, limit: 100 }];
    // Fallback: settle after 6s even if some relays never send EOSE
    setTimeout(() => settleChannel(ch.id, ch.kinds), 6000);

    pool.subscribe(ch.id, filters, {
      onEvent: (ev) => addEvent(ch.id, ev),
      onEose:  () => {
        eoseCounts[ch.id] = (eoseCounts[ch.id] || 0) + 1;
        if (eoseCounts[ch.id] >= relayCount) settleChannel(ch.id, ch.kinds);
      }
    });
  }
}

// ── Event ingestion ────────────────────────────────────────────
function addEvent(channelId, event) {
  try {
    const ch = channels[channelId];
    if (!ch) return;
    const key      = eventKey(event);
    const existing = ch.get(key);
    if (existing && event.created_at <= existing.created_at) return;

    const parsed = parseEvent(event);
    if (!parsed) return;

    const isReallyNew = !existing;

    if (parsed.status === 'sold' || parsed.status === 'deleted') {
      ch.delete(key);
    } else {
      ch.set(key, parsed);
    }
    lastUpdated = new Date();

    if (!isInitialLoad && isReallyNew && parsed.status !== 'sold') {
      const label = config.channels.find(c => c.id === channelId)?.label || channelId;
      showToast(`⚡ Nuevo en ${label}`);
    }

    saveToCache();
    if (activeTab === channelId) renderActiveChannel();
    updateAllBadges();
  } catch (e) { console.warn('[addEvent]', e); }
}

function eventKey(event) {
  if ([30402, 30023, 30405, 31922, 31923].includes(event.kind)) {
    return `${event.pubkey}:${getTagValue(event.tags, 'd') || event.id}`;
  }
  return event.id;
}

// ── Parsers ────────────────────────────────────────────────────
function parseEvent(event) {
  switch (event.kind) {
    case 1:     return parseFeedPost(event);
    case 30023: return parseArticle(event);
    case 30402: return parseListing(event);
    case 31922:
    case 31923: return parseCalendarEvent(event);
    case 30405: return parseGeneric(event);
    default:    return parseGeneric(event);
  }
}

function parseListing(event) {
  const { tags, pubkey, created_at } = event;
  const title       = getTagValue(tags, 'title') || 'Sin título';
  const summary     = sanitize(getTagValue(tags, 'summary') || '');
  const location    = cityOnly(getTagValue(tags, 'location'));
  const tTags       = getTagValues(tags, 't').map(t => t.toLowerCase());
  const category    = detectCategory(tTags);
  const payment     = detectPayment(tTags);
  const dTag        = getTagValue(tags, 'd') || event.id;
  const publishedAt = parseInt(getTagValue(tags, 'published_at') || created_at, 10);
  const status      = getTagValue(tags, 'status') || 'active';
  const naddr       = encodeNaddr({ kind: 30402, pubkey, identifier: dTag });
  const npub        = hexToNpub(pubkey);
  return { kind: 30402, title, summary, location, category, payment, publishedAt, status, naddr, npub, created_at };
}

function parseFeedPost(event) {
  return {
    kind:        1,
    content:     sanitize(event.content || ''),
    npub:        hexToNpub(event.pubkey),
    note:        hexToNote(event.id),
    publishedAt: event.created_at,
    created_at:  event.created_at
  };
}

function parseArticle(event) {
  const { tags, pubkey, created_at } = event;
  const dTag        = getTagValue(tags, 'd') || event.id;
  const publishedAt = parseInt(getTagValue(tags, 'published_at') || created_at, 10);
  return {
    kind:        30023,
    title:       getTagValue(tags, 'title') || 'Sin título',
    summary:     sanitize(getTagValue(tags, 'summary') || ''),
    image:       getTagValue(tags, 'image') || null,
    publishedAt,
    naddr:       encodeNaddr({ kind: 30023, pubkey, identifier: dTag }),
    npub:        hexToNpub(pubkey),
    created_at
  };
}

function parseCalendarEvent(event) {
  const { tags, pubkey, created_at, kind } = event;
  const dTag     = getTagValue(tags, 'd') || event.id;
  const title    = getTagValue(tags, 'title') || getTagValue(tags, 'name') || 'Evento sin título';
  const summary  = sanitize(getTagValue(tags, 'summary') || event.content || '');
  const location = getTagValues(tags, 'location').join(' · ');
  const startRaw = getTagValue(tags, 'start');
  const endRaw   = getTagValue(tags, 'end');
  const tzid     = getTagValue(tags, 'start_tzid') || '';
  const links    = getTagValues(tags, 'r');
  const start    = parseCalendarDate(kind, startRaw);
  const end      = parseCalendarDate(kind, endRaw);
  const naddr    = encodeNaddr({ kind, pubkey, identifier: dTag });

  return {
    kind,
    title,
    summary,
    location,
    start,
    end,
    tzid,
    links,
    naddr,
    npub: hexToNpub(pubkey),
    publishedAt: start?.ts || created_at,
    created_at
  };
}

function parseCalendarDate(kind, value) {
  if (!value) return null;
  if (kind === 31922) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return { ts: Math.floor(date.getTime() / 1000), date };
  }

  const ts = Number(value);
  if (!Number.isFinite(ts)) return null;
  const date = new Date(ts * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return { ts, date };
}

function parseGeneric(event) {
  return {
    kind:        event.kind,
    content:     sanitize(event.content || ''),
    npub:        hexToNpub(event.pubkey),
    note:        hexToNote(event.id),
    publishedAt: event.created_at,
    created_at:  event.created_at
  };
}

// ── Rendering ──────────────────────────────────────────────────
const CAT_COLORS = {
  venta: '#00d4ff', compra: '#30d158', servicio: '#bf5af2',
  trueque: '#ffd60a', general: '#86868b', otro: '#86868b'
};

function renderActiveChannel() {
  if (STATIC_TABS.has(activeTab)) return;

  const grid = document.getElementById(`channel-${activeTab}`);
  if (!grid) return;

  const ch = channels[activeTab];
  if (!ch) return;

  document.getElementById('load-more-btn')?.remove();

  const sort = sortPrefs[activeTab] || 'newest';
  let items = [...ch.values()];
  if (activeTab === 'eventos') {
    items = sortCalendarEvents(items);
  } else {
    items.sort((a, b) =>
      sort === 'oldest' ? a.publishedAt - b.publishedAt : b.publishedAt - a.publishedAt
    );
  }

  // Populate location dropdown from all items before applying filters
  if (activeTab === 'mercado') updateLocationSelect(items);

  if (activeTab === 'mercado' && activeFilter !== 'all') {
    items = items.filter(l => l.category === activeFilter);
  }

  if (activeTab === 'mercado' && activeLocation !== 'all') {
    items = items.filter(l => l.location === activeLocation);
  }

  const q = searchQuery.trim().toLowerCase();
  if (q) {
    items = items.filter(item => {
      const text = [item.title, item.summary, item.content, item.location].filter(Boolean).join(' ').toLowerCase();
      return text.includes(q);
    });
  }

  if (activeTab === 'eventos') {
    renderCalendarEvents(grid, items);
    return;
  }

  if (items.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🔍</div>
      <p class="empty-title">Sin resultados</p>
      <p class="empty-sub">Prueba con otro filtro o zona.</p>
    </div>`;
    return;
  }

  const lim = limits[activeTab];
  grid.innerHTML = items.slice(0, lim).map(renderCard).join('');

  if (items.length > lim) {
    const remaining = items.length - lim;
    const btn = document.createElement('button');
    btn.id        = 'load-more-btn';
    btn.className = 'btn-load-more';
    btn.textContent = `Ver más · ${remaining} restante${remaining !== 1 ? 's' : ''}`;
    btn.onclick = () => { limits[activeTab] += PAGE_SIZE; renderActiveChannel(); };
    grid.after(btn);
  }
}

function renderCard(item) {
  switch (item.kind) {
    case 30402: return renderListingCard(item);
    case 1:     return renderFeedCard(item);
    case 30023: return renderArticleCard(item);
    case 31922:
    case 31923: return renderCalendarEventCard(item);
    default:    return renderGenericCard(item);
  }
}

function sortCalendarEvents(items) {
  const now = Math.floor(Date.now() / 1000);
  const upcoming = items.filter(e => !isCalendarEventPast(e, now));
  const past = items.filter(e => isCalendarEventPast(e, now));
  return [
    ...upcoming.sort((a, b) => (a.start?.ts || a.publishedAt) - (b.start?.ts || b.publishedAt)),
    ...past.sort((a, b) => (b.start?.ts || b.publishedAt) - (a.start?.ts || a.publishedAt))
  ];
}

function isCalendarEventPast(e, now = Math.floor(Date.now() / 1000)) {
  const startTs = e.start?.ts || e.publishedAt;
  return (e.end?.ts || startTs) < now;
}

function renderCalendarEvents(grid, items) {
  if (items.length === 0) {
    grid.innerHTML = `<div class="event-empty-card">
      <div class="event-empty-icon">📅</div>
      <div>
        <p class="event-empty-title">No hay eventos activos ahora mismo</p>
        <p class="event-empty-sub">Cuando la comunidad publique eventos NIP-52 en Nostr aparecerán aquí automáticamente.</p>
      </div>
    </div>`;
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const upcoming = items.filter(e => !isCalendarEventPast(e, now));
  const past = items.filter(e => isCalendarEventPast(e, now));
  const lim = limits[activeTab];
  const visibleUpcoming = upcoming.slice(0, lim);
  const remainingLimit = Math.max(0, lim - visibleUpcoming.length);
  const visiblePast = past.slice(0, remainingLimit);
  const html = [];

  if (upcoming.length === 0 && past.length > 0) {
    html.push(`<div class="event-archive-note">
      <span class="event-archive-kicker">Archivo</span>
      <strong>No hay eventos activos ahora mismo</strong>
      <span>Te dejamos los últimos eventos publicados para referencia, sin mezclarlos con próximos encuentros.</span>
    </div>`);
  }

  if (visibleUpcoming.length) html.push(...visibleUpcoming.map(renderCalendarEventCard));
  if (visiblePast.length) {
    if (upcoming.length > 0) {
      html.push(`<div class="event-archive-divider"><span>Eventos anteriores</span></div>`);
    }
    html.push(...visiblePast.map(renderCalendarEventCard));
  }

  grid.innerHTML = html.join('');

  if (items.length > lim) {
    const remaining = items.length - lim;
    const btn = document.createElement('button');
    btn.id = 'load-more-btn';
    btn.className = 'btn-load-more';
    btn.textContent = `Ver más · ${remaining} restante${remaining !== 1 ? 's' : ''}`;
    btn.onclick = () => { limits[activeTab] += PAGE_SIZE; renderActiveChannel(); };
    grid.after(btn);
  }
}

function renderListingCard(l) {
  const color    = CAT_COLORS[l.category] || '#86868b';
  const njumpUrl = `https://njump.me/${l.naddr}`;
  const payment  = l.payment.slice(0, 2).join(' · ');
  const isNew    = (Date.now() / 1000 - l.publishedAt) < 3600;
  return `<article class="listing-card" onclick="openModal('${l.naddr}')" style="--card-accent:${color}">
    <div class="card-top-row">
      <div class="card-badge" style="color:${color};border-color:${color}40">${l.category.toUpperCase()}</div>
      ${isNew ? '<span class="card-new-badge">nuevo</span>' : ''}
    </div>
    <h3 class="card-title">${esc(l.title)}</h3>
    ${l.location ? `<div class="card-location">📍 ${esc(l.location)}</div>` : ''}
    <div class="card-payment">⚡ ${payment}</div>
    <div class="card-footer">
      <span class="card-age">${fmtAge(l.publishedAt)}</span>
      <a href="${njumpUrl}" target="_blank" rel="noopener noreferrer"
         class="card-nostr-link" onclick="event.stopPropagation()">Ver en Nostr →</a>
    </div>
  </article>`;
}

function renderFeedCard(p) {
  const njumpUrl = `https://njump.me/${p.note}`;
  const isNew    = (Date.now() / 1000 - p.publishedAt) < 3600;
  return `<article class="feed-card" onclick="window.open('${njumpUrl}','_blank','noopener noreferrer')">
    <div class="card-top-row">
      <span class="kind-badge kind-post">POST</span>
      ${isNew ? '<span class="card-new-badge">nuevo</span>' : ''}
      <span class="card-age" style="margin-left:auto">${fmtAge(p.publishedAt)}</span>
    </div>
    <p class="feed-content">${p.content}</p>
    <div class="card-footer">
      <span class="card-npub">${p.npub.slice(0, 16)}…</span>
      <span class="card-nostr-link">Ver en Nostr →</span>
    </div>
  </article>`;
}

function renderArticleCard(a) {
  const njumpUrl = `https://njump.me/${a.naddr}`;
  const isNew    = (Date.now() / 1000 - a.publishedAt) < 3600;
  return `<article class="article-card" onclick="window.open('${njumpUrl}','_blank','noopener noreferrer')">
    ${a.image && safeUrl(a.image) ? `<div class="article-img-wrap"><img src="${safeUrl(a.image)}" alt="" class="article-img" loading="lazy" onerror="this.parentElement.style.display='none'"></div>` : ''}
    <div class="article-body">
      <div class="card-top-row">
        <span class="kind-badge kind-article">ARTÍCULO</span>
        ${isNew ? '<span class="card-new-badge">nuevo</span>' : ''}
      </div>
      <h3 class="card-title">${esc(a.title)}</h3>
      ${a.summary ? `<p class="article-summary">${a.summary}</p>` : ''}
      <div class="card-footer">
        <span class="card-age">${fmtAge(a.publishedAt)}</span>
        <span class="card-nostr-link">Leer →</span>
      </div>
    </div>
  </article>`;
}

function renderGenericCard(item) {
  const njumpUrl = `https://njump.me/${item.note}`;
  return `<article class="feed-card" onclick="window.open('${njumpUrl}','_blank','noopener noreferrer')">
    <div class="card-top-row">
      <span class="kind-badge">KIND:${item.kind}</span>
      <span class="card-age" style="margin-left:auto">${fmtAge(item.publishedAt)}</span>
    </div>
    <p class="feed-content">${item.content}</p>
    <div class="card-footer">
      <span class="card-nostr-link">Ver en Nostr →</span>
    </div>
  </article>`;
}

// ── Calendar events ────────────────────────────────────────────
function renderCalendarEventCard(e) {
  const njumpUrl = `https://njump.me/${e.naddr}`;
  const now      = Math.floor(Date.now() / 1000);
  const startTs  = e.start?.ts || e.publishedAt;
  const isPast   = (e.end?.ts || startTs) < now;
  const date     = e.start?.date;
  const day      = date ? date.toLocaleDateString('es-ES', { day: '2-digit' }) : '??';
  const month    = date ? date.toLocaleDateString('es-ES', { month: 'short' }).toUpperCase() : '';
  const dateFmt  = fmtCalendarDate(e);
  const primaryLink = e.links.find(link => safeUrl(link)) || njumpUrl;

  return `<article class="event-card${isPast ? ' event-past' : ''}" onclick="window.open('${njumpUrl}','_blank','noopener noreferrer')">
    <div class="event-date-block">
      <span class="event-date">${day}</span>
      <span class="event-month">${esc(month)}</span>
    </div>
    <div class="event-body">
      <div class="event-top">
        <span class="event-type-badge" style="color:#ffd60a;border-color:#ffd60a40">NIP-52</span>
        ${isPast ? '<span class="event-past-badge">Pasado</span>' : ''}
      </div>
      <h3 class="event-title">${esc(e.title)}</h3>
      ${e.location ? `<div class="event-location">📍 ${esc(e.location)}</div>` : ''}
      ${dateFmt ? `<div class="event-time">📅 ${dateFmt}</div>` : ''}
      ${e.summary ? `<p class="event-desc">${e.summary}</p>` : ''}
      <div class="event-actions">
        <a href="${safeUrl(primaryLink)}" target="_blank" rel="noopener noreferrer" class="btn-secondary btn-sm" onclick="event.stopPropagation()">Ver evento ↗</a>
        <a href="${njumpUrl}" target="_blank" rel="noopener noreferrer" class="btn-ghost btn-sm" onclick="event.stopPropagation()">Nostr ↗</a>
      </div>
    </div>
  </article>`;
}

function fmtCalendarDate(e) {
  if (!e.start?.date) return '';
  if (e.kind === 31922) {
    const opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
    const start = e.start.date.toLocaleDateString('es-ES', opts);
    if (!e.end?.date) return start;
    return `${start} → ${e.end.date.toLocaleDateString('es-ES', opts)}`;
  }

  const opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
  const start = e.start.date.toLocaleString('es-ES', opts);
  if (!e.end?.date) return e.tzid ? `${start} · ${esc(e.tzid)}` : start;
  const end = e.end.date.toLocaleString('es-ES', opts);
  return `${start} → ${end}${e.tzid ? ` · ${esc(e.tzid)}` : ''}`;
}

// ── Skeletons / Empty ──────────────────────────────────────────
function showSkeletons(channelId, n = 6) {
  const grid = document.getElementById(`channel-${channelId}`);
  if (!grid) return;
  grid.innerHTML = Array(n).fill(0).map(() => `<div class="listing-card skeleton">
    <div class="skel skel-badge"></div>
    <div class="skel skel-title"></div>
    <div class="skel skel-line"></div>
    <div class="skel skel-line short"></div>
  </div>`).join('');
}

function hideSkeletons(channelId) {
  document.getElementById(`channel-${channelId}`)
    ?.querySelectorAll('.listing-card.skeleton')
    .forEach(el => el.remove());
}

function showNoRelays(channelId) {
  const grid = document.getElementById(`channel-${channelId}`);
  if (!grid) return;
  grid.innerHTML = `<div class="empty-state">
    <div class="empty-icon">🔌</div>
    <p class="empty-title">Sin conexión a relays</p>
    <p class="empty-sub">No se pudo conectar a ningún relay. Comprueba tu conexión y recarga la página.</p>
    <button class="btn-primary" onclick="switchTab('relays')">Ver estado de relays</button>
  </div>`;
}

function showEmpty(channelId) {
  const grid = document.getElementById(`channel-${channelId}`);
  if (!grid) return;
  if (channelId === 'eventos') {
    renderCalendarEvents(grid, []);
    return;
  }
  const ch   = config.channels.find(c => c.id === channelId);
  const tag  = (config.community_tags || ['plazap2p'])[0];
  grid.innerHTML = `<div class="empty-state">
    <div class="empty-icon">${ch?.icon || '📡'}</div>
    <p class="empty-title">Sin contenido aún</p>
    <p class="empty-sub">Publica en Nostr con el tag <code>#${tag}</code> y aparecerá aquí.</p>
    <button class="btn-primary" onclick="switchTab('publicar')">¿Cómo aparecer?</button>
  </div>`;
}

// ── Toast ──────────────────────────────────────────────────────
function showToast(msg) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  container.appendChild(toast);
  void toast.offsetHeight;
  toast.classList.add('toast-visible');
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 350);
  }, 3200);
}

// ── Modal (mercado / kind:30402) ───────────────────────────────
window.openModal = function(naddr) {
  const ch = channels['mercado'];
  if (!ch) return;
  const l = [...ch.values()].find(x => x.naddr === naddr);
  if (!l) return;

  const color    = CAT_COLORS[l.category] || '#86868b';
  const njumpUrl = `https://njump.me/${l.naddr}`;
  const modal    = document.getElementById('listing-modal');

  modal.innerHTML = `
    <div class="modal-overlay" onclick="closeModal()"></div>
    <div class="modal-box">
      <button class="modal-close" onclick="closeModal()">✕</button>
      <div class="modal-category" style="color:${color}">${l.category.toUpperCase()}</div>
      <h2 id="modal-title" class="modal-title">${esc(l.title)}</h2>
      ${l.location ? `<div class="modal-location">📍 ${esc(l.location)}</div>` : ''}
      ${l.summary  ? `<p class="modal-summary">${l.summary}</p>` : ''}
      <div class="modal-meta">
        <span><strong>Pago:</strong> ${l.payment.join(', ')}</span>
        <span><strong>Publicado:</strong> ${fmtAge(l.publishedAt)}</span>
      </div>
      <div class="modal-notice">
        <span>🔒</span>
        <span>La información completa y el contacto están en la red Nostr. La interacción ocurre fuera de esta interfaz.</span>
      </div>
      <div class="modal-actions">
        <a href="${njumpUrl}" target="_blank" rel="noopener noreferrer" class="btn-primary">
          Ver anuncio completo en Nostr ↗
        </a>
        <button onclick="closeModal()" class="btn-secondary">Cerrar</button>
      </div>
    </div>`;

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
};

window.closeModal = function() {
  document.getElementById('listing-modal')?.classList.add('hidden');
  document.body.style.overflow = '';
};

// ── Filters (mercado only) ─────────────────────────────────────
function initFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      limits['mercado'] = PAGE_SIZE;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderActiveChannel();
    });
  });

  document.getElementById('location-select')?.addEventListener('change', e => {
    activeLocation = e.target.value;
    limits['mercado'] = PAGE_SIZE;
    renderActiveChannel();
  });
}

function updateLocationSelect(items) {
  const select = document.getElementById('location-select');
  if (!select) return;
  const current   = select.value;
  const locations = [...new Set(items.map(i => i.location).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  select.innerHTML = `<option value="all">📍 Todas las zonas</option>` +
    locations.map(l => `<option value="${esc(l)}"${l === current ? ' selected' : ''}>${esc(l)}</option>`).join('');
}

// ── UI init ────────────────────────────────────────────────────
function initUI() {
  initTabs();
  initFilters();
  initSort();
  initSearch();
  initTabFromUrl();
}

function initSearch() {
  document.querySelectorAll('.tab-search').forEach(input => {
    input.addEventListener('input', () => {
      searchQuery = input.value;
      // Sync all search inputs (there's one per tab but only one active)
      document.querySelectorAll('.tab-search').forEach(el => {
        if (el !== input) el.value = input.value;
      });
      limits[activeTab] = PAGE_SIZE;
      renderActiveChannel();
    });
  });
}

function initSort() {
  document.querySelectorAll('.sort-select').forEach(sel => {
    const ch  = sel.dataset.channel;
    sel.value = sortPrefs[ch] || 'newest';
    sel.addEventListener('change', () => {
      sortPrefs[ch] = sel.value;
      // Sync any duplicate selects for same channel
      document.querySelectorAll(`.sort-select[data-channel="${ch}"]`).forEach(s => { s.value = sel.value; });
      saveSortPrefs();
      if (activeTab === ch) { limits[ch] = PAGE_SIZE; renderActiveChannel(); }
    });
  });
}

function initTabs() {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function initTabFromUrl() {
  const tab = new URLSearchParams(window.location.search).get('tab');
  const validTabs = [...document.querySelectorAll('.nav-tab')].map(btn => btn.dataset.tab);
  if (tab && validTabs.includes(tab)) {
    window.switchTab(tab, { syncUrl: false });
  }
}

window.switchTab = function(tab, options = {}) {
  activeTab = tab;
  if (!limits[tab]) limits[tab] = PAGE_SIZE;

  document.querySelectorAll('.nav-tab').forEach(b => {
    const isActive = b.dataset.tab === tab;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  document.querySelectorAll('.section-panel').forEach(p => {
    p.classList.remove('active');
    if (p.id === `tab-${tab}`) p.classList.add('active');
  });

  renderActiveChannel();
  if (tab === 'relays') renderRelayStatus();
  if (options.syncUrl !== false) {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url);
  }
};

// ── Badges & counters ──────────────────────────────────────────
function updateAllBadges() {
  const total = Object.values(channels).reduce((s, m) => s + m.size, 0);
  const el    = document.getElementById('listing-count');
  if (el) {
    const current = parseInt(el.textContent) || 0;
    if (current !== total) animateNum(el, current, total);
  }

  const upd = document.getElementById('counter-updated');
  if (upd && lastUpdated) {
    const secs = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
    upd.textContent = `· ${fmtAge(Math.floor(Date.now() / 1000) - secs)}`;
  }

  for (const ch of (config?.channels || [])) {
    const badge = document.getElementById(`tab-count-${ch.id}`);
    if (badge) {
      const n = channels[ch.id]?.size || 0;
      badge.textContent = n > 0 ? n : '';
    }
  }
}

function animateNum(el, from, to) {
  if (from === to) return;
  const dur   = Math.min(700, Math.abs(to - from) * 40);
  const start = performance.now();
  const step  = (now) => {
    const p     = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(step);
    else el.classList.add('counter-pop');
  };
  requestAnimationFrame(step);
  el.addEventListener('animationend', () => el.classList.remove('counter-pop'), { once: true });
}

// ── Relay UI ───────────────────────────────────────────────────
function renderRelayList() {
  const list = document.getElementById('relay-status-list');
  if (!list || !config) return;
  list.innerHTML = config.relays.map(url => relayItemHtml(url, 'conectando')).join('');
}

function renderRelayStatus() {
  const list = document.getElementById('relay-status-list');
  if (!list || !pool) return;
  list.innerHTML = pool.status.map(({ url, status }) => relayItemHtml(url, status)).join('');
}

function relayItemHtml(url, status) {
  const dot  = status === 'connected' ? '🟢' : status === 'connecting' ? '🟡' : '🔴';
  const safe = url.replace(/'/g, '');
  return `<div class="relay-item">
    <span class="relay-dot-icon">${dot}</span>
    <span class="relay-url">${url.replace('wss://', '')}</span>
    <span class="relay-status-label">${status}</span>
    <button class="btn-copy" onclick="copyToClipboard('${safe}')">copiar</button>
  </div>`;
}

function updateRelayStatus() {
  if (!pool) return;
  const n     = pool.connectedCount;
  const total = config?.relays?.length || 0;
  const dot   = document.getElementById('relay-dot');
  const label = document.getElementById('relay-label');
  if (dot)   dot.className    = `relay-dot ${n > 0 ? 'connected' : 'disconnected'}`;
  if (label) label.textContent = n > 0 ? `${n}/${total} relays` : 'conectando...';
  renderRelayStatus();
}

// ── Utilities ──────────────────────────────────────────────────
window.copyToClipboard = async function(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('✓ Copiado');
  } catch {
    showToast('No se pudo copiar');
  }
};

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeUrl(url) {
  if (!url) return '';
  try {
    url = String(url).trim();
    if (/^(npub|nprofile|note|nevent|naddr)1/i.test(url)) {
      url = `https://njump.me/${url}`;
    }
    const u = new URL(url, window.location.href);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    if (u.origin === window.location.origin) return esc(u.pathname + u.search + u.hash);
    return esc(url);
  } catch { return ''; }
}

function versioned(path) {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}v=${ASSET_VERSION}`;
}

function langBadge(idiom) {
  if (!idiom) return '';
  const flags = {
    es: '🇪🇸 ES',
    en: '🇬🇧 EN',
    ing: '🇬🇧 EN',
    pt: '🇵🇹 PT',
    fr: '🇫🇷 FR',
    de: '🇩🇪 DE',
    it: '🇮🇹 IT'
  };
  return String(idiom).split(/[\/,· ]+/)
    .filter(Boolean)
    .map(part => flags[part.toLowerCase()] || part.toUpperCase())
    .join(' · ');
}

function initialsFromName(name) {
  const clean = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (!clean) return '?';
  const words = clean.split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] || '';
  const second = words.length > 1 ? words[1]?.[0] : words[0]?.[1] || '';
  return `${first}${second}`.toUpperCase();
}

function toneFromSeed(seed) {
  const tones = ['btc', 'cyan', 'green', 'purple', 'yellow'];
  const str = String(seed || '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i);
  return tones[Math.abs(hash) % tones.length];
}

function mediaImageUrl(item) {
  return safeUrl(item?.logo_url || item?.logo || item?.imagen || item?.image || item?.avatar || '');
}

function fmtAge(ts) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60)      return 'ahora';
  if (s < 3600)    return `${Math.floor(s / 60)}m`;
  if (s < 86400)   return `${Math.floor(s / 3600)}h`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d`;
  const m = Math.floor(s / 2592000);
  return m === 1 ? '1 mes' : `${m} meses`;
}

function sanitize(text) {
  return esc(String(text)
    .replace(/\+?[\d\s().-]{8,}/g, '···')
    .replace(/[\w.+-]+@[\w.-]+\.\w+/g, '···')
    .replace(/https?:\/\/\S+/g, '[enlace]')
    .slice(0, 200));
}

function cityOnly(raw) {
  if (!raw) return null;
  return raw.split(',')[0].trim();
}

function detectCategory(tTags) {
  // Sub-tags tienen prioridad — el tag define la categoría
  if (tTags.includes('plazap2p-venta'))    return 'venta';
  if (tTags.includes('plazap2p-compra'))   return 'compra';
  if (tTags.includes('plazap2p-servicio')) return 'servicio';
  if (tTags.includes('plazap2p-trueque'))  return 'trueque';
  // Compatibilidad: tags de categoría sueltos (NIP-99 legacy)
  for (const cat of ['venta', 'compra', 'servicio', 'trueque']) {
    if (tTags.includes(cat)) return cat;
  }
  // Sin sub-tag → General (aparece en "General" y en todos los demás)
  return 'general';
}

function detectPayment(tTags) {
  const methods = [];
  if (tTags.some(t => ['bitcoin', 'btc', 'onchain'].includes(t)))   methods.push('Bitcoin');
  if (tTags.some(t => ['lightning', 'ln', 'lnbc'].includes(t)))     methods.push('Lightning');
  if (tTags.some(t => ['cashu', 'ecash'].includes(t)))              methods.push('Cashu');
  if (tTags.some(t => ['efectivo', 'cash'].includes(t)))            methods.push('Efectivo');
  return methods.length ? methods : ['Bitcoin'];
}

// ── Static data (GitHub JSON) ──────────────────────────────────
async function loadStaticData() {
  const GITHUB_URL = 'https://github.com/jjstudio-dev/Plazap2p-v3';
  try {
    const [comunidades, herramientas, multimedia] = await Promise.all([
      fetch(versioned('data/comunidades.json')).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(versioned('data/herramientas.json')).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(versioned('data/multimedia.json')).then(r => r.ok ? r.json() : []).catch(() => [])
    ]);
    renderComunidades(comunidades.filter(c => c.aprobado), GITHUB_URL);
    renderHerramientas(herramientas.filter(h => h.aprobado), GITHUB_URL);
    renderMultimedia(multimedia.filter(m => m.aprobado), GITHUB_URL);
  } catch (err) {
    console.warn('[static] Error cargando datos estáticos:', err);
  }
  loadMantenimiento();
}

async function loadMantenimiento() {
  try {
    const res = await fetch(versioned('data/mantenimiento.json'));
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ln_address && !data.btc_address) return;

    const addressesHtml = buildDonarAddresses(data);
    const msgHtml  = `<p>${esc(data.mensaje || '')}</p>`;
    const gracHtml = `<p class="donar-gracias">${esc(data.mensaje_gracias || '')}</p>`;

    const block = document.getElementById('donar-block');
    if (block) {
      document.getElementById('donar-mensaje').innerHTML   = msgHtml;
      document.getElementById('donar-addresses').innerHTML = addressesHtml;
      document.getElementById('donar-gracias').innerHTML   = gracHtml;
      block.style.display = '';
    }

    document.getElementById('btn-donar-header')?.style && (document.getElementById('btn-donar-header').style.display = '');
    document.getElementById('footer-donar-link')?.style && (document.getElementById('footer-donar-link').style.display = '');

    document.getElementById('modal-donar-mensaje').innerHTML   = msgHtml;
    document.getElementById('modal-donar-addresses').innerHTML = addressesHtml;
    document.getElementById('modal-donar-gracias').innerHTML   = gracHtml;
  } catch (err) {
    console.warn('[mantenimiento] No se pudo cargar:', err);
  }
}

function buildDonarAddresses(data) {
  let html = '';
  if (data.ln_address) {
    html += `<div class="donar-row">
      <span class="donar-label">⚡ Lightning</span>
      <code class="donar-addr">${esc(data.ln_address)}</code>
      <button class="btn-copy" onclick="window.copyToClipboard('${esc(data.ln_address)}')">Copiar</button>
    </div>`;
  }
  if (data.btc_address) {
    html += `<div class="donar-row">
      <span class="donar-label">₿ Bitcoin</span>
      <code class="donar-addr">${esc(data.btc_address)}</code>
      <button class="btn-copy" onclick="window.copyToClipboard('${esc(data.btc_address)}')">Copiar</button>
    </div>`;
  }
  return html;
}

window.openDonarModal = function() {
  const overlay = document.getElementById('modal-donar-overlay');
  if (overlay) { overlay.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
};

window.closeDonarModal = function() {
  const overlay = document.getElementById('modal-donar-overlay');
  if (overlay) { overlay.classList.add('hidden'); document.body.style.overflow = ''; }
};

function staticDisclaimer(label, githubUrl, templateParam) {
  const issueUrl = `${githubUrl}/issues/new?template=${templateParam}`;
  return `<div class="static-footer">
    <span class="static-disclaimer">Contenido curado por la comunidad. PlazaP2P no verifica la información listada.</span>
    <a href="${issueUrl}" target="_blank" rel="noopener noreferrer" class="btn-suggest">+ Sugerir ${label} ↗</a>
  </div>`;
}

function staticEmpty(icon, label, githubUrl, templateParam) {
  const issueUrl = `${githubUrl}/issues/new?template=${templateParam}`;
  return `<div class="empty-state">
    <div class="empty-icon">${icon}</div>
    <p class="empty-title">Sin ${label} todavía</p>
    <p class="empty-sub">Sé el primero en proponer un ${label.slice(0, -1)} para la comunidad.</p>
    <a href="${issueUrl}" target="_blank" rel="noopener noreferrer" class="btn-primary">Sugerir ${label.slice(0, -1)} en GitHub ↗</a>
  </div>`;
}

// ── Render: Comunidades ────────────────────────────────────────
function renderComunidades(items, githubUrl) {
  const container = document.getElementById('channel-comunidades');
  if (!container) return;
  const footer = document.getElementById('comunidades-footer');

  if (items.length === 0) {
    container.innerHTML = staticEmpty('🏘', 'comunidades', githubUrl, 'comunidad.yml');
    return;
  }

  const PLAT_ICONS = { Telegram: '✈️', Nostr: '⚡', Discord: '🎮', Matrix: '🔷', Signal: '🔒', Web: '🌐', Otra: '💬' };

  container.innerHTML = items.map(c => {
    const icon = PLAT_ICONS[c.plataforma] || '💬';
    const logo = mediaImageUrl(c);
    const initials = initialsFromName(c.nombre);
    const tone = toneFromSeed(c.nombre || c.id);
    const avatar = logo
      ? `<img src="${logo}" alt="" class="directory-avatar-img" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="directory-avatar-fallback" style="display:none">${esc(initials)}</span>`
      : `<span class="directory-avatar-fallback">${esc(initials)}</span>`;

    return `<article class="community-card directory-card">
      <div class="directory-accent"></div>
      <div class="directory-card-body">
        <div class="directory-head">
          <div class="directory-avatar directory-avatar-${tone}" aria-hidden="true">${avatar}</div>
          <div class="directory-meta">
            <h3 class="community-name">${esc(c.nombre)}</h3>
            <div class="community-top">
              <span class="community-platform"><span class="community-platform-icon">${icon}</span>${esc(c.plataforma || 'Comunidad')}</span>
              ${c.pais ? `<span class="community-country">${esc(c.pais)}</span>` : ''}
            </div>
          </div>
        </div>
        <p class="community-desc">${esc(c.descripcion || '')}</p>
        <div class="directory-footer">
          ${c.idioma ? `<span class="directory-chip">${esc(langBadge(c.idioma))}</span>` : '<span></span>'}
          <a href="${safeUrl(c.link)}" target="_blank" rel="noopener noreferrer" class="btn-secondary btn-sm">Unirse ↗</a>
        </div>
      </div>
    </article>`;
  }).join('');

  if (footer) footer.innerHTML = staticDisclaimer('comunidad', githubUrl, 'comunidad.yml');
}

// ── Render: Herramientas ───────────────────────────────────────
const CAT_META = {
  p2p:        { label: 'Exchange P2P',       icon: '🔄', color: '#30d158' },
  lightning:  { label: 'Lightning',          icon: '⚡', color: '#ffd60a' },
  wallet:     { label: 'Wallets Bitcoin',    icon: '🔐', color: '#f7931a' },
  node:       { label: 'Nodos',             icon: '📡', color: '#00d4ff' },
  analytics:  { label: 'Analytics',         icon: '📊', color: '#bf5af2' },
  privacy:    { label: 'Privacidad',        icon: '🛡️', color: '#86868b' },
  nostr:      { label: 'Herramientas Nostr', icon: '🟣', color: '#bf5af2' },
  utilities:  { label: 'Utilidades',        icon: '🧰', color: '#86868b' }
};
const CAT_ORDER = ['p2p', 'lightning', 'wallet', 'node', 'nostr', 'analytics', 'privacy', 'utilities'];

function renderHerramientas(items, githubUrl) {
  const container = document.getElementById('channel-herramientas');
  if (!container) return;
  const footer = document.getElementById('herramientas-footer');

  if (items.length === 0) {
    container.innerHTML = staticEmpty('🔧', 'herramientas', githubUrl, 'herramienta.yml');
    return;
  }

  const grouped = {};
  for (const h of items) {
    const cat = h.categoria || 'utilities';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(h);
  }

  const html = CAT_ORDER
    .filter(cat => grouped[cat]?.length)
    .map(cat => {
      const meta = CAT_META[cat] || { label: cat, icon: '🔧', color: '#86868b' };
      const tools = grouped[cat].map(h => {
        const logoHtml = h.logo
          ? `<div class="tool-logo-wrap"><img class="tool-logo" src="${esc(h.logo)}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'"></div>`
          : '';
        const osBadge = h.open_source
          ? `<span class="guia-tipo-badge guia-badge-os">Open Source</span>`
          : '';
        return `
          <div class="guia-card">
            <div class="tool-header">
              ${logoHtml}
              <span class="guia-title">${esc(h.nombre)}</span>
            </div>
            <div class="guia-meta">
              ${h.plataforma ? `<span class="guia-tipo-badge">${esc(h.plataforma)}</span>` : ''}
              ${osBadge}
            </div>
            <p class="guia-desc">${esc(h.descripcion || '')}</p>
            <div class="guia-footer">
              <a class="btn-link" href="${safeUrl(h.link)}" target="_blank" rel="noopener noreferrer">ABRIR ▸</a>
            </div>
          </div>`;
      }).join('');
      return `<div class="tools-category">
        <div class="tools-cat-header">
          <span class="tools-cat-icon">${meta.icon}</span>
          <span class="tools-cat-label" style="color:${meta.color}">${meta.label}</span>
        </div>
        <div class="tools-cat-grid">${tools}</div>
      </div>`;
    }).join('');

  container.innerHTML = html;
  if (footer) footer.innerHTML = staticDisclaimer('herramienta', githubUrl, 'herramienta.yml');
}

// ── Render: Multimedia ─────────────────────────────────────────
function renderMultimedia(items, githubUrl) {
  const container = document.getElementById('channel-multimedia');
  if (!container) return;
  const footer = document.getElementById('multimedia-footer');

  if (items.length === 0) {
    container.innerHTML = staticEmpty('🎙', 'recursos multimedia', githubUrl, 'multimedia.yml');
    return;
  }

  const TYPE_ICONS = { perfil: '👤', podcast: '🎙', youtube: '▶', newsletter: '📰', blog: '✍', livestream: '📺', web: '🌐', x: '𝕏', twitter: '𝕏', github: '{}', pdf: 'PDF', nostr: 'N', telegram: 'TG', instagram: 'IG', linkedin: 'in', email: '@' };
  const TYPE_LABELS = { perfil: 'perfil', podcast: 'podcast', youtube: 'youtube', newsletter: 'newsletter', blog: 'blog', livestream: 'directo', web: 'web', x: 'x', twitter: 'x', github: 'github', pdf: 'pdf', nostr: 'nostr', telegram: 'telegram', instagram: 'instagram', linkedin: 'linkedin', email: 'email' };

  container.innerHTML = items.map(m => {
    const icon = TYPE_ICONS[m.tipo] || '🔗';
    const typeLabel = TYPE_LABELS[m.tipo] || m.tipo || 'recurso';
    const links = Array.isArray(m.enlaces) ? m.enlaces : (m.link ? [{ tipo: m.tipo, label: m.tipo || 'Abrir', url: m.link }] : []);
    const socialLinks = links.map(link => {
      const type = link.tipo || 'web';
      const label = link.label || TYPE_LABELS[type] || 'Abrir';
      return `<a href="${safeUrl(link.url)}" target="_blank" rel="noopener noreferrer" class="multimedia-social-link" aria-label="${esc(label)}" title="${esc(label)}">
        <span class="multimedia-social-icon">${TYPE_ICONS[type] || '↗'}</span>
      </a>`;
    }).join('');
    const logo = mediaImageUrl(m);
    const initials = initialsFromName(m.nombre);
    const tone = toneFromSeed(m.nombre || m.id);
    const mediaIcon = logo
      ? `<img src="${logo}" alt="" class="directory-avatar-img" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="directory-avatar-fallback" style="display:none">${esc(initials)}</span>`
      : `<span class="directory-avatar-fallback">${esc(initials)}</span>`;

    return `<article class="multimedia-card directory-card">
      <div class="directory-accent"></div>
      <div class="directory-card-body">
        <div class="directory-head">
          <div class="directory-avatar directory-avatar-${tone}" aria-hidden="true">${mediaIcon}</div>
          <div class="directory-meta">
            <div class="multimedia-top">
              <span class="multimedia-type">${icon} ${esc(typeLabel)}</span>
              ${m.idioma ? `<span class="multimedia-lang">${esc(langBadge(m.idioma))}</span>` : ''}
            </div>
            <h3 class="multimedia-name">${esc(m.nombre)}</h3>
          </div>
        </div>
        <p class="multimedia-desc">${esc(m.descripcion || '')}</p>
        ${socialLinks ? `<div class="multimedia-socials">${socialLinks}</div>` : ''}
      </div>
    </article>`;
  }).join('');

  if (footer) footer.innerHTML = staticDisclaimer('recurso', githubUrl, 'multimedia.yml');
}

init();
