// mini-converter.js — 2 campos inline en la barra: [BTC/sats] ⇄ [fiat]

import { mergeRates, fetchJson } from './btc-rates.js';

const MEMPOOL_URL  = 'https://mempool.space/api/v1/prices';
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur,usd,cny,chf';
const YADIO_URL    = 'https://api.yadio.io/exrates/BTC';
const REFRESH_MS   = 5 * 60 * 1000;

let _rates = {};        // { EUR, USD, CNY, USDT, USDC, CHF, XAU }
let _leftIsBtc = true;  // false → left field is sats

export async function initMiniConverter() {
  // Los controles primero: no dependen de las tasas. Antes se cableaban
  // DESPUÉS de esperar a las APIs, y con una de ellas colgada el conversor de
  // la cabecera no respondía durante varios segundos.
  wireInputs();
  wireSwap();
  wireCurrencySelect();
  await fetchRates();
  // Pausar el refresco con la página oculta (batería/datos en la PWA Android)
  setInterval(() => { if (!document.hidden) fetchRates(); }, REFRESH_MS);
}

async function fetchRates() {
  const [mp, cg, yd] = await Promise.allSettled([
    fetchJson(MEMPOOL_URL, 6000),
    fetchJson(COINGECKO_URL, 8000),
    fetchJson(YADIO_URL, 8000),
  ]);
  const ok = r => r.status === 'fulfilled' ? r.value : null;
  // Validación y prioridad entre fuentes: ver btc-rates.js
  _rates = mergeRates(_rates, { mempool: ok(mp), coingecko: ok(cg), yadio: ok(yd) }).rates;

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
  } else {
    // Sin importe o sin tasa para esa moneda: vacío, nunca la cifra de la
    // moneda anterior con la etiqueta de la nueva.
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
