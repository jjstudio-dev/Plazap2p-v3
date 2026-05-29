// mini-converter.js — quick BTC/sats/EUR/USD pill in header

const PRICE_URL = 'https://mempool.space/api/v1/prices';
let _rates = {};

export async function initMiniConverter() {
  await fetchPrices();
  setInterval(fetchPrices, 5 * 60 * 1000);
  wirePanel();
}

async function fetchPrices() {
  try {
    const d = await fetch(PRICE_URL).then(r => r.json());
    if (d.EUR) _rates.EUR = d.EUR;
    if (d.USD) _rates.USD = d.USD;
    updateBtnLabel();
    recalc(parseFloat(document.getElementById('mc-btc')?.value) || 1, null);
  } catch {}
}

function updateBtnLabel() {
  const el = document.getElementById('mini-conv-label');
  if (el && _rates.EUR) el.textContent = `₿ ${Math.round(_rates.EUR).toLocaleString('es-ES')} €`;
}

function wirePanel() {
  const btn   = document.getElementById('mini-conv-btn');
  const panel = document.getElementById('mini-conv-panel');
  if (!btn || !panel) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = panel.classList.toggle('mc-open');
    btn.classList.toggle('mc-active', isOpen);
    if (isOpen) document.getElementById('mc-btc')?.focus();
  });

  document.addEventListener('click', e => {
    if (!document.getElementById('mini-conv-wrap')?.contains(e.target)) {
      panel.classList.remove('mc-open');
      btn.classList.remove('mc-active');
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      panel.classList.remove('mc-open');
      btn.classList.remove('mc-active');
    }
  });

  ['mc-btc', 'mc-sats', 'mc-eur', 'mc-usd'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', e => {
      const val = parseFloat(e.target.value) || 0;
      let btc = 0;
      if      (id === 'mc-btc')  btc = val;
      else if (id === 'mc-sats') btc = val / 1e8;
      else if (id === 'mc-eur')  btc = _rates.EUR ? val / _rates.EUR : 0;
      else if (id === 'mc-usd')  btc = _rates.USD ? val / _rates.USD : 0;
      recalc(btc, id);
    });
  });
}

function recalc(btc, skip) {
  const set = (id, val) => {
    if (id === skip) return;
    const el = document.getElementById(id);
    if (el) el.value = val;
  };
  set('mc-btc',  btc > 0 ? btc.toFixed(8) : '');
  set('mc-sats', btc > 0 ? Math.round(btc * 1e8) : '');
  if (_rates.EUR) set('mc-eur', btc > 0 ? Math.round(btc * _rates.EUR) : '');
  if (_rates.USD) set('mc-usd', btc > 0 ? Math.round(btc * _rates.USD) : '');
}
