// btc-stats.js — Bitcoin network stats via mempool.space (no API key required)

const API = 'https://mempool.space/api';
const REFRESH_MS = 5 * 60 * 1000;

let _intervalId = null;

export async function initBtcStats() {
  await fetchAndRender();
  _intervalId = setInterval(fetchAndRender, REFRESH_MS);
}

export function destroyBtcStats() {
  if (_intervalId !== null) { clearInterval(_intervalId); _intervalId = null; }
}

async function fetchAndRender() {
  const [r0, r1, r2, r3, r4] = await Promise.allSettled([
    fetch(`${API}/blocks/tip/height`).then(r => r.json()),
    fetch(`${API}/v1/prices`).then(r => r.json()),
    fetch(`${API}/v1/mining/hashrate/3d`).then(r => r.json()),
    fetch(`${API}/v1/fees/recommended`).then(r => r.json()),
    fetch(`${API}/mempool`).then(r => r.json()),
  ]);

  const val = (res) => res.status === 'fulfilled' ? res.value : null;
  const blockHeight = val(r0);
  const prices      = val(r1);
  const miningInfo  = val(r2);
  const fees        = val(r3);
  const mempool     = val(r4);

  let anyOk = false;
  if (blockHeight != null)        { set('stat-block-val',      `#${blockHeight.toLocaleString('es')}`); anyOk = true; }
  if (prices?.USD != null)        { set('stat-price-val',      `$${prices.USD.toLocaleString('en-US', { maximumFractionDigits: 0 })}`); anyOk = true; }
  if (miningInfo?.currentHashrate != null)   { set('stat-hashrate-val',   fmtHashrate(miningInfo.currentHashrate)); anyOk = true; }
  if (miningInfo?.currentDifficulty != null) { set('stat-difficulty-val', fmtDifficulty(miningInfo.currentDifficulty)); anyOk = true; }
  if (fees?.fastestFee != null)   { set('stat-fees-val',       `${fees.fastestFee} sat/vB`); anyOk = true; }
  if (mempool?.count != null)     { set('stat-mempool-val',    `${mempool.count.toLocaleString('es')} txs`); anyOk = true; }

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
