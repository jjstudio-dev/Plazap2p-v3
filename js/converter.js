// converter.js — BTC ↔ sats ↔ multi-fiat  (Yadio-style)
// mempool.space: USD/EUR/GBP/CAD  ·  yadio.io: ARS/VES/COP/MXN/BRL

const MEMPOOL_URL = 'https://mempool.space/api/v1/prices';
const YADIO_URL   = 'https://api.yadio.io/exrates/BTC';
const REFRESH_MS  = 5 * 60 * 1000;

const FIATS = [
  { id: 'USD', label: 'Dólar US',   flag: '🇺🇸', src: 'mempool', fmt: 2 },
  { id: 'EUR', label: 'Euro',       flag: '🇪🇺', src: 'mempool', fmt: 2 },
  { id: 'GBP', label: 'Libra Est.', flag: '🇬🇧', src: 'mempool', fmt: 2 },
  { id: 'CAD', label: 'Dólar CA',   flag: '🇨🇦', src: 'mempool', fmt: 2 },
  { id: 'ARS', label: 'Peso Arg.',  flag: '🇦🇷', src: 'yadio',   fmt: 0 },
  { id: 'MXN', label: 'Peso Mx.',   flag: '🇲🇽', src: 'yadio',   fmt: 0 },
  { id: 'COP', label: 'Peso Col.',  flag: '🇨🇴', src: 'yadio',   fmt: 0 },
  { id: 'VES', label: 'Bolívar',    flag: '🇻🇪', src: 'yadio',   fmt: 2 },
  { id: 'BRL', label: 'Real',       flag: '🇧🇷', src: 'yadio',   fmt: 2 },
];

let rates = {};
let lastBtc = 1;
let _intervalId = null;

export async function initConverter() {
  buildUI();
  await fetchRates();
  _intervalId = setInterval(fetchRates, REFRESH_MS);
}

export function destroyConverter() {
  if (_intervalId !== null) { clearInterval(_intervalId); _intervalId = null; }
}

// ── Fetch ─────────────────────────────────────────────────────────
async function fetchRates() {
  const [mp, yd] = await Promise.allSettled([
    fetch(MEMPOOL_URL).then(r => r.json()),
    fetch(YADIO_URL).then(r => r.json()),
  ]);

  if (mp.status === 'fulfilled') {
    const d = mp.value;
    ['USD','EUR','GBP','CAD','CHF','AUD','JPY'].forEach(k => { if (d[k]) rates[k] = d[k]; });
  }

  if (yd.status === 'fulfilled') {
    const d   = yd.value;
    const src = d.rates || d.BTC || d;
    ['ARS','MXN','COP','VES','BRL','PEN','CLP'].forEach(k => {
      const v = src[k];
      if (v == null) return;
      rates[k] = typeof v === 'object' ? (v.rate || v.ask || v.bid) : v;
    });
  }

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
        <span class="conv-title">Conversor Bitcoin</span>
        <span class="conv-live-badge">
          <span class="conv-live-dot"></span>en vivo
        </span>
      </div>
      <div class="conv-header-right">
        <span class="conv-rate-pill">1 BTC = <span id="conv-usd-rate" class="conv-rate-value">—</span></span>
      </div>
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
      <span class="conv-sources">mempool.space · yadio.io · P2P rates</span>
    </div>`;

  wireInputs(el);
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
      const val = parseFloat(input.value) || 0;
      let btc   = 0;
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
  setField('conv-btc',  'btc',  skipSrc, btc > 0 ? btc.toFixed(8)           : '');
  setField('conv-sats', 'sats', skipSrc, btc > 0 ? Math.round(btc * 1e8)    : '');

  FIATS.forEach(f => {
    const r = rates[f.id];
    if (!r) return;
    const val = btc * r;
    setField(`conv-${f.id.toLowerCase()}`, f.id.toLowerCase(), skipSrc,
      val > 0 ? fmtFiat(val, f.fmt) : '');
  });
}

function setField(id, src, skipSrc, val) {
  if (src === skipSrc) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.value = val;
  // Flash animation on external update (rate refresh)
  if (skipSrc === null && val) {
    el.classList.remove('conv-flash');
    void el.offsetWidth;
    el.classList.add('conv-flash');
  }
}

// ── Display ───────────────────────────────────────────────────────
function syncRateDisplay() {
  const rateEl = document.getElementById('conv-usd-rate');
  if (rateEl && rates.USD) {
    rateEl.textContent = `$${rates.USD.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  const ts = document.getElementById('conv-ts');
  if (ts) ts.textContent = `Actualizado ${new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`;

  FIATS.forEach(f => {
    const row = document.querySelector(`.conv-fiat-row[data-id="${f.id}"]`);
    if (!row) return;
    const hasRate = !!rates[f.id];
    row.classList.toggle('conv-row-na', !hasRate);
    const input = row.querySelector('input');
    if (input) input.placeholder = hasRate ? '0' : '—';
  });
}

// ── Format ────────────────────────────────────────────────────────
function fmtFiat(val, decimals) {
  if (val === 0) return '';
  const fixed = val.toFixed(decimals);
  const [int, dec] = fixed.split('.');
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec !== undefined ? `${intFmt}.${dec}` : intFmt;
}
