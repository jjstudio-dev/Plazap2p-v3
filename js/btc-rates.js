// btc-rates.js — Lectura defensiva de las APIs de precios (lógica pura).
//
// mempool.space, CoinGecko, yadio y compañía son servicios de terceros: lo
// que devuelven decide importes que el usuario usa para poner precio a una
// operación, y parte acaba dentro de innerHTML. Reglas de este módulo:
//   - Un dato solo vale si es un número finito (y positivo, si es una tasa).
//     Un texto donde se espera un número se descarta — además, pasaba tal
//     cual a la página a través de .toLocaleString(), que en un string no
//     formatea nada.
//   - Cada consulta parte de cero: lo que una fuente trae en ESTA ronda
//     sustituye a lo anterior. Antes, CNY y el oro solo se rellenaban "si
//     faltaban", así que se quedaban congelados en el valor de la primera
//     carga mientras la página siguiera abierta.

/** v si es un número finito (acepta textos numéricos como "65000"); si no, null. */
export function finiteNumber(v) {
  if (typeof v === 'string' && v.trim() !== '') v = Number(v)
  return (typeof v === 'number' && Number.isFinite(v)) ? v : null
}

/** Tasa de cambio válida: número finito y mayor que cero. */
function rate(v) {
  if (v && typeof v === 'object') v = v.rate ?? v.ask ?? v.bid   // yadio a veces devuelve { rate, ask, bid }
  const n = finiteNumber(v)
  return (n != null && n > 0) ? n : null
}

/**
 * Copia de `value` en la que solo sobreviven los números finitos; cualquier
 * otra hoja (texto, booleano, null) pasa a null. Para datos que se formatean
 * y se insertan en la página.
 */
export function onlyNumbers(value) {
  if (Array.isArray(value)) return value.map(onlyNumbers)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, onlyNumbers(v)]))
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Combina las tasas BTC→moneda de las tres fuentes.
 * Prioridad por moneda: mempool.space (USD/EUR/CHF) → CoinGecko → yadio (CNY/XAU).
 *
 * @param {object} prev — tasas de la ronda anterior (se conservan las que
 *   ninguna fuente haya podido refrescar: mejor un dato de hace 5 minutos que
 *   ninguno)
 * @param {{mempool?:any, coingecko?:any, yadio?:any}} sources — JSON crudo de
 *   cada API, o null/undefined si falló
 * @returns {{ rates: object, refreshed: string[] }} `refreshed`: monedas con
 *   dato nuevo en esta ronda (vacío = no se actualizó nada)
 */
export function mergeRates(prev, { mempool = null, coingecko = null, yadio = null } = {}) {
  const fresh = {}
  const put = (code, v) => { const n = rate(v); if (n != null && fresh[code] == null) fresh[code] = n }
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : null

  const mp = obj(mempool)
  if (mp) { put('USD', mp.USD); put('EUR', mp.EUR); put('CHF', mp.CHF) }

  const cg = obj(obj(coingecko)?.bitcoin)
  if (cg) { put('USD', cg.usd); put('EUR', cg.eur); put('CNY', cg.cny); put('CHF', cg.chf) }

  const yd = obj(yadio)
  const src = yd && (obj(yd.rates) || obj(yd.BTC) || yd)
  if (src) { put('CNY', src.CNY); put('XAU', src.XAU) }

  const rates = { ...(obj(prev) || {}), ...fresh }
  if (rates.USD) { rates.USDT = rates.USD; rates.USDC = rates.USD }   // estables: paridad con USD
  return { rates, refreshed: Object.keys(fresh) }
}

/** fetch → JSON, tratando como fallo cualquier respuesta que no sea 2xx. */
export async function fetchJson(url, timeoutMs = 8000) {
  const opts = (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function')
    ? { signal: AbortSignal.timeout(timeoutMs) } : {}
  const res = await fetch(url, opts)
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.json()
}
