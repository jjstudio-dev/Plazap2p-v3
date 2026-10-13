// storage-keys.test.mjs — registro de localStorage: sin solapes y sin omisiones
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { EXPORTABLE, SENSITIVE, CACHE_ONLY, isRegistered } from '../js/storage-keys.js'

const JS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js')

test('EXPORTABLE, SENSITIVE y CACHE_ONLY no se solapan entre sí', () => {
  const sets = [EXPORTABLE, SENSITIVE, CACHE_ONLY]
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const overlap = sets[i].filter(k => sets[j].includes(k))
      assert.deepEqual(overlap, [], `solape entre listas: ${overlap.join(', ')}`)
    }
  }
})

test('isRegistered() reconoce claves de las tres listas y rechaza desconocidas', () => {
  assert.equal(isRegistered('plazap2p_sort'), true)
  assert.equal(isRegistered('plazap2p_nwc_persist'), true)
  assert.equal(isRegistered('plazap2p_v3'), true)
  assert.equal(isRegistered('plazap2p_no_existe'), false)
  // Borradores: una clave por tipo de publicación, registradas por prefijo.
  assert.equal(isRegistered('plazap2p_draft_venta'), true)
  assert.equal(isRegistered('plazap2p_draft_'), false)
  // Módulos que ya no existen (en cuarentena): sus claves ya no figuran.
  assert.equal(isRegistered('plazap2p_orders'), false)
  assert.equal(isRegistered('plazap2p_saved_searches'), false)
})

// Comprobación mecánica (ver Fase 0 del plan): cualquier
// localStorage.setItem/getItem('plazap2p_...') en js/*.js debe estar
// registrado en storage-keys.js. Evita que una clave nueva quede "suelta"
// por omisión — el riesgo real que preocupaba en BON-013.
//
// El código real casi siempre pasa una constante (`localStorage.setItem(
// CACHE_KEY, ...)`), no el literal directo — así que primero se resuelven
// las constantes `const X = 'plazap2p_...'` de cada archivo, y luego se
// buscan los call-sites de localStorage por nombre de constante o literal.
// sessionStorage se ignora a propósito: fuera de alcance de este registro
// (se borra por sesión, no es exportable ni falta protegerlo igual).
test('toda clave plazap2p_* usada en localStorage.(setItem|getItem|removeItem) está registrada', () => {
  const files = readdirSync(JS_DIR).filter(f => f.endsWith('.js') && f !== 'storage-keys.js')
  const constRe = /const\s+(\w+)\s*=\s*['"](plazap2p_[a-z0-9_]*)['"]/g
  const callRe = /localStorage\.(?:setItem|getItem|removeItem)\(\s*(?:['"](plazap2p_[a-z0-9_]*)['"]|(\w+))/g
  const found = new Set()
  for (const f of files) {
    const src = readFileSync(path.join(JS_DIR, f), 'utf8')
    const constMap = new Map()
    let m
    while ((m = constRe.exec(src))) constMap.set(m[1], m[2])
    while ((m = callRe.exec(src))) {
      const literal = m[1] || constMap.get(m[2])
      if (literal) found.add(literal)
    }
  }
  assert.ok(found.size > 0, 'la búsqueda no encontró ninguna clave — regex rota o archivos movidos')
  const unregistered = [...found].filter(k => !isRegistered(k))
  assert.deepEqual(unregistered, [], `claves usadas pero no registradas en storage-keys.js: ${unregistered.join(', ')}`)
})
