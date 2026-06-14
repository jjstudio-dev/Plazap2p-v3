// btc-market.js — Fear & Greed, market cap, volumen, supply, ATH, halving, Lightning, hashrate
// Fuentes: alternative.me · CoinGecko · mempool.space

const FNG_URL    = 'https://api.alternative.me/fng/?limit=1';
const CGK_URL    = 'https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&market_data=true&community_data=true&developer_data=false';
const GLOBAL_URL = 'https://api.coingecko.com/api/v3/global';
const MEMPOOL    = 'https://mempool.space/api';
const REFRESH_MS = 15 * 60 * 1000;

export async function initBtcMarket() {
  await fetchAndRender();
  setInterval(fetchAndRender, REFRESH_MS);
}

async function fetchAndRender() {
  const el = document.getElementById('btc-market-data');
  if (!el) return;

  const [fng, cgk, glb, prices, blockH, lightning, hashrate, diffAdj] = await Promise.allSettled([
    fetchJson(FNG_URL,                                     8000),
    fetchJson(CGK_URL,                                     10000),
    fetchJson(GLOBAL_URL,                                  8000),
    fetchJson(`${MEMPOOL}/v1/prices`,                      6000),
    fetchJson(`${MEMPOOL}/blocks/tip/height`,              6000),
    fetchJson(`${MEMPOOL}/v1/lightning/statistics/latest`, 8000),
    fetchJson(`${MEMPOOL}/v1/mining/hashrate/6m`,          8000),
    fetchJson(`${MEMPOOL}/v1/difficulty-adjustment`,       6000),
  ]);

  const fngData   = fng.status      === 'fulfilled' ? fng.value?.data?.[0]                       : null;
  const fallback  = prices.status   === 'fulfilled' ? marketFromMempoolPrices(prices.value)       : null;
  const mkt       = cgk.status      === 'fulfilled' ? cgk.value?.market_data || fallback          : fallback;
  const sentUp    = cgk.status      === 'fulfilled' ? cgk.value?.sentiment_votes_up_percentage    : null;
  const dominance = glb.status      === 'fulfilled' ? glb.value?.data?.market_cap_percentage?.btc : null;
  const blockNum  = blockH.status   === 'fulfilled' ? blockH.value                                : null;
  const ln        = lightning.status=== 'fulfilled' ? lightning.value?.latest                     : null;
  const hrData    = hashrate.status === 'fulfilled' ? hashrate.value                              : null;
  const diff      = diffAdj.status  === 'fulfilled' ? diffAdj.value                               : null;

  el.innerHTML = buildHTML(fngData, mkt, sentUp, dominance, blockNum, ln, hrData, diff);
}

async function fetchJson(url, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

function marketFromMempoolPrices(prices) {
  if (!prices?.EUR && !prices?.USD) return null;
  return {
    current_price: {
      eur: prices.EUR || null,
      usd: prices.USD || null
    }
  };
}

// ── Layout ────────────────────────────────────────────────────────────
function buildHTML(fng, mkt, sentUp, dominance, blockNum, ln, hrData, diff) {
  const ts = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  return `
    <div class="bm-grid">
      ${fng ? fearGreedCard(fng) : ''}
      <div class="bm-right">
        ${mkt ? statsGrid(mkt, dominance) : ''}
        ${sentUp != null ? sentimentCard(sentUp) : ''}
        ${mkt ? athCard(mkt) : ''}
      </div>
    </div>

    ${hashrateSection(hrData, diff)}
    ${blockNum != null ? halvingCard(blockNum) : ''}
    ${ln ? lightningCard(ln) : ''}

    <p class="bm-source">
      <a href="https://alternative.me/crypto/fear-and-greed-index/" target="_blank" rel="noopener">Alternative.me</a>
      · <a href="https://www.coingecko.com" target="_blank" rel="noopener">CoinGecko</a>
      · <a href="https://mempool.space" target="_blank" rel="noopener">mempool.space</a>
      · ${ts}
    </p>`;
}

// ── Fear & Greed ──────────────────────────────────────────────────────
function fearGreedCard(fng) {
  const val    = parseInt(fng.value, 10);
  const color  = fngColor(val);
  const esLbl  = fearLabel(val);
  const r      = 46;
  const arcLen = Math.PI * r;
  const dashOff = (arcLen - (val / 100) * arcLen).toFixed(2);
  const rad    = ((-180 + (val / 100) * 180) * Math.PI) / 180;
  const nx     = (60 + 34 * Math.cos(rad)).toFixed(1);
  const ny     = (60 + 34 * Math.sin(rad)).toFixed(1);

  const ticks = [25, 50, 75].map(t => {
    const a  = ((-180 + (t / 100) * 180) * Math.PI) / 180;
    const ox = (60 + (r + 4) * Math.cos(a)).toFixed(1);
    const oy = (60 + (r + 4) * Math.sin(a)).toFixed(1);
    const ix = (60 + (r - 8) * Math.cos(a)).toFixed(1);
    const iy = (60 + (r - 8) * Math.sin(a)).toFixed(1);
    return `<line x1="${ox}" y1="${oy}" x2="${ix}" y2="${iy}" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"/>`;
  }).join('');

  const dots = [0, 25, 50, 75, 100].map(t => {
    const a  = ((-180 + (t / 100) * 180) * Math.PI) / 180;
    const dx = (60 + (r + 9) * Math.cos(a)).toFixed(1);
    const dy = (60 + (r + 9) * Math.sin(a)).toFixed(1);
    return `<circle cx="${dx}" cy="${dy}" r="2" fill="rgba(255,255,255,0.25)"/>`;
  }).join('');

  return `
    <div class="fng-card">
      <div class="fng-header">
        <span class="fng-title">Fear &amp; Greed</span>
        <span class="fng-badge" style="background:${color}18;color:${color};border-color:${color}40">${esLbl}</span>
      </div>
      <svg class="fng-svg" viewBox="0 0 120 72" aria-label="Fear &amp; Greed: ${val}">
        <path d="M 14 60 A ${r} ${r} 0 0 1 37.5 19.1" fill="none" stroke="#ff453a" stroke-width="10" stroke-linecap="butt" opacity="0.18"/>
        <path d="M 37.5 19.1 A ${r} ${r} 0 0 1 60 14"  fill="none" stroke="#ff9f0a" stroke-width="10" stroke-linecap="butt" opacity="0.18"/>
        <path d="M 60 14 A ${r} ${r} 0 0 1 82.5 19.1"  fill="none" stroke="#ffd60a" stroke-width="10" stroke-linecap="butt" opacity="0.18"/>
        <path d="M 82.5 19.1 A ${r} ${r} 0 0 1 106 60" fill="none" stroke="#30d158" stroke-width="10" stroke-linecap="butt" opacity="0.18"/>
        <path d="M 14 60 A ${r} ${r} 0 0 1 106 60"
              fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"
              stroke-dasharray="${arcLen.toFixed(2)}" stroke-dashoffset="${dashOff}"
              style="transition:stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1),stroke 0.4s"/>
        ${ticks}${dots}
        <line x1="60" y1="60" x2="${nx}" y2="${ny}" stroke="rgba(0,0,0,0.4)" stroke-width="3.5" stroke-linecap="round" transform="translate(0.5,0.5)"/>
        <line x1="60" y1="60" x2="${nx}" y2="${ny}" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="60" cy="60" r="5" fill="${color}" stroke="white" stroke-width="1.5"/>
        <circle cx="60" cy="60" r="2" fill="white"/>
        <text x="60" y="52" text-anchor="middle" dominant-baseline="middle"
              font-family="Orbitron,sans-serif" font-size="20" font-weight="800"
              fill="${color}" opacity="0.95">${val}</text>
      </svg>
      <div class="fng-scale">
        <span style="color:#ff453a">Miedo<br>extremo</span>
        <span style="color:#ff9f0a">Miedo</span>
        <span style="color:#ffd60a">Neutral</span>
        <span style="color:#30d158">Codicia</span>
        <span style="color:#32d74b">Codicia<br>extrema</span>
      </div>
    </div>`;
}

// ── Stats grid ────────────────────────────────────────────────────────
function statsGrid(mkt, dominance) {
  const priceEur = mkt.current_price?.eur;
  const priceUsd = mkt.current_price?.usd;
  const mcEur    = mkt.market_cap?.eur;
  const mcUsd    = mkt.market_cap?.usd;
  const vol      = mkt.total_volume?.eur;
  const supply   = mkt.circulating_supply;
  const maxSup   = mkt.max_supply;
  const pct24h   = mkt.price_change_percentage_24h;
  const pct7d    = mkt.price_change_percentage_7d;
  const pct30d   = mkt.price_change_percentage_30d;
  const pct1y    = mkt.price_change_percentage_1y;
  const high24   = mkt.high_24h?.eur;
  const low24    = mkt.low_24h?.eur;
  const minedPct = (supply && maxSup) ? ((supply / maxSup) * 100).toFixed(1) : null;

  const sign24  = pct24h != null ? (pct24h >= 0 ? 'pos' : 'neg') : '';
  const acc24   = pct24h != null ? (pct24h >= 0 ? '#30d158' : '#ff453a') : 'var(--btc)';
  const arrow24 = pct24h != null ? (pct24h >= 0 ? '▲' : '▼') : '';
  const sign1y  = pct1y  != null ? (pct1y  >= 0 ? 'pos' : 'neg') : '';
  const acc1y   = pct1y  != null ? (pct1y  >= 0 ? '#30d158' : '#ff453a') : 'var(--btc)';
  const arrow1y = pct1y  != null ? (pct1y  >= 0 ? '▲' : '▼') : '';
  const domStr  = dominance != null ? `${dominance.toFixed(1)}%` : '—';

  const pctBadge = pct24h != null
    ? `<span class="bm-price-pct ${sign24}">${pct24h > 0 ? '+' : ''}${pct24h.toFixed(2)}%</span>`
    : '';

  const rangeSub = (high24 && low24)
    ? `Máx. día €${Math.round(high24).toLocaleString('es-ES')} · Mín. €${Math.round(low24).toLocaleString('es-ES')}`
    : null;

  // Variaciones: 24h / 7d / 30d
  const varParts = [
    pct24h != null ? `<span class="${sign24}">${pct24h > 0 ? '+' : ''}${pct24h.toFixed(2)}%</span> 24h` : null,
    pct7d  != null ? `<span class="${pct7d >= 0 ? 'pos' : 'neg'}">${pct7d > 0 ? '+' : ''}${pct7d.toFixed(2)}%</span> 7d` : null,
    pct30d != null ? `<span class="${pct30d >= 0 ? 'pos' : 'neg'}">${pct30d > 0 ? '+' : ''}${pct30d.toFixed(2)}%</span> 30d` : null,
  ].filter(Boolean);

  return `
    <div class="bm-stats-grid">

      <div class="bm-metric-card bm-metric-featured" style="--mc-accent:var(--btc)">
        <div class="bm-metric-top">
          <span class="bm-metric-icon" style="color:var(--btc)">₿</span>
          <span class="bm-metric-label">Precio actual</span>
          <span class="bm-rank-badge">Rank #1</span>
        </div>
        <span class="bm-metric-value">${priceEur ? `€${Math.round(priceEur).toLocaleString('es-ES')}` : '—'} ${pctBadge}</span>
        ${priceUsd ? `<span class="bm-metric-sub">≈ $${Math.round(priceUsd).toLocaleString('en-US')}</span>` : ''}
        ${rangeSub  ? `<span class="bm-metric-sub bm-range-sub">${rangeSub}</span>` : ''}
      </div>

      <div class="bm-metric-card" style="--mc-accent:var(--btc)">
        <div class="bm-metric-top">
          <span class="bm-metric-icon" style="color:var(--btc)">◈</span>
          <span class="bm-metric-label">Capitalización</span>
        </div>
        <span class="bm-metric-value">${mcEur ? fmtBig(mcEur) : '—'}</span>
        <span class="bm-metric-sub">Valor total de todos los BTC</span>
        ${mcUsd ? `<span class="bm-metric-sub">$${fmtBig(mcUsd)}</span>` : ''}
      </div>

      <div class="bm-metric-card" style="--mc-accent:#00d4ff">
        <div class="bm-metric-top">
          <span class="bm-metric-icon" style="color:#00d4ff">◎</span>
          <span class="bm-metric-label">Volumen 24 horas</span>
        </div>
        <span class="bm-metric-value">${vol ? `€${fmtBig(vol)}` : '—'}</span>
        <span class="bm-metric-sub">Total de Bitcoin comprado y vendido en exchanges en las últimas 24 horas</span>
        ${vol && vol >= 1e9 ? `<span class="bm-metric-sub" style="opacity:0.55;font-size:0.78em">1 mil millones = 1.000 millones de €</span>` : ''}
      </div>

      <div class="bm-metric-card" style="--mc-accent:#bf5af2">
        <div class="bm-metric-top">
          <span class="bm-metric-icon" style="color:#bf5af2">⛏</span>
          <span class="bm-metric-label">Supply en circulación</span>
        </div>
        <span class="bm-metric-value">${supply ? fmtBig(supply) + ' ₿' : '—'}</span>
        <span class="bm-metric-sub">
          ${minedPct ? `${minedPct}% del máximo de 21 millones minado` : 'Máximo: 21 millones de BTC'}
        </span>
      </div>

      <div class="bm-metric-card" style="--mc-accent:${acc24}">
        <div class="bm-metric-top">
          <span class="bm-metric-icon" style="color:${acc24}">${arrow24}</span>
          <span class="bm-metric-label">Variación del precio</span>
        </div>
        <div class="bm-var-lines">${varParts.join('<span class="bm-var-sep">·</span>')}</div>
        <span class="bm-metric-sub">Cambio desde hace 1, 7 y 30 días</span>
      </div>

      <div class="bm-metric-card" style="--mc-accent:${acc1y}">
        <div class="bm-metric-top">
          <span class="bm-metric-icon" style="color:${acc1y}">${arrow1y}</span>
          <span class="bm-metric-label">Variación anual</span>
        </div>
        <span class="bm-metric-value ${sign1y}">${pct1y != null ? `${pct1y > 0 ? '+' : ''}${pct1y.toFixed(2)}%` : '—'}</span>
        <span class="bm-metric-sub">Cambio de precio en los últimos 365 días</span>
      </div>

      <div class="bm-metric-card" style="--mc-accent:#ffd60a">
        <div class="bm-metric-top">
          <span class="bm-metric-icon" style="color:#ffd60a">👑</span>
          <span class="bm-metric-label">Dominancia Bitcoin</span>
        </div>
        <span class="bm-metric-value">${domStr}</span>
        <span class="bm-metric-sub">% del total de capitalización del mercado cripto</span>
      </div>

    </div>`;
}

// ── Sentiment ─────────────────────────────────────────────────────────
function sentimentCard(sentUp) {
  const up   = Math.round(sentUp);
  const down = 100 - up;
  const dominant = up >= 50 ? 'alcista' : 'bajista';
  const color    = up >= 50 ? '#30d158' : '#ff453a';
  return `
    <div class="bm-sentiment-card">
      <div class="bm-sc-header">
        <span class="bm-sc-title">Sentimiento de la comunidad</span>
        <span class="bm-sc-dominant" style="color:${color}">Mayoría ${dominant}</span>
      </div>
      <div class="bm-sc-percents">
        <span class="bm-sc-up">▲ Alcista ${up}%</span>
        <span class="bm-sc-down">▼ Bajista ${down}%</span>
      </div>
      <div class="bm-sc-track"><div class="bm-sc-fill" style="width:${up}%"></div></div>
    </div>`;
}

// ── ATH ───────────────────────────────────────────────────────────────
function athCard(mkt) {
  const athEur  = mkt.ath?.eur;
  const athDate = mkt.ath_date?.eur;
  const athPct  = mkt.ath_change_percentage?.eur;
  if (!athEur) return '';
  const dateStr = athDate
    ? new Date(athDate).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';
  const pctAbs = athPct != null ? Math.abs(athPct).toFixed(1) : null;
  return `
    <div class="bm-ath-card">
      <div class="bm-ath-inner">
        <span class="bm-ath-trophy">🏆</span>
        <div class="bm-ath-data">
          <span class="bm-ath-label">Precio máximo histórico (ATH)</span>
          <span class="bm-ath-val">€${Math.round(athEur).toLocaleString('es-ES')}</span>
          <span class="bm-ath-date">${dateStr}</span>
        </div>
        ${pctAbs ? `
        <div class="bm-ath-dist">
          <span class="bm-ath-dist-val">${pctAbs}%</span>
          <span class="bm-ath-dist-lbl">por debajo del ATH</span>
        </div>` : ''}
      </div>
    </div>`;
}

// ── Halving ───────────────────────────────────────────────────────────
function halvingCard(blockHeight) {
  const INTERVAL      = 210_000;
  const halvingNum    = Math.floor(blockHeight / INTERVAL);
  const nextBlock     = (halvingNum + 1) * INTERVAL;
  const epochStart    = halvingNum * INTERVAL;
  const remaining     = nextBlock - blockHeight;
  const epochPct      = ((blockHeight - epochStart) / INTERVAL * 100).toFixed(1);
  const currentReward = (50 / Math.pow(2, halvingNum)).toFixed(4).replace(/\.?0+$/, '');
  const nextReward    = (50 / Math.pow(2, halvingNum + 1)).toFixed(5).replace(/\.?0+$/, '');
  const days          = Math.round(remaining * 10 / 1440);
  const estDate       = new Date(Date.now() + days * 86_400_000);
  const estDateStr    = estDate.toLocaleDateString('es-ES', { year: 'numeric', month: 'long' });

  return `
    <div class="bm-halving-card">
      <div class="bm-halving-header">
        <div class="bm-halving-title-row">
          <span class="bm-halving-icon">⚡</span>
          <div>
            <span class="bm-halving-title">Próximo Halving — #${halvingNum + 1}</span>
            <span class="bm-halving-num">Bloque actual: ${blockHeight.toLocaleString('es-ES')}</span>
          </div>
        </div>
        <div class="bm-halving-est">
          <span class="bm-halving-date">${estDateStr}</span>
          <span class="bm-halving-years">en ~${days.toLocaleString('es-ES')} días</span>
        </div>
      </div>

      <div class="bm-halving-progress-wrap">
        <div class="bm-halving-bar"><div class="bm-halving-fill" style="width:${epochPct}%"></div></div>
        <div class="bm-halving-bar-labels">
          <span>Bloque ${epochStart.toLocaleString('es-ES')}</span>
          <span class="bm-halving-pct">${epochPct}% del epoch actual</span>
          <span>Bloque ${nextBlock.toLocaleString('es-ES')}</span>
        </div>
      </div>

      <div class="bm-halving-stats">
        <div class="bm-halving-stat">
          <span class="bm-halving-stat-val">${remaining.toLocaleString('es-ES')}</span>
          <span class="bm-halving-stat-lbl">bloques hasta el halving</span>
        </div>
        <div class="bm-halving-stat">
          <span class="bm-halving-stat-val">${days.toLocaleString('es-ES')} días</span>
          <span class="bm-halving-stat-lbl">tiempo estimado (~10 min/bloque)</span>
        </div>
        <div class="bm-halving-stat">
          <span class="bm-halving-stat-val">${currentReward} ₿</span>
          <span class="bm-halving-stat-lbl">recompensa actual por bloque minado</span>
        </div>
        <div class="bm-halving-stat bm-halving-stat-next">
          <span class="bm-halving-stat-val">${nextReward} ₿</span>
          <span class="bm-halving-stat-lbl">recompensa tras el halving</span>
        </div>
      </div>

      <p class="bm-halving-note">
        El halving reduce a la mitad la emisión de nuevos BTC cada 210.000 bloques (~4 años). Cuando la recompensa llegue a 0 satoshis, la red se financiará únicamente con comisiones de transacción. Último BTC se minará ~año 2140.
      </p>
    </div>`;
}

// ── Hashrate & Difficulty ─────────────────────────────────────────────
function hashrateSection(hrData, diff) {
  if (!hrData && !diff) {
    return `
    <div class="bm-hr-wrap">
      <div class="bm-hr-header">
        <span class="bm-hr-title">⛏ Potencia de la Red (Hashrate)</span>
      </div>
      <p style="color:#666;font-size:0.9em;padding:12px 0">No se pudieron cargar los datos de hashrate. Intenta recargar la página.</p>
    </div>`;
  }

  const hashrates = hrData?.hashrates  || [];
  const diffs     = hrData?.difficulty || [];
  const curHash   = hrData?.currentHashrate  || null;
  const curDiff   = hrData?.currentDifficulty || null;

  // Max hashrate in period
  const maxHash = hashrates.length ? Math.max(...hashrates.map(h => h.avgHashrate)) : null;

  // 30-day change: compare last vs 30 entries ago
  let hashChange30 = null;
  if (hashrates.length >= 30) {
    const old = hashrates[hashrates.length - 30].avgHashrate;
    const cur = hashrates[hashrates.length - 1].avgHashrate;
    hashChange30 = old !== 0 ? ((cur - old) / old * 100) : null;
  }

  // Next difficulty adjustment data
  const diffChange     = diff?.difficultyChange     ?? null;  // % change
  const remainBlocks   = diff?.remainingBlocks      ?? null;
  const retargetDate   = diff?.estimatedRetargetDate ?? null;
  const prevRetarget   = diff?.previousRetarget     ?? null;
  const progressPct    = diff?.progressPercent      ?? null;
  const timeAvgMin     = diff?.timeAvg != null ? (diff.timeAvg / 60000).toFixed(1) : null;

  const retargetDateStr = retargetDate
    ? new Date(retargetDate * 1000).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  const diffSign  = diffChange != null ? (diffChange >= 0 ? 'pos' : 'neg') : '';
  const diffArrow = diffChange != null ? (diffChange >= 0 ? '▲' : '▼') : '';
  const diffColor = diffChange != null ? (diffChange >= 0 ? '#ff453a' : '#30d158') : '#888';
  // Dificultad sube → mineros lo tienen más difícil (rojo); baja → más fácil (verde)

  // Chart SVG (hashrate sparkline solo)
  const chartSvg = buildHashrateChart(hashrates);

  return `
    <div class="bm-hr-wrap">
      <div class="bm-hr-header">
        <span class="bm-hr-title">⛏ Potencia de la Red (Hashrate)</span>
        <span class="bm-hr-period">6 meses · mempool.space</span>
      </div>

      <!-- Stats row -->
      <div class="bm-hr-stats">
        <div class="bm-hr-stat">
          <span class="bm-hr-stat-lbl">Potencia actual de la red</span>
          <span class="bm-hr-stat-val">${curHash ? fmtEH(curHash) : '—'}</span>
          <span class="bm-hr-stat-sub">Exahashes por segundo (EH/s) — potencia computacional combinada de todos los mineros del mundo. 1 EH/s = 1.000.000.000.000.000.000 cálculos por segundo.</span>
        </div>
        <div class="bm-hr-stat">
          <span class="bm-hr-stat-lbl">Máximo de potencia (últimos 6 meses)</span>
          <span class="bm-hr-stat-val bm-hr-peak">${maxHash ? fmtEH(maxHash) : '—'}</span>
          <span class="bm-hr-stat-sub">Pico más alto de hashrate registrado en los últimos 6 meses — indica el máximo histórico reciente de seguridad de la red</span>
        </div>
        <div class="bm-hr-stat">
          <span class="bm-hr-stat-lbl">Variación de potencia (últimos 30 días)</span>
          <span class="bm-hr-stat-val ${hashChange30 != null ? (hashChange30 >= 0 ? 'pos' : 'neg') : ''}">${hashChange30 != null ? `${hashChange30 >= 0 ? '+' : ''}${hashChange30.toFixed(1)}%` : '—'}</span>
          <span class="bm-hr-stat-sub">Cambio de potencia de la red respecto a hace 30 días — positivo significa más mineros conectados</span>
        </div>
        <div class="bm-hr-stat">
          <span class="bm-hr-stat-lbl">Dificultad de minado actual</span>
          <span class="bm-hr-stat-val">${curDiff ? fmtDiff(curDiff) : '—'}</span>
          <span class="bm-hr-stat-sub">Qué tan difícil es encontrar el siguiente bloque — se ajusta cada ~2 semanas para mantener bloques cada 10 minutos</span>
        </div>
      </div>

      <!-- Mini chart -->
      ${chartSvg}

      <!-- Next difficulty adjustment -->
      <div class="bm-diff-adj">
        <div class="bm-diff-adj-header">
          <span class="bm-diff-adj-title">Próximo ajuste de dificultad</span>
          ${diffChange != null ? `<span class="bm-diff-adj-badge" style="color:${diffColor};border-color:${diffColor}40;background:${diffColor}10">${diffChange >= 0 ? '▲ SUBE' : '▼ BAJA'} ${diffChange >= 0 ? '+' : ''}${diffChange.toFixed(2)}% estimado</span>` : ''}
        </div>
        ${diffChange != null ? `
        <p style="margin:6px 0 10px;font-size:0.9em;color:${diffColor};font-weight:600">
          ${diffChange > 0
            ? `Los bloques llegan más rápido de lo normal → la dificultad <strong>subirá ~${diffChange.toFixed(1)}%</strong> para que los mineros trabajen más duro.`
            : `Los bloques llegan más lento de lo normal → la dificultad <strong>bajará ~${Math.abs(diffChange).toFixed(1)}%</strong> para compensar.`}
        </p>` : ''}
        <div class="bm-diff-adj-grid">
          ${diffChange != null && curDiff ? `
          <div class="bm-diff-adj-item" style="border-color:${diffColor}60">
            <span class="bm-diff-adj-val" style="color:${diffColor};font-size:1.15em">${fmtDiff(curDiff * (1 + diffChange / 100))}</span>
            <span class="bm-diff-adj-lbl">nueva dificultad estimada tras el ajuste (actual: ${fmtDiff(curDiff)})</span>
          </div>` : ''}
          ${remainBlocks != null ? `
          <div class="bm-diff-adj-item">
            <span class="bm-diff-adj-val">${remainBlocks.toLocaleString('es-ES')} bloques</span>
            <span class="bm-diff-adj-lbl">restantes para que se produzca el ajuste (~${Math.round(remainBlocks * 10 / 1440)} días)</span>
          </div>` : ''}
          ${retargetDateStr ? `
          <div class="bm-diff-adj-item">
            <span class="bm-diff-adj-val">${retargetDateStr}</span>
            <span class="bm-diff-adj-lbl">fecha estimada del próximo ajuste de dificultad</span>
          </div>` : ''}
          ${progressPct != null ? `
          <div class="bm-diff-adj-item">
            <span class="bm-diff-adj-val">${progressPct.toFixed(1)}%</span>
            <span class="bm-diff-adj-lbl">progreso del epoch actual — el ajuste ocurre cada 2.016 bloques completos</span>
          </div>` : ''}
          ${timeAvgMin ? `
          <div class="bm-diff-adj-item">
            <span class="bm-diff-adj-val">${timeAvgMin} min</span>
            <span class="bm-diff-adj-lbl">tiempo medio por bloque en este epoch (objetivo de la red: 10 min exactos)</span>
          </div>` : ''}
          ${prevRetarget != null ? `
          <div class="bm-diff-adj-item">
            <span class="bm-diff-adj-val ${prevRetarget >= 0 ? 'pos' : 'neg'}">${prevRetarget >= 0 ? '+' : ''}${prevRetarget.toFixed(2)}%</span>
            <span class="bm-diff-adj-lbl">variación del ajuste anterior de dificultad</span>
          </div>` : ''}
        </div>
        <p class="bm-diff-adj-note">
          La red Bitcoin ajusta la dificultad cada 2.016 bloques (~2 semanas) para garantizar que siempre se mine un bloque cada ~10 minutos, independientemente de cuántos mineros estén conectados.
        </p>
      </div>
    </div>`;
}

function buildHashrateChart(hashrates) {
  if (!hashrates.length) return '';
  const n    = Math.min(hashrates.length, 90);
  const data = hashrates.slice(-n);

  const W  = 800, H = 160;
  const P  = { t: 16, r: 80, b: 28, l: 8 };
  const cW = W - P.l - P.r;
  const cH = H - P.t - P.b;

  const vals = data.map(h => h.avgHashrate);
  const minV = Math.min(...vals) * 0.97;
  const maxV = Math.max(...vals) * 1.03;

  const xS = i => P.l + (i / (n - 1)) * cW;
  const yS = v => P.t + (1 - (v - minV) / (maxV - minV)) * cH;

  const pts  = data.map((h, i) => `${xS(i).toFixed(1)},${yS(h.avgHashrate).toFixed(1)}`);
  const line = `M ${pts.join(' L ')}`;
  const clipB = (H - P.b).toFixed(1);
  const area = `M ${xS(0).toFixed(1)},${clipB} L ${pts.join(' L ')} L ${xS(n-1).toFixed(1)},${clipB} Z`;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(t => {
    const y = (P.t + t * cH).toFixed(1);
    const v = maxV - t * (maxV - minV);
    return `<line x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
            <text x="${W - P.r + 4}" y="${y}" fill="#f7931a" font-size="8.5" dominant-baseline="middle" font-family="'Share Tech Mono',monospace" opacity="0.8">${fmtEH(v)}</text>`;
  });

  const dateIdxs = [0, Math.floor(n / 3), Math.floor(n * 2 / 3), n - 1];
  const xLabels  = dateIdxs.map(i => {
    const d   = new Date(data[i].timestamp * 1000);
    const lbl = d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
    return `<text x="${xS(i).toFixed(1)}" y="${(H - P.b + 12).toFixed(1)}" fill="#505058" font-size="8.5" text-anchor="middle" font-family="'Share Tech Mono',monospace">${lbl}</text>`;
  });

  const gId = `hs${Math.random().toString(36).slice(2, 6)}`;

  return `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;margin:12px 0" role="img" aria-label="Hashrate 6 meses">
      <defs>
        <linearGradient id="${gId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#f7931a" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="#f7931a" stop-opacity="0"/>
        </linearGradient>
        <clipPath id="c${gId}"><rect x="${P.l}" y="${P.t}" width="${cW}" height="${cH + 1}"/></clipPath>
      </defs>
      ${gridLines.join('')}
      <path d="${area}" fill="url(#${gId})" clip-path="url(#c${gId})"/>
      <path d="${line}" fill="none" stroke="#f7931a" stroke-width="2" stroke-linejoin="round" clip-path="url(#c${gId})"/>
      ${xLabels.join('')}
    </svg>`;
}

// ── Lightning ─────────────────────────────────────────────────────────
function lightningCard(ln) {
  const capBtc  = ln.total_capacity != null ? Math.round(ln.total_capacity / 1e8).toLocaleString('es-ES') : '—';
  const channels = ln.channel_count != null ? ln.channel_count.toLocaleString('es-ES') : '—';
  const nodes    = ln.node_count    != null ? ln.node_count.toLocaleString('es-ES')    : '—';
  const avgKsats = ln.avg_capacity  != null ? Math.round(ln.avg_capacity / 1000)       : null;

  return `
    <div class="bm-ln-card">
      <div class="bm-ln-header">
        <span class="bm-ln-icon">⚡</span>
        <span class="bm-ln-title">Lightning Network</span>
        <span class="bm-ln-badge">Mainnet</span>
      </div>
      <div class="bm-ln-grid">
        <div class="bm-ln-stat">
          <span class="bm-ln-val">${capBtc} ₿</span>
          <span class="bm-ln-lbl">Capacidad total bloqueada en canales LN</span>
        </div>
        <div class="bm-ln-stat">
          <span class="bm-ln-val">${channels}</span>
          <span class="bm-ln-lbl">Canales de pago activos en la red</span>
        </div>
        <div class="bm-ln-stat">
          <span class="bm-ln-val">${nodes}</span>
          <span class="bm-ln-lbl">Nodos conectados a la red Lightning</span>
        </div>
        ${avgKsats ? `
        <div class="bm-ln-stat">
          <span class="bm-ln-val">${avgKsats.toLocaleString('es-ES')} k sats</span>
          <span class="bm-ln-lbl">Capacidad media por canal</span>
        </div>` : ''}
      </div>
    </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────
function fngColor(val) {
  if (val <= 25) return '#ff453a';
  if (val <= 45) return '#ff9f0a';
  if (val <= 55) return '#ffd60a';
  if (val <= 75) return '#30d158';
  return '#32d74b';
}
function fearLabel(val) {
  if (val <= 25) return 'Miedo Extremo';
  if (val <= 45) return 'Miedo';
  if (val <= 55) return 'Neutral';
  if (val <= 75) return 'Codicia';
  return 'Codicia Extrema';
}

function fmtBig(n) {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)} billones`;
  if (n >= 1e9)  return `${(n / 1e9).toFixed(2)} mil millones`;
  if (n >= 1e6)  return `${(n / 1e6).toFixed(2)} millones`;
  return Math.round(n).toLocaleString('es-ES');
}

function fmtEH(hs) {
  const eh = hs / 1e18;
  if (eh >= 1)  return `${eh.toFixed(1)} EH/s`;
  return `${(hs / 1e15).toFixed(1)} PH/s`;
}
function fmtDiff(d) {
  const t = d / 1e12;
  if (t >= 1) return `${t.toFixed(2)} T`;
  return `${(d / 1e9).toFixed(2)} G`;
}
