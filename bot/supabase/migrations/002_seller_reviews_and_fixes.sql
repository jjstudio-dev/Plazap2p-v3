-- ══════════════════════════════════════════════════════════════════════════════
-- Migración 002: seller_reviews + fixes en seller_ratings + stored procedure atómico
-- Aplicar después de 001_seller_ratings_schema_rls.sql
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Añadir created_at a seller_ratings (BUG-3) ────────────────────────────
ALTER TABLE public.seller_ratings
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── 2. Tabla de reviews individuales (BUG-2) ─────────────────────────────────
-- Audit trail completo: permite recalcular agregados, detectar fraude y
-- revertir valoraciones maliciosas sin perder datos.
CREATE TABLE IF NOT EXISTS public.seller_reviews (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ratee_hex       TEXT         NOT NULL CHECK (ratee_hex ~ '^[0-9a-f]{64}$'),
  -- reviewer_token: SHA-256(userId:sellerHex) truncado a 24 chars — no reversible,
  -- permite auditar sin exponer la identidad de Telegram del reviewer.
  reviewer_token  TEXT         NOT NULL CHECK (char_length(reviewer_token) = 24),
  overall         SMALLINT     NOT NULL CHECK (overall BETWEEN 1 AND 5),
  comunicacion    SMALLINT     CHECK (comunicacion IS NULL OR comunicacion BETWEEN 1 AND 5),
  cumplimiento    SMALLINT     CHECK (cumplimiento IS NULL OR cumplimiento BETWEEN 1 AND 5),
  precio_justo    SMALLINT     CHECK (precio_justo IS NULL OR precio_justo BETWEEN 1 AND 5),
  rapidez         SMALLINT     CHECK (rapidez IS NULL OR rapidez BETWEEN 1 AND 5),
  confianza       SMALLINT     CHECK (confianza IS NULL OR confianza BETWEEN 1 AND 5),
  comentario      TEXT         CHECK (char_length(comentario) <= 300),
  nostr_event_id  TEXT,        -- id del evento kind 1985 publicado en Nostr
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Índice para consultas por vendedor (listar reviews de un npub)
CREATE INDEX IF NOT EXISTS idx_seller_reviews_ratee_hex
  ON public.seller_reviews (ratee_hex, created_at DESC);

-- Índice para detección de duplicados (auditoría de reviewer_token)
CREATE INDEX IF NOT EXISTS idx_seller_reviews_reviewer_token
  ON public.seller_reviews (reviewer_token);

-- ── 3. RLS en seller_reviews ──────────────────────────────────────────────────
ALTER TABLE public.seller_reviews ENABLE ROW LEVEL SECURITY;

-- Lectura pública: cualquiera puede leer el historial de valoraciones
DROP POLICY IF EXISTS "seller_reviews_public_read" ON public.seller_reviews;
CREATE POLICY "seller_reviews_public_read"
  ON public.seller_reviews
  FOR SELECT
  USING (true);

-- Escritura solo service_role (el bot)
DROP POLICY IF EXISTS "seller_reviews_service_write" ON public.seller_reviews;
CREATE POLICY "seller_reviews_service_write"
  ON public.seller_reviews
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── 4. Stored procedure atómico para incrementar rating (BUG-4) ──────────────
-- Usa INSERT ... ON CONFLICT DO UPDATE que en PostgreSQL es atómico a nivel de fila.
-- Elimina la race condition del patrón read-compute-write de la capa JS.
--
-- Parámetros:
--   p_pubkey   — pubkey hex 64 chars del vendedor
--   p_overall  — puntuación global 1-5
--   p_aspects  — JSONB con campos opcionales:
--                { "comunicacion": 4, "cumplimiento": 5, "precio_justo": null, ... }
--
-- Retorna la fila actualizada de seller_ratings.
CREATE OR REPLACE FUNCTION public.increment_seller_rating(
  p_pubkey  TEXT,
  p_overall SMALLINT,
  p_aspects JSONB DEFAULT '{}'::JSONB
)
RETURNS public.seller_ratings
LANGUAGE plpgsql
SECURITY DEFINER  -- Ejecuta con los permisos del owner, no del caller
AS $$
DECLARE
  v_row   public.seller_ratings;
  v_prev  public.seller_ratings;
  v_newN  INTEGER;

  -- Helpers: calcula nuevo promedio de un aspecto dado el previo y el nuevo score
  v_com   NUMERIC(3,2);
  v_cum   NUMERIC(3,2);
  v_pj    NUMERIC(3,2);
  v_rap   NUMERIC(3,2);
  v_con   NUMERIC(3,2);
BEGIN
  -- Bloqueo pesimista: si la fila existe, la bloqueamos para evitar concurrencia
  SELECT * INTO v_prev
    FROM public.seller_ratings
    WHERE pubkey_hex = p_pubkey
    FOR UPDATE;

  IF NOT FOUND THEN
    -- Primera valoración: insertar con valores iniciales
    INSERT INTO public.seller_ratings (
      pubkey_hex, avg_overall, review_count,
      avg_comunicacion, avg_cumplimiento, avg_precio_justo, avg_rapidez, avg_confianza,
      last_active, created_at, updated_at
    ) VALUES (
      p_pubkey,
      p_overall::NUMERIC(3,2),
      1,
      (p_aspects->>'comunicacion')::SMALLINT,
      (p_aspects->>'cumplimiento')::SMALLINT,
      (p_aspects->>'precio_justo')::SMALLINT,
      (p_aspects->>'rapidez')::SMALLINT,
      (p_aspects->>'confianza')::SMALLINT,
      EXTRACT(EPOCH FROM NOW())::BIGINT,
      NOW(),
      NOW()
    )
    RETURNING * INTO v_row;
  ELSE
    v_newN := v_prev.review_count + 1;

    -- Calcular nuevos promedios de aspectos
    -- Si el aspecto anterior era NULL (nunca valorado), la primera valoración vale 100%
    -- Si ya tenía valor, promediamos con la historia

    v_com := CASE
      WHEN (p_aspects->>'comunicacion') IS NULL THEN v_prev.avg_comunicacion
      WHEN v_prev.avg_comunicacion IS NULL       THEN (p_aspects->>'comunicacion')::NUMERIC(3,2)
      ELSE ((v_prev.avg_comunicacion * v_prev.review_count + (p_aspects->>'comunicacion')::NUMERIC) / v_newN)::NUMERIC(3,2)
    END;

    v_cum := CASE
      WHEN (p_aspects->>'cumplimiento') IS NULL THEN v_prev.avg_cumplimiento
      WHEN v_prev.avg_cumplimiento IS NULL       THEN (p_aspects->>'cumplimiento')::NUMERIC(3,2)
      ELSE ((v_prev.avg_cumplimiento * v_prev.review_count + (p_aspects->>'cumplimiento')::NUMERIC) / v_newN)::NUMERIC(3,2)
    END;

    v_pj := CASE
      WHEN (p_aspects->>'precio_justo') IS NULL THEN v_prev.avg_precio_justo
      WHEN v_prev.avg_precio_justo IS NULL       THEN (p_aspects->>'precio_justo')::NUMERIC(3,2)
      ELSE ((v_prev.avg_precio_justo * v_prev.review_count + (p_aspects->>'precio_justo')::NUMERIC) / v_newN)::NUMERIC(3,2)
    END;

    v_rap := CASE
      WHEN (p_aspects->>'rapidez') IS NULL THEN v_prev.avg_rapidez
      WHEN v_prev.avg_rapidez IS NULL       THEN (p_aspects->>'rapidez')::NUMERIC(3,2)
      ELSE ((v_prev.avg_rapidez * v_prev.review_count + (p_aspects->>'rapidez')::NUMERIC) / v_newN)::NUMERIC(3,2)
    END;

    v_con := CASE
      WHEN (p_aspects->>'confianza') IS NULL THEN v_prev.avg_confianza
      WHEN v_prev.avg_confianza IS NULL       THEN (p_aspects->>'confianza')::NUMERIC(3,2)
      ELSE ((v_prev.avg_confianza * v_prev.review_count + (p_aspects->>'confianza')::NUMERIC) / v_newN)::NUMERIC(3,2)
    END;

    UPDATE public.seller_ratings SET
      avg_overall      = ((v_prev.avg_overall * v_prev.review_count + p_overall) / v_newN)::NUMERIC(3,2),
      review_count     = v_newN,
      avg_comunicacion = v_com,
      avg_cumplimiento = v_cum,
      avg_precio_justo = v_pj,
      avg_rapidez      = v_rap,
      avg_confianza    = v_con,
      last_active      = EXTRACT(EPOCH FROM NOW())::BIGINT,
      updated_at       = NOW()
    WHERE pubkey_hex = p_pubkey
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

-- ── Verificación post-migración ───────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'seller_ratings';
-- → debe incluir 'created_at'
-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'seller_reviews';
-- → rowsecurity = true
-- SELECT routine_name FROM information_schema.routines WHERE routine_name = 'increment_seller_rating';
-- → debe aparecer
