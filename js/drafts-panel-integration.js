// ── Integración de UX-002 y ADS-001 en publicar-app.js ─────────────────

import { saveDraft, loadDraft, deleteDraft, hasDraft } from './drafts.js';
import { onDuplicar, onMarcarVendido } from './ADS001-helpers.js';

// Integrar handlers duplicar/vendido en deps de mis-anuncios.js
function initMisAnunciosWithHandlers(pool, getPubkey, listEl, statusEl, onEdit, onRetirar) {
  const originalInit = (deps => ({ pool, getPubkey, listEl, statusEl, onEdit, onRetirar }));
  return originalInit({ 
    ...originalInit(pool, getPubkey, listEl, statusEl, onEdit, onRetirar),
    onDuplicar: onDuplicar,
    onMarcarVendido: onMarcarVendido
  });
}

// Integrar funciones de borradores en publicar-app.js
if (typeof window !== 'undefined') {
  window.updateDraftsUI = updateDraftsUI;
  window.loadDraft = loadDraft;
  window.saveDraft = saveDraft;
  window.discardCurrentDraft = discardCurrentDraft;
}

// Exportar handlers para uso interno
export { onDuplicar, onMarcarVendido };
