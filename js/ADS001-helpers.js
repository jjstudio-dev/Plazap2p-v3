// ── ADS-001: Duplicar anuncio y marcar vendido ─────────────────────────

/** Agregar handler duplicar a deps de mis-anuncios */
export function onDuplicar(ev) {
  const kind = ev.kind;
  const dTag = getTagValue(ev.tags, 'd');
  const publishedAt = getTagValue(ev.tags, 'published_at');
  
  // Extraer contenido del evento original para restaurar en formulario
  let content = ev.content || '';
  
  // Eliminar tag de footer automático si existe
  content = content.replace(/\n\n---\n📢 Publicado vía PlazaP2P$/, '');
  
  // Restaurar snapshot con datos del evento duplicado
  const currentForm = getCurrentFormSnapshot();
  mergeSnapshots(currentForm, {
    kind,
    dTag,
    publishedAt,
    content: content,
  });
}

/** Agregar handler marcar vendido (solo mercado) */
export function onMarcarVendido(ev) {
  const dTag = getTagValue(ev.tags, 'd');
  
  if (!confirm('¿Marcar este anuncio como vendido? Se publicará con status=sold')) return;
  
  // Actualizar tags del evento original
  let newTags = ev.tags.map(t => {
    if (t[0] === 'status' && t[1] !== 'inactive')
      return ['status', 'sold'];
    return t;
  });
  
  // Guardar snapshot actualizado como nuevo borrador
  const currentForm = getCurrentFormSnapshot();
  saveDraft(getCurrentType(), {
    ...currentForm,
    tags: newTags,  // Con status=sold
  }, { override: true });
}
