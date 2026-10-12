// trust-signals.js — SPAM-001/REP-001: señales de confianza explicadas, NUNCA
// una "protección" falsa. Nostr no tiene cuentas verificadas ni antigüedad
// certificada — este módulo solo describe con honestidad lo poco que SÍ se
// puede observar desde datos ya cargados (número de valoradores distintos),
// para que la persona decida, no para prometer seguridad que no existe.

/**
 * @param {number} count — valoradores DISTINTOS (aggregate() en reputacion.js
 *   ya dedupe por autor, así que esto no es "número de valoraciones" inflable
 *   por un mismo rater repitiendo eventos).
 * @returns {{level:'sin_datos'|'bajo'|'medio'|'alto', label:string, note:string}}
 */
export function trustLevel(count) {
  const n = Number(count) || 0
  if (n <= 0) {
    return {
      level: 'sin_datos',
      label: 'Sin valoraciones',
      note: 'Nadie lo ha valorado todavía en Nostr. Eso no significa que sea de fiar ni que no lo sea — verifica por tu cuenta antes de operar.',
    }
  }
  if (n < 3) {
    return {
      level: 'bajo',
      label: 'Pocas valoraciones',
      note: 'Con tan pocos valoradores, una identidad nueva podría auto-valorarse con cuentas alternativas. No lo tomes como garantía.',
    }
  }
  if (n < 10) {
    return {
      level: 'medio',
      label: 'Historial moderado',
      note: 'Varios valoradores distintos, pero sigue siendo una red abierta: cualquiera puede crear una identidad Nostr en segundos.',
    }
  }
  return {
    level: 'alto',
    label: 'Historial establecido',
    note: 'Muchos valoradores distintos a lo largo del tiempo — una señal más sólida, aunque nunca una certificación.',
  }
}

// Nota "prudente" de un vendedor para ordenar el directorio: su media
// mezclada con PRIOR_COUNT valoraciones imaginarias de nota neutra. Con pocas
// valoraciones pesa el punto de partida; con muchas, la media real. Así una
// sola valoración de 5 no queda por delante de cincuenta con media 4,8.
const PRIOR_COUNT = 5
const PRIOR_AVG = 3

function prudentScore(rating) {
  const n = Number(rating?.n) || 0
  if (n <= 0) return 0
  const avg = Number(rating?.avg) || 0
  return (n * avg + PRIOR_COUNT * PRIOR_AVG) / (n + PRIOR_COUNT)
}

/** Para Array.sort: primero quien tiene mejor nota teniendo en cuenta cuántas valoraciones la respaldan. */
export function compareSellersByRating(a, b) {
  const diff = prudentScore(b?.rating) - prudentScore(a?.rating)
  if (diff !== 0) return diff
  return (Number(b?.rating?.n) || 0) - (Number(a?.rating?.n) || 0)
}
