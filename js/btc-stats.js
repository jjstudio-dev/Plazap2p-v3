// btc-stats.js — Bitcoin network stats via mempool.space (no API key required)

import { finiteNumber, fetchJson } from './btc-rates.js';

const API = 'https://mempool.space/api';
const REFRESH_MS = 5 * 60 * 1000;

let _intervalId = null;

export async function initBtcStats() {
  await fetchAndRender();
  // Pausar el refresco con la página oculta (batería/datos en la PWA Android)
  _intervalId = setInterval(() => { if (!document.hidden) fetchAndRender(); }, REFRESH_MS);
}

export function destroyBtcStats() {
  if (_intervalId !== null) { clearInterval(_intervalId); _intervalId = null; }
}

async function fetchAndRender() {
  // fetchJson trata como fallo cualquier respuesta que no sea 2xx: antes, un
  // error 500 con cuerpo JSON se pintaba tal cual ("#[object Object]").
  const [r0, r1, r2, r3, r4] = await Promise.allSettled([
    fetchJson(`${API}/blocks/tip/height`),
    fetchJson(`${API}/v1/prices`),
    fetchJson(`${API}/v1/mining/hashrate/3d`),
    fetchJson(`${API}/v1/fees/recommended`),
    fetchJson(`${API}/mempool`),
  ]);

  // Solo números: un campo con otro tipo se trata como "sin dato".
  const val = (res) => res.status === 'fulfilled' ? res.value : null;
  const blockHeight = finiteNumber(val(r0));
  const priceUsd    = finiteNumber(val(r1)?.USD);
  const hashrate    = finiteNumber(val(r2)?.currentHashrate);
  const difficulty  = finiteNumber(val(r2)?.currentDifficulty);
  const fastestFee  = finiteNumber(val(r3)?.fastestFee);
  const mempoolTxs  = finiteNumber(val(r4)?.count);

  let anyOk = false;
  if (blockHeight != null) { set('stat-block-val',      `#${blockHeight.toLocaleString('es')}`); anyOk = true; }
  if (priceUsd != null)    { set('stat-price-val',      `$${priceUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`); anyOk = true; }
  if (hashrate != null)    { set('stat-hashrate-val',   fmtHashrate(hashrate)); anyOk = true; }
  if (difficulty != null)  { set('stat-difficulty-val', fmtDifficulty(difficulty)); anyOk = true; }
  if (fastestFee != null)  { set('stat-fees-val',       `${fastestFee} sat/vB`); anyOk = true; }
  if (mempoolTxs != null)  { set('stat-mempool-val',    `${mempoolTxs.toLocaleString('es')} txs`); anyOk = true; }

  const ts = document.getElementById('btc-stats-updated');
  if (ts) ts.textContent = anyOk
    ? `Actualizado: ${new Date().toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'})}`
    : 'Error al cargar datos';

  if (anyOk) document.getElementById('btc-stats-bar')?.classList.remove('btc-stats-loading');

  const failed = [r0,r1,r2,r3,r4].filter(r => r.status === 'rejected');
  if (failed.length) console.warn('[btc-stats] partial fetch errors', failed.map(r => r.reason));
}

function set(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = val;
  el.classList.remove('btc-stat-pop');
  void el.offsetWidth; // reflow para reiniciar animación
  el.classList.add('btc-stat-pop');
}

function fmtHashrate(hs) {
  const ehs = hs / 1e18;
  if (ehs >= 1) return `${ehs.toFixed(1)} EH/s`;
  return `${(hs / 1e15).toFixed(1)} PH/s`;
}

function fmtDifficulty(d) {
  const t = d / 1e12;
  return `${t.toFixed(2)} T`;
}
