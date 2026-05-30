// mini-converter.js — 2 campos inline en la barra: [BTC/sats] ⇄ [fiat]

const MEMPOOL_URL  = 'https://mempool.space/api/v1/prices';
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur,usd,cny,chf';
const YADIO_URL    = 'https://api.yadio.io/exrates/BTC';
const REFRESH_MS   = 5 * 60 * 1000;

let _rates = {};        // { EUR, USD, CNY, USDT, USDC, CHF, XAU }
let _leftIsBtc = true;  // false → left field is sats

function withTimeout(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(ms) };
  }
  return {};
}

export async function initMiniConverter() {
  await fetchRates();
  setInterval(fetchRates, REFRESH_MS);
  wireInputs();
  wireSwap();
  wireCurrencySelect();
}

async function fetchRates() {
  // Primary: mempool.space (fastest, no auth)
  let mp;
  let cg;
  let yd;
  try {
    [mp, cg, yd] = await Promise.allSettled([
      fetch(MEMPOOL_URL, withTimeout(6000)).then(r => r.json()),
      fetch(COINGECKO_URL, withTimeout(8000)).then(r => r.json()),
      fetch(YADIO_URL, withTimeout(8000)).then(r => r.json()),
    ]);
  } catch {
    mp = { status: 'rejected' };
    cg = { status: 'rejected' };
    yd = { status: 'rejected' };
  }

  if (mp.status === 'fulfilled') {
    const d = mp.value;
    if (d.EUR) _rates.EUR = d.EUR;
    if (d.USD) _rates.USD = d.USD;
    if (d.CHF) _rates.CHF = d.CHF;
  }

  // CoinGecko as fallback for any missing rate
  if (cg.status === 'fulfilled') {
    const d = cg.value?.bitcoin || {};
    if (!_rates.EUR && d.eur) _rates.EUR = d.eur;
    if (!_rates.USD && d.usd) _rates.USD = d.usd;
    if (!_rates.CNY && d.cny) _rates.CNY = d.cny;
    if (!_rates.CHF && d.chf) _rates.CHF = d.chf;
  }

  // yadio for CNY and XAU
  if (yd.status === 'fulfilled') {
    const d   = yd.value;
    const src = d.rates || d.BTC || d;
    const cny = src['CNY'];
    if (cny != null && !_rates.CNY) {
      _rates.CNY = typeof cny === 'object' ? (cny.rate || cny.ask || cny.bid) : cny;
    }
    const xau = src['XAU'];
    if (xau != null && !_rates.XAU) {
      _rates.XAU = typeof xau === 'object' ? (xau.rate || xau.ask || xau.bid) : xau;
    }
  }

  if (_rates.USD) {
    _rates.USDT = _rates.USD;
    _rates.USDC = _rates.USD;
  }

  updatePriceBadge();
  recalcFromLeft();
}

function wireInputs() {
  const left  = document.getElementById('hc-left');
  const right = document.getElementById('hc-right');
  if (!left || !right) return;

  left.addEventListener('input', () => recalcFromLeft());
  right.addEventListener('input', () => recalcFromRight());
}

function wireSwap() {
  const btn  = document.getElementById('hc-swap');
  const lbl  = document.getElementById('hc-left-lbl');
  if (!btn || !lbl) return;

  btn.addEventListener('click', () => {
    _leftIsBtc = !_leftIsBtc;
    lbl.textContent = _leftIsBtc ? 'BTC' : 'sats';
    const left  = document.getElementById('hc-left');
    const right = document.getElementById('hc-right');
    if (!left || !right) return;
    // Swap values and recalc
    const btc = getBtcFromLeft();
    left.value  = _leftIsBtc ? (btc > 0 ? btc.toFixed(8) : '') : (btc > 0 ? Math.round(btc * 1e8) : '');
    recalcFromLeft();
  });
}

function wireCurrencySelect() {
  const sel = document.getElementById('hc-right-cur');
  if (!sel) return;
  sel.addEventListener('change', () => recalcFromLeft());
}

function getBtcFromLeft() {
  const left = document.getElementById('hc-left');
  const raw  = (left?.value || '').replace(',', '.');
  const val  = Number(raw);
  if (!Number.isFinite(val) || val < 0) return 0;
  return _leftIsBtc ? val : val / 1e8;
}

function recalcFromLeft() {
  const btc   = getBtcFromLeft();
  const cur   = document.getElementById('hc-right-cur')?.value || 'EUR';
  const rate  = _rates[cur];
  const right = document.getElementById('hc-right');
  if (!right) return;
  if (rate && btc > 0) {
    const decimals = cur === 'XAU' ? 6 : 2;
    right.value = (btc * rate).toFixed(decimals);
  } else if (btc === 0) {
    right.value = '';
  }
  updatePriceBadge();
}

function recalcFromRight() {
  const right = document.getElementById('hc-right');
  const raw   = (right?.value || '').replace(',', '.');
  const val   = Number(raw);
  if (!Number.isFinite(val) || val < 0) return;
  const cur   = document.getElementById('hc-right-cur')?.value || 'EUR';
  const rate  = _rates[cur];
  const left  = document.getElementById('hc-left');
  if (!left || !rate) return;
  const btc = val / rate;
  left.value = _leftIsBtc
    ? (btc > 0 ? btc.toFixed(8) : '')
    : (btc > 0 ? Math.round(btc * 1e8) : '');
}

function updatePriceBadge() {
  const el = document.getElementById('hc-price');
  if (el && _rates.EUR) {
    el.textContent = `₿ ${Math.round(_rates.EUR).toLocaleString('es-ES')} €`;
  }
}
