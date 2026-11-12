// Perfil del vendedor: resumen de sus anuncios.
import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeSellerListings, sellerDisplayName, sinceLabel } from '../js/seller-profile.js'

const NOW = 2_000_000_000
const l = (naddr, o = {}) => ({ naddr, title: naddr, status: 'active', created_at: NOW - 100, publishedAt: NOW - 100, ...o })

test('activos sin caducados ni retirados, vendidos contados, última versión de cada uno', () => {
  const r = summarizeSellerListings([
    l('a', { publishedAt: NOW - 10 }),
    l('b', { status: 'sold' }),
    l('c', { expiresAt: NOW - 1 }),
    l('d', { status: 'inactive' }),
    l('e', { publishedAt: NOW - 5000 }),
    // Versión vieja de «b» activa: manda la nueva (vendida).
    l('b', { created_at: NOW - 900 }),
  ], NOW)
  assert.deepEqual(r.active.map(x => x.naddr), ['a', 'e'])
  assert.equal(r.sold, 1)
  assert.equal(r.since, NOW - 5000)
  assert.deepEqual(summarizeSellerListings([], NOW), { active: [], sold: 0, since: null })
})

test('nombre del perfil o principio del npub; fecha legible', () => {
  assert.equal(sellerDisplayName({ displayName: ' Bebop ' }, 'npub1xyz'), 'Bebop')
  assert.equal(sellerDisplayName({ name: 'bebop2077' }, 'npub1xyz'), 'bebop2077')
  assert.equal(sellerDisplayName(null, 'npub1abcdefghijklmnopqrstuv'), 'npub1abcdefghijk…')
  assert.match(sinceLabel(1_790_000_000), /2026/)
  assert.equal(sinceLabel(null), '')
})
