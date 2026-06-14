// converter.js — BTC ↔ sats ↔ EUR · USD · CNY · USDT · USDC · CHF · XAU
// mempool.space: USD/EUR/CHF · CoinGecko fallback · yadio.io: CNY/XAU · USDT/USDC derivadas de USD

const MEMPOOL_URL   = 'https://mempool.space/api/v1/prices';
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur,usd,cny,chf';
const YADIO_URL     = 'https://api.yadio.io/exrates/BTC';
const REFRESH_MS    = 5 * 60 * 1000;

const FIATS = [
  { id: 'EUR',  label: 'Euro',      flag: '🇪🇺', fmt: 2 },
  { id: 'USD',  label: 'Dólar US',  flag: '🇺🇸', fmt: 2 },
  { id: 'CNY',  label: 'Yuan',      flag: '🇨🇳', fmt: 2 },
  { id: 'USDT', label: 'Tether',    flag: '₮',   fmt: 2 },
  { id: 'USDC', label: 'USD Coin',  flag: '🔵',  fmt: 2 },
  { id: 'CHF',  label: 'Franco CH', flag: '🇨🇭', fmt: 2 },
  { id: 'XAU',  label: 'Oro (oz)',  flag: '🟡', fmt: 6 },
];

let rates   = {};
let lastBtc = 1;
let _intervalId = null;

function withTimeout(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(ms) };
  }
  return {};
}

export async function initConverter() {
  buildUI();
  recalc(1, null);       // muestra BTC=1 y sats=100.000.000 antes del fetch
  setFiatPlaceholders('Cargando…');
  await fetchRates();
  _intervalId = setInterval(fetchRates, REFRESH_MS);
}

export function destroyConverter() {
  if (_intervalId !== null) { clearInterval(_intervalId); _intervalId = null; }
}

// ── Fetch ─────────────────────────────────────────────────────────
async function fetchRates() {
  const el = document.getElementById('btc-converter');
  if (el) el.classList.add('conv-loading');

  const [mp, cg, yd] = await Promise.allSettled([
    fetch(MEMPOOL_URL, withTimeout(6000)).then(r => r.json()),
    fetch(COINGECKO_URL, withTimeout(8000)).then(r => r.json()),
    fetch(YADIO_URL, withTimeout(8000)).then(r => r.json()),
  ]);

  if (mp.status === 'fulfilled') {
    const d = mp.value;
    if (d.USD) rates.USD = d.USD;
    if (d.EUR) rates.EUR = d.EUR;
    if (d.CHF) rates.CHF = d.CHF;
  }

  if (cg.status === 'fulfilled') {
    const d = cg.value?.bitcoin || {};
    if (!rates.USD && d.usd) rates.USD = d.usd;
    if (!rates.EUR && d.eur) rates.EUR = d.eur;
    if (!rates.CNY && d.cny) rates.CNY = d.cny;
    if (!rates.CHF && d.chf) rates.CHF = d.chf;
  }

  if (yd.status === 'fulfilled') {
    const d   = yd.value;
    const src = d.rates || d.BTC || d;
    const cny = src.CNY;
    if (cny != null && !rates.CNY) {
      rates.CNY = typeof cny === 'object' ? (cny.rate || cny.ask || cny.bid) : cny;
    }
    const xau = src.XAU;
    if (xau != null && !rates.XAU) {
      rates.XAU = typeof xau === 'object' ? (xau.rate || xau.ask || xau.bid) : xau;
    }
  }

  if (rates.USD) { rates.USDT = rates.USD; rates.USDC = rates.USD; }

  if (el) el.classList.remove('conv-loading');

  const noRates = Object.keys(rates).length === 0;
  showErrorBanner(noRates);

  syncRateDisplay();
  recalc(lastBtc, null);
}

// ── UI ────────────────────────────────────────────────────────────
function buildUI() {
  const el = document.getElementById('btc-converter');
  if (!el) return;

  el.innerHTML = `
    <div class="conv-header">
      <div class="conv-header-left">
        <span class="conv-title">💱 Conversor Bitcoin</span>
        <span class="conv-live-badge"><span class="conv-live-dot"></span>en vivo</span>
      </div>
      <div class="conv-rate-display" id="conv-rate-display">
        <span class="conv-rate-pill">EUR <span id="conv-eur-rate" class="conv-rate-value">—</span></span>
        <span class="conv-rate-pill">USD <span id="conv-usd-rate" class="conv-rate-value">—</span></span>
      </div>
    </div>

    <div id="conv-error-banner" class="conv-error-banner" style="display:none">
      <span>⚠ No se pudieron cargar las tasas de cambio.</span>
      <button class="conv-retry-btn" id="conv-retry-btn">Reintentar</button>
    </div>

    <div class="conv-primary-block">
      <div class="conv-row conv-row-btc" data-accent="btc">
        <div class="conv-currency-info">
          <span class="conv-flag conv-flag-btc">₿</span>
          <div>
            <span class="conv-currency-name">Bitcoin</span>
            <span class="conv-code">BTC</span>
          </div>
        </div>
        <input id="conv-btc" class="conv-input conv-primary-input" type="number"
          value="1" min="0" step="0.00000001" placeholder="0.00000000" data-src="btc"
          autocomplete="off" inputmode="decimal">
      </div>
      <div class="conv-row conv-row-sats" data-accent="sats">
        <div class="conv-currency-info">
          <span class="conv-flag conv-flag-sats">⚡</span>
          <div>
            <span class="conv-currency-name">Satoshis</span>
            <span class="conv-code">sats</span>
          </div>
        </div>
        <input id="conv-sats" class="conv-input conv-primary-input" type="number"
          min="0" step="1" placeholder="100 000 000" data-src="sats"
          autocomplete="off" inputmode="numeric">
      </div>
    </div>

    <div class="conv-divider">
      <span class="conv-divider-line"></span>
      <span class="conv-divider-label">monedas fiat</span>
      <span class="conv-divider-line"></span>
    </div>

    <div class="conv-fiat-grid" id="conv-fiat-grid">
      ${FIATS.map(f => fiatRowHtml(f)).join('')}
    </div>

    <div class="conv-footer">
      <span id="conv-ts" class="conv-ts">Cargando tasas…</span>
      <span class="conv-sources">mempool.space · CoinGecko · yadio.io</span>
    </div>`;

  wireInputs(el);

  document.getElementById('conv-retry-btn')?.addEventListener('click', () => fetchRates());
}

function fiatRowHtml(f) {
  return `
    <div class="conv-row conv-fiat-row" data-id="${f.id}">
      <div class="conv-currency-info">
        <span class="conv-flag">${f.flag}</span>
        <div>
          <span class="conv-currency-name">${f.label}</span>
          <span class="conv-code">${f.id}</span>
        </div>
      </div>
      <div class="conv-input-wrap">
        <input id="conv-${f.id.toLowerCase()}" class="conv-input" type="number"
          min="0" step="any" placeholder="—" data-src="${f.id.toLowerCase()}"
          autocomplete="off" inputmode="decimal">
        <button class="conv-copy-btn" data-target="conv-${f.id.toLowerCase()}" title="Copiar ${f.id}" aria-label="Copiar valor ${f.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
        </button>
      </div>
    </div>`;
}

function wireInputs(el) {
  el.querySelectorAll('.conv-input').forEach(input => {
    input.addEventListener('input', () => {
      const src = input.dataset.src;
      // Keep exponent notation (e.g. 1e+8) and accept comma decimal.
      const normalized = input.value.replace(',', '.').trim();
      const val = Number(normalized);
      if (!Number.isFinite(val) || val < 0) return;
      let btc = 0;
      if      (src === 'btc')  btc = val;
      else if (src === 'sats') btc = val / 1e8;
      else { const r = rates[src.toUpperCase()]; btc = r ? val / r : 0; }
      lastBtc = btc;
      recalc(btc, src);
    });
  });

  el.querySelectorAll('.conv-copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input?.value) return;
      try {
        await navigator.clipboard.writeText(input.value);
        btn.classList.add('conv-copy-done');
        setTimeout(() => btn.classList.remove('conv-copy-done'), 1400);
      } catch {}
    });
  });
}

// ── Calculation ───────────────────────────────────────────────────
function recalc(btc, skipSrc) {
  setField('conv-btc',  'btc',  skipSrc, btc > 0 ? fmtBtc(btc)  : '');
  setField('conv-sats', 'sats', skipSrc, btc > 0 ? fmtSats(btc) : '');

  FIATS.forEach(f => {
    const r = rates[f.id];
    const val = r ? btc * r : null;
    setField(`conv-${f.id.toLowerCase()}`, f.id.toLowerCase(), skipSrc,
      val != null && val > 0 ? fmtFiat(val, f.fmt) : '');
  });
}

function setField(id, src, skipSrc, val) {
  if (src === skipSrc) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.value = val;
  if (val) {
    el.classList.remove('conv-flash');
    void el.offsetWidth;
    el.classList.add('conv-flash');
  }
}

// ── Display ───────────────────────────────────────────────────────
function syncRateDisplay() {
  const eurEl = document.getElementById('conv-eur-rate');
  const usdEl = document.getElementById('conv-usd-rate');
  if (eurEl && rates.EUR) eurEl.textContent = `€${Math.round(rates.EUR).toLocaleString('es-ES')}`;
  if (usdEl && rates.USD) usdEl.textContent = `$${Math.round(rates.USD).toLocaleString('en-US')}`;

  const ts = document.getElementById('conv-ts');
  if (ts) ts.textContent = `Actualizado ${new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`;

  FIATS.forEach(f => {
    const row   = document.querySelector(`.conv-fiat-row[data-id="${f.id}"]`);
    const input = row?.querySelector('input');
    if (!row || !input) return;

    const hasRate = !!rates[f.id];
    row.classList.toggle('conv-row-na', !hasRate);
    // Allow the user to still see and click even without rate — just disable interaction
    input.disabled  = !hasRate;
    input.placeholder = hasRate ? '0,00' : 'Sin tasa';
    input.title = hasRate ? '' : 'Tasa no disponible — reintenta en un momento';
  });
}

function showErrorBanner(show) {
  const banner = document.getElementById('conv-error-banner');
  if (banner) banner.style.display = show ? 'flex' : 'none';
}

function setFiatPlaceholders(text) {
  FIATS.forEach(f => {
    const input = document.getElementById(`conv-${f.id.toLowerCase()}`);
    if (input) input.placeholder = text;
  });
}

// ── Format ────────────────────────────────────────────────────────
function fmtFiat(val, decimals) {
  if (val === 0) return '';
  if (val < 0.01) return val.toFixed(Math.max(decimals, 6));
  return val.toFixed(decimals);
}

function fmtBtc(val) {
  if (!Number.isFinite(val) || val <= 0) return '';
  if (val >= 1e21) return val.toLocaleString('en-US', { maximumFractionDigits: 0, useGrouping: false });
  return val.toFixed(8);
}

function fmtSats(btc) {
  if (!Number.isFinite(btc) || btc <= 0) return '';
  const sats = btc * 1e8;
  if (!Number.isFinite(sats)) return '';
  if (sats >= Number.MAX_SAFE_INTEGER) {
    return sats.toLocaleString('en-US', { maximumFractionDigits: 0, useGrouping: false });
  }
  return String(Math.round(sats));
}
