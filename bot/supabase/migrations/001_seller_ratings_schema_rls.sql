-- ══════════════════════════════════════════════════════════════════════════════
-- Migración 001: Esquema de seller_ratings + RLS
-- Aplicar en: Supabase Dashboard → SQL Editor → New query → Run
-- O con CLI:  supabase db push
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Crear tabla si no existe ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seller_ratings (
  pubkey_hex        TEXT        PRIMARY KEY CHECK (pubkey_hex ~ '^[0-9a-f]{64}$'),
  avg_overall       NUMERIC(3,2) NOT NULL DEFAULT 0 CHECK (avg_overall >= 0 AND avg_overall <= 5),
  review_count      INTEGER     NOT NULL DEFAULT 0  CHECK (review_count >= 0),
  avg_comunicacion  NUMERIC(3,2)         CHECK (avg_comunicacion  IS NULL OR (avg_comunicacion  >= 0 AND avg_comunicacion  <= 5)),
  avg_cumplimiento  NUMERIC(3,2)         CHECK (avg_cumplimiento  IS NULL OR (avg_cumplimiento  >= 0 AND avg_cumplimiento  <= 5)),
  avg_precio_justo  NUMERIC(3,2)         CHECK (avg_precio_justo  IS NULL OR (avg_precio_justo  >= 0 AND avg_precio_justo  <= 5)),
  avg_rapidez       NUMERIC(3,2)         CHECK (avg_rapidez       IS NULL OR (avg_rapidez       >= 0 AND avg_rapidez       <= 5)),
  avg_confianza     NUMERIC(3,2)         CHECK (avg_confianza     IS NULL OR (avg_confianza     >= 0 AND avg_confianza     <= 5)),
  last_active       BIGINT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. Activar Row Level Security ─────────────────────────────────────────────
-- Sin RLS activo cualquier cliente con la anon key puede leer/escribir la tabla.
ALTER TABLE public.seller_ratings ENABLE ROW LEVEL SECURITY;

-- ── 3. Políticas RLS ──────────────────────────────────────────────────────────

-- Lectura pública: cualquiera puede leer datos agregados de reputación.
-- Solo se exponen columnas públicas (sin datos internos de reviewer).
DROP POLICY IF EXISTS "seller_ratings_public_read" ON public.seller_ratings;
CREATE POLICY "seller_ratings_public_read"
  ON public.seller_ratings
  FOR SELECT
  USING (true);

-- Escritura solo para service_role: el bot de CF Workers es el único que puede
-- insertar o actualizar. La anon key y los usuarios autenticados NO pueden escribir.
DROP POLICY IF EXISTS "seller_ratings_service_write" ON public.seller_ratings;
CREATE POLICY "seller_ratings_service_write"
  ON public.seller_ratings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── 4. Índice para consultas frecuentes ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_seller_ratings_updated_at
  ON public.seller_ratings (updated_at DESC);

-- ── 5. Función de actualización automática de updated_at ─────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seller_ratings_updated_at ON public.seller_ratings;
CREATE TRIGGER trg_seller_ratings_updated_at
  BEFORE UPDATE ON public.seller_ratings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Verificación post-migración ───────────────────────────────────────────────
-- Ejecutar para confirmar que RLS está activo:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'seller_ratings';
-- Debe devolver: rowsecurity = true
