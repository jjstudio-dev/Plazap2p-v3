// ── UX-002: Gestión de borradores global ────────────────────────────

/** Actualizar UI del panel de borradores */
function updateDraftsUI() {
  let count = 0
  const types = ['servicio','evento','comunidad','herramienta','venta','compra','intercambio']
  
  for (const type of types) if (hasDraft(type)) count++
  
  // Mostrar/ocultar panel
  const panel = document.getElementById('drafts-panel-global')
  const badge = document.getElementById('draft-count-badge')
  
  if (count > 0) {
    panel.classList.remove('hidden')
    if (badge) { badge.textContent = '(' + count + ')' }
  } else {
    panel.classList.add('hidden')
    if (badge) { badge.classList.add('hidden') }
  }
}

/** Cargar borrador en formulario actual */
async function loadDraft(type) {
  setErr('err-drafts', '')
  const draft = loadDraft(type)
  if (!draft) return setErr('err-drafts', 'No hay borrador guardado para "' + type + '"')
  try {
    const currentForm = getCurrentFormSnapshot()
    mergeSnapshots(currentForm, draft.snapshot)
    updateDraftsUI(); 
    setErr('err-drafts', '✅ Borrador cargado: ' + type)
  } catch (e) {
    setErr('err-drafts', 'Error: ' + e.message)
  }
}

/** Guardar snapshot actual como nuevo borrador */
function saveDraft(type, { override = false } = {}) {
  const currentForm = getCurrentFormSnapshot()
  const existingDraft = loadDraft(type)
  
  if (existingDraft && !override && !confirm('Ya tienes borrador para "' + type + '". ¿Sobrescribirlo?')) return
  saveDraftToStorage(type, currentForm), updateDraftsUI();
}

/** Discartar borrador cargado (UX-002) */
function discardCurrentDraft() {
  const pending = loadPending()
  if (!pending) return
  if (!confirm('¿Descartar borrador permanentemente?')) return
  clearPending(); clearAllDrafts(); updateDraftsUI()
}

/** Limpiar todos los borradores */
function clearAllDrafts() {
  const types = ['servicio','evento','comunidad','herramienta','venta','compra','intercambio']
  for (const type of types) deleteDraft(type)
}

// Agregar listeners al DOM
if (typeof document !== 'undefined') {
  const sections = [
    { selector: '#sec-servicio', type: 'servicio' },
    { selector: '#sec-evento', type: 'evento' },
    { selector: '#sec-comunidad', type: 'comunidad' },
    { selector: '#sec-herramienta', type: 'herramienta' },
    { selector: '#sec-transaccion', type: 'venta' }
  ];

  sections.forEach(function(s) {
    const el = document.querySelector(s.selector)
    if (el) el.addEventListener('input', function() {
      saveDraftToStorage(s.type, getFormSnapshot(s.selector))
      updateDraftsUI()
    })
  })
}
