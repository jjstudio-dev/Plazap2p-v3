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
  try {
    const [blockHeight, prices, miningInfo, fees, mempool] = await Promise.all([
      fetch(`${API}/blocks/tip/height`).then(r => r.json()),
      fetch(`${API}/v1/prices`).then(r => r.json()),
      fetch(`${API}/v1/mining/hashrate/3d`).then(r => r.json()),
      fetch(`${API}/v1/fees/recommended`).then(r => r.json()),
      fetch(`${API}/mempool`).then(r => r.json()),
    ]);

    set('stat-block-val',     `#${blockHeight.toLocaleString('es')}`);
    set('stat-price-val',     `$${prices.USD.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
    set('stat-hashrate-val',  fmtHashrate(miningInfo.currentHashrate));
    set('stat-difficulty-val',fmtDifficulty(miningInfo.currentDifficulty));
    set('stat-fees-val',      `${fees.fastestFee} sat/vB`);
    set('stat-mempool-val',   `${mempool.count.toLocaleString('es')} txs`);

    const ts = document.getElementById('btc-stats-updated');
    if (ts) ts.textContent = `Actualizado: ${new Date().toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'})}`;

    document.getElementById('btc-stats-bar')?.classList.remove('btc-stats-loading');
  } catch (e) {
    console.warn('[btc-stats] fetch error', e);
    const ts = document.getElementById('btc-stats-updated');
    if (ts) ts.textContent = 'Error al cargar datos';
  }
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
