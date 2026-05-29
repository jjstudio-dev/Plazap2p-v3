// btc-chart.js — BTC 30-day price chart · pure SVG · no dependencies
// Primary: CoinGecko  Fallback: Kraken public API

const CACHE_KEY = 'plazap2p_chart_v2';
const CACHE_TTL = 15 * 60 * 1000;

const SOURCES = {
  coingecko: 'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=30&interval=daily',
  kraken:    'https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440',
};

// ── Entry point ───────────────────────────────────────────────────
export async function initPriceChart() {
  await fetchAndRender();
}

async function fetchAndRender() {
  const container = document.getElementById('btc-price-chart');
  if (!container) return;

  try {
    const cached = sessionCacheGet(CACHE_KEY);
    let prices, volumes;

    if (cached) {
      ({ prices, volumes } = cached);
    } else {
      ({ prices, volumes } = await fetchPrices());
      sessionCacheSet(CACHE_KEY, { prices, volumes });
    }

    render(container, prices, volumes);
  } catch (e) {
    console.warn('[btc-chart]', e.message);
    container.innerHTML = `<div class="chart-error">
      Sin datos históricos disponibles ·
      <a href="https://mempool.space/graphs/price/btc-usd" target="_blank" rel="noopener">Ver en mempool.space ↗</a>
    </div>`;
  }
}

async function fetchPrices() {
  // Try CoinGecko first
  try {
    const r = await fetch(SOURCES.coingecko, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
    const d = await r.json();
    if (!d.prices?.length) throw new Error('empty');
    return { prices: d.prices.slice(-31), volumes: d.total_volumes.slice(-31) };
  } catch (e) {
    console.warn('[btc-chart] CoinGecko failed, trying Kraken…', e.message);
  }

  // Fallback: Kraken OHLC (daily, last 30 candles)
  const r = await fetch(SOURCES.kraken, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Kraken ${r.status}`);
  const d = await r.json();
  const candles = Object.values(d.result).find(Array.isArray)?.slice(-31) || [];
  if (!candles.length) throw new Error('Kraken empty');
  const prices  = candles.map(c => [c[0] * 1000, parseFloat(c[4])]);   // close
  const volumes = candles.map(c => [c[0] * 1000, parseFloat(c[6])]);
  return { prices, volumes };
}

// ── Render ────────────────────────────────────────────────────────
function render(container, rawPrices, rawVols) {
  const n      = Math.min(rawPrices.length, (rawVols?.length || 0) || rawPrices.length, 31);
  const prices = rawPrices.slice(-n);
  const vols   = (rawVols || []).slice(-n);

  // Layout constants
  const W     = 800;
  const CH    = 310;   // chart area height
  const VH    = 46;    // volume area height
  const GAP   = 10;    // gap between chart and volumes
  const TOTAL = CH + GAP + VH;
  const P     = { t: 24, r: 84, b: 36, l: 12 };  // padding
  const cW    = W - P.l - P.r;
  const cH    = CH - P.t - P.b;

  // Scales
  const vals  = prices.map(p => p[1]);
  const vVals = vols.map(v => v[1]);
  const minP  = Math.min(...vals) * 0.996;
  const maxP  = Math.max(...vals) * 1.004;
  const maxV  = Math.max(...vVals) || 1;

  const xS = i => P.l + (i / (prices.length - 1)) * cW;
  const yS = v => P.t + (1 - (v - minP) / (maxP - minP)) * cH;
  const yV = v => CH + GAP + VH * (1 - v / maxV);

  const isUp      = vals.at(-1) >= vals[0];
  const lineClr   = isUp ? '#30d158' : '#ff453a';
  const pct       = (vals.at(-1) - vals[0]) / vals[0] * 100;
  const high30    = Math.max(...vals);
  const low30     = Math.min(...vals);
  const highIdx   = vals.indexOf(high30);
  const lowIdx    = vals.indexOf(low30);
  const gId       = `g${Math.random().toString(36).slice(2, 6)}`;

  // ── Paths ──
  const pts      = prices.map((p, i) => `${xS(i).toFixed(1)},${yS(p[1]).toFixed(1)}`);
  const linePath = `M ${pts.join(' L ')}`;
  const clipB    = (CH - P.b).toFixed(1);
  const areaPath = `M ${xS(0).toFixed(1)},${clipB} L ${pts.join(' L ')} L ${xS(prices.length - 1).toFixed(1)},${clipB} Z`;

  // ── Grid (5 levels) ──
  const LEVELS = 5;
  const gridLines = [], yLabels = [];
  for (let i = 0; i <= LEVELS; i++) {
    const v = minP + (maxP - minP) * (i / LEVELS);
    const y = yS(v).toFixed(1);
    gridLines.push(`<line x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}" stroke="rgba(255,255,255,0.055)" stroke-width="1"/>`);
    yLabels.push(`<text x="${W - P.r + 6}" y="${y}" fill="#606068" font-size="9.5" dominant-baseline="middle" font-family="'Share Tech Mono',monospace">${fmtPrice(v)}</text>`);
  }

  // ── X-axis date labels ──
  const dateIdxs = [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor(n * 3 / 4), n - 1];
  const xLabels  = dateIdxs.map(idx => {
    const d = new Date(prices[idx][0]);
    const lbl = d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
    return `<text x="${xS(idx).toFixed(1)}" y="${(CH - P.b + 14).toFixed(1)}" fill="#505058" font-size="9.5" text-anchor="middle" font-family="'Share Tech Mono',monospace">${lbl}</text>`;
  });

  // ── Volume bars (colored: green if close > open, else red) ──
  const bW = Math.max(3, (cW / n) * 0.68);
  const volBars = vols.map((v, i) => {
    const h    = ((v[1] / maxV) * VH).toFixed(1);
    const bx   = (xS(i) - bW / 2).toFixed(1);
    const by   = yV(v[1]).toFixed(1);
    // Daily direction: use price comparison (i>0 ? current vs prev)
    const dir  = i === 0 || prices[i][1] >= prices[i - 1][1];
    const clr  = dir ? 'rgba(48,209,88,0.22)' : 'rgba(255,69,58,0.22)';
    return `<rect x="${bx}" y="${by}" width="${bW.toFixed(1)}" height="${h}" fill="${clr}" rx="1"/>`;
  }).join('');

  // ── High / Low markers ──
  const highY = yS(high30);
  const lowY  = yS(low30);
  const highX = xS(highIdx);
  const lowX  = xS(lowIdx);
  const highMarker = `
    <circle cx="${highX.toFixed(1)}" cy="${highY.toFixed(1)}" r="3" fill="#30d158" opacity="0.8"/>
    <line x1="${highX.toFixed(1)}" y1="${highY.toFixed(1)}" x2="${(W - P.r - 2).toFixed(1)}" y2="${highY.toFixed(1)}" stroke="rgba(48,209,88,0.18)" stroke-width="0.8" stroke-dasharray="2,3"/>
    <text x="${W - P.r + 6}" y="${highY.toFixed(1)}" fill="#30d158" font-size="8" dominant-baseline="middle" font-family="'Share Tech Mono',monospace">H</text>`;
  const lowMarker = `
    <circle cx="${lowX.toFixed(1)}" cy="${lowY.toFixed(1)}" r="3" fill="#ff453a" opacity="0.8"/>
    <line x1="${lowX.toFixed(1)}" y1="${lowY.toFixed(1)}" x2="${(W - P.r - 2).toFixed(1)}" y2="${lowY.toFixed(1)}" stroke="rgba(255,69,58,0.18)" stroke-width="0.8" stroke-dasharray="2,3"/>
    <text x="${W - P.r + 6}" y="${lowY.toFixed(1)}" fill="#ff453a" font-size="8" dominant-baseline="middle" font-family="'Share Tech Mono',monospace">L</text>`;

  // ── Current price badge ──
  const lastY = yS(vals.at(-1));
  const badge = `
    <line x1="${P.l}" y1="${lastY.toFixed(1)}" x2="${(W - P.r).toFixed(1)}" y2="${lastY.toFixed(1)}" stroke="${lineClr}" stroke-width="0.8" stroke-dasharray="3,3" opacity="0.5"/>
    <rect x="${W - P.r + 2}" y="${(lastY - 9).toFixed(1)}" width="${P.r - 4}" height="18" fill="${lineClr}" rx="3"/>
    <text x="${(W - P.r + P.r / 2 - 1).toFixed(1)}" y="${lastY.toFixed(1)}" fill="#000" font-size="9" dominant-baseline="middle" text-anchor="middle" font-family="'Share Tech Mono',monospace" font-weight="700">${fmtPrice(vals.at(-1))}</text>`;

  // ── Axis borders ──
  const axisBorder = `
    <line x1="${P.l}" y1="${P.t}" x2="${P.l}" y2="${(CH - P.b).toFixed(1)}" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
    <line x1="${P.l}" y1="${(CH - P.b).toFixed(1)}" x2="${(W - P.r).toFixed(1)}" y2="${(CH - P.b).toFixed(1)}" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>`;

  const svg = `
    <svg id="chart-svg-${gId}" viewBox="0 0 ${W} ${TOTAL}" style="width:100%;height:auto;display:block" role="img" aria-label="Precio BTC 30 días">
      <defs>
        <linearGradient id="${gId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="${lineClr}" stop-opacity="0.25"/>
          <stop offset="75%"  stop-color="${lineClr}" stop-opacity="0.04"/>
          <stop offset="100%" stop-color="${lineClr}" stop-opacity="0"/>
        </linearGradient>
        <clipPath id="c-${gId}">
          <rect x="${P.l}" y="${P.t}" width="${cW}" height="${cH + 1}"/>
        </clipPath>
      </defs>
      ${gridLines.join('')}
      ${axisBorder}
      <path d="${areaPath}" fill="url(#${gId})" clip-path="url(#c-${gId})"/>
      <path id="line-${gId}" class="chart-line-path" d="${linePath}" fill="none" stroke="${lineClr}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" clip-path="url(#c-${gId})"/>
      ${highMarker}
      ${lowMarker}
      ${badge}
      ${volBars}
      ${yLabels.join('')}
      ${xLabels.join('')}
      <!-- Hover overlay -->
      <rect id="hz-${gId}" x="${P.l}" y="${P.t}" width="${cW}" height="${TOTAL - P.t}" fill="transparent" style="cursor:crosshair"/>
      <line id="vl-${gId}" x1="0" y1="${P.t}" x2="0" y2="${(CH - P.b).toFixed(1)}" stroke="rgba(255,255,255,0.22)" stroke-width="1" stroke-dasharray="4,3" display="none"/>
      <circle id="dot-${gId}" r="5" fill="${lineClr}" stroke="#07070c" stroke-width="2.5" display="none"/>
      <g id="tip-${gId}" display="none">
        <rect id="tip-bg-${gId}" rx="6" fill="#0f0f1a" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
        <text id="tip-p-${gId}"  fill="#f5f5f7" font-size="12" font-family="'Share Tech Mono',monospace" font-weight="700"/>
        <text id="tip-d-${gId}"  fill="#86868b" font-size="9.5" font-family="'Share Tech Mono',monospace"/>
        <text id="tip-c-${gId}"  font-size="9.5" font-family="'Share Tech Mono',monospace"/>
      </g>
    </svg>`;

  container.innerHTML = svg;
  animateLine(gId);
  wireHover(container, gId, prices, vals, xS, yS, P, lineClr, cW, W, TOTAL);
  updateHeader(vals, pct, high30, low30);
}

// ── Draw-in animation ─────────────────────────────────────────────
function animateLine(gId) {
  const path = document.getElementById(`line-${gId}`);
  if (!path) return;
  const len = path.getTotalLength();
  path.style.strokeDasharray  = len;
  path.style.strokeDashoffset = len;
  requestAnimationFrame(() => {
    path.style.transition = 'stroke-dashoffset 1.4s cubic-bezier(0.4, 0, 0.2, 1)';
    path.style.strokeDashoffset = '0';
  });
}

// ── Hover interaction ─────────────────────────────────────────────
function wireHover(container, gId, prices, vals, xS, yS, P, lineClr, cW, W, TOTAL) {
  const svgEl = container.querySelector('svg');
  const hz    = document.getElementById(`hz-${gId}`);
  const vl    = document.getElementById(`vl-${gId}`);
  const dot   = document.getElementById(`dot-${gId}`);
  const tip   = document.getElementById(`tip-${gId}`);
  const tipBg = document.getElementById(`tip-bg-${gId}`);
  const tipP  = document.getElementById(`tip-p-${gId}`);
  const tipD  = document.getElementById(`tip-d-${gId}`);
  const tipC  = document.getElementById(`tip-c-${gId}`);
  if (!hz) return;

  const getIdx = (e) => {
    const rect  = svgEl.getBoundingClientRect();
    const vbW   = svgEl.viewBox.baseVal.width;
    const mouseX = (e.clientX - rect.left) * (vbW / rect.width);
    const t     = Math.max(0, Math.min(1, (mouseX - P.l) / cW));
    return Math.round(t * (prices.length - 1));
  };

  const show = (e) => {
    const idx    = getIdx(e);
    const price  = vals[idx];
    const startP = vals[0];
    const delta  = (price - startP) / startP * 100;
    const cx     = xS(idx);
    const cy     = yS(price);

    vl.setAttribute('x1', cx.toFixed(1)); vl.setAttribute('x2', cx.toFixed(1)); vl.removeAttribute('display');
    dot.setAttribute('cx', cx.toFixed(1)); dot.setAttribute('cy', cy.toFixed(1)); dot.removeAttribute('display');

    const priceStr = `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    const dateStr  = new Date(prices[idx][0]).toLocaleDateString('es', { day: 'numeric', month: 'short', year: '2-digit' });
    const deltaStr = `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%`;
    const deltaClr = delta >= 0 ? '#30d158' : '#ff453a';

    tipP.textContent = priceStr;
    tipD.textContent = dateStr;
    tipC.textContent = deltaStr;
    tipC.setAttribute('fill', deltaClr);

    const tW = 130, tH = 54;
    // X: prefer right, flip to left near edge
    const tX = cx + 12 + tW > W - P.r ? cx - tW - 12 : cx + 12;
    // Y: clamp within chart area
    const tY = Math.max(P.t, Math.min(cy - tH / 2, TOTAL - tH - 8));

    tipBg.setAttribute('x', tX.toFixed(1)); tipBg.setAttribute('y', tY.toFixed(1));
    tipBg.setAttribute('width', tW); tipBg.setAttribute('height', tH);
    tipP.setAttribute('x', (tX + 10).toFixed(1)); tipP.setAttribute('y', (tY + 17).toFixed(1));
    tipD.setAttribute('x', (tX + 10).toFixed(1)); tipD.setAttribute('y', (tY + 31).toFixed(1));
    tipC.setAttribute('x', (tX + 10).toFixed(1)); tipC.setAttribute('y', (tY + 44).toFixed(1));
    tip.removeAttribute('display');
  };

  const hide = () => {
    vl.setAttribute('display', 'none');
    dot.setAttribute('display', 'none');
    tip.setAttribute('display', 'none');
  };

  hz.addEventListener('mousemove', show);
  hz.addEventListener('mouseleave', hide);
  hz.addEventListener('touchmove', e => { e.preventDefault(); show(e.touches[0]); }, { passive: false });
  hz.addEventListener('touchend', hide);
}

// ── Header update ─────────────────────────────────────────────────
function updateHeader(vals, pct, high30, low30) {
  const priceEl = document.getElementById('chart-current-price');
  const pctEl   = document.getElementById('chart-pct-change');
  const highEl  = document.getElementById('chart-high');
  const lowEl   = document.getElementById('chart-low');

  if (priceEl) priceEl.textContent = `$${vals.at(-1).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (pctEl)  { pctEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`; pctEl.className = `chart-pct ${pct >= 0 ? 'up' : 'down'}`; }
  if (highEl)  highEl.textContent = `$${high30.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (lowEl)   lowEl.textContent  = `$${low30.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

// ── Helpers ───────────────────────────────────────────────────────
function fmtPrice(n) {
  if (n >= 100000) return `$${(n / 1000).toFixed(0)}K`;
  if (n >= 10000)  return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function sessionCacheGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    return Date.now() - ts < CACHE_TTL ? data : null;
  } catch { return null; }
}

function sessionCacheSet(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}
