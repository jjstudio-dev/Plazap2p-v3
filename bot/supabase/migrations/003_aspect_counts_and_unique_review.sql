-- ══════════════════════════════════════════════════════════════════════════════
-- Migración 003: per-aspect counts + UNIQUE constraint en seller_reviews
-- Aplicar después de 002_seller_reviews_and_fixes.sql
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. UNIQUE constraint en seller_reviews (BUG-5) ───────────────────────────
-- Protección a nivel DB contra valoraciones duplicadas del mismo reviewer
-- al mismo ratee (la capa JS con KV ya lo controla, esto es red de seguridad).
ALTER TABLE public.seller_reviews
  ADD CONSTRAINT uq_reviewer_ratee UNIQUE (reviewer_token, ratee_hex);

-- ── 2. Columnas de conteo por aspecto en seller_ratings (BUG-6) ──────────────
-- La migración 002 usaba review_count (global) como denominador para todos los
-- promedios de aspectos. Si un aspecto empieza a valorarse en la revisión N,
-- las siguientes valoraciones de ese aspecto usan un denominador inflado (N en
-- lugar de 1), produciendo promedios sesgados. La solución es rastrear cuántas
-- veces fue valorado cada aspecto individualmente.
ALTER TABLE public.seller_ratings
  ADD COLUMN IF NOT EXISTS n_comunicacion INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS n_cumplimiento INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS n_precio_justo INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS n_rapidez      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS n_confianza    INTEGER NOT NULL DEFAULT 0;

-- Reconstruir los conteos por aspecto desde el historial de seller_reviews.
-- Esto asegura que datos pre-migración tengan counts correctos.
UPDATE public.seller_ratings sr SET
  n_comunicacion = (SELECT COUNT(*) FROM public.seller_reviews rv WHERE rv.ratee_hex = sr.pubkey_hex AND rv.comunicacion IS NOT NULL),
  n_cumplimiento = (SELECT COUNT(*) FROM public.seller_reviews rv WHERE rv.ratee_hex = sr.pubkey_hex AND rv.cumplimiento IS NOT NULL),
  n_precio_justo = (SELECT COUNT(*) FROM public.seller_reviews rv WHERE rv.ratee_hex = sr.pubkey_hex AND rv.precio_justo IS NOT NULL),
  n_rapidez      = (SELECT COUNT(*) FROM public.seller_reviews rv WHERE rv.ratee_hex = sr.pubkey_hex AND rv.rapidez      IS NOT NULL),
  n_confianza    = (SELECT COUNT(*) FROM public.seller_reviews rv WHERE rv.ratee_hex = sr.pubkey_hex AND rv.confianza    IS NOT NULL);

-- ── 3. Stored procedure corregido (reemplaza el de 002) ──────────────────────
-- Usa los conteos por aspecto (n_X) como denominadores en lugar del global
-- review_count, eliminando el sesgo de aspectos introducidos tardíamente.
CREATE OR REPLACE FUNCTION public.increment_seller_rating(
  p_pubkey  TEXT,
  p_overall SMALLINT,
  p_aspects JSONB DEFAULT '{}'::JSONB
)
RETURNS public.seller_ratings
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row  public.seller_ratings;
  v_prev public.seller_ratings;
  v_newN INTEGER;

  v_com  NUMERIC(3,2);  v_nCom INTEGER;
  v_cum  NUMERIC(3,2);  v_nCum INTEGER;
  v_pj   NUMERIC(3,2);  v_nPj  INTEGER;
  v_rap  NUMERIC(3,2);  v_nRap INTEGER;
  v_con  NUMERIC(3,2);  v_nCon INTEGER;
BEGIN
  -- Bloqueo pesimista para evitar race conditions concurrentes
  SELECT * INTO v_prev
    FROM public.seller_ratings
    WHERE pubkey_hex = p_pubkey
    FOR UPDATE;

  IF NOT FOUND THEN
    -- Primera valoración: insertar directamente
    INSERT INTO public.seller_ratings (
      pubkey_hex, avg_overall, review_count,
      avg_comunicacion, avg_cumplimiento, avg_precio_justo, avg_rapidez, avg_confianza,
      n_comunicacion,   n_cumplimiento,   n_precio_justo,   n_rapidez,   n_confianza,
      last_active, created_at, updated_at
    ) VALUES (
      p_pubkey,
      p_overall::NUMERIC(3,2), 1,
      (p_aspects->>'comunicacion')::NUMERIC(3,2),
      (p_aspects->>'cumplimiento')::NUMERIC(3,2),
      (p_aspects->>'precio_justo')::NUMERIC(3,2),
      (p_aspects->>'rapidez')::NUMERIC(3,2),
      (p_aspects->>'confianza')::NUMERIC(3,2),
      CASE WHEN (p_aspects->>'comunicacion') IS NOT NULL THEN 1 ELSE 0 END,
      CASE WHEN (p_aspects->>'cumplimiento') IS NOT NULL THEN 1 ELSE 0 END,
      CASE WHEN (p_aspects->>'precio_justo') IS NOT NULL THEN 1 ELSE 0 END,
      CASE WHEN (p_aspects->>'rapidez')      IS NOT NULL THEN 1 ELSE 0 END,
      CASE WHEN (p_aspects->>'confianza')    IS NOT NULL THEN 1 ELSE 0 END,
      EXTRACT(EPOCH FROM NOW())::BIGINT, NOW(), NOW()
    )
    RETURNING * INTO v_row;
  ELSE
    v_newN := v_prev.review_count + 1;

    -- Comunicación: usar n_comunicacion como denominador (no review_count global)
    IF (p_aspects->>'comunicacion') IS NOT NULL THEN
      v_nCom := v_prev.n_comunicacion + 1;
      v_com  := CASE
        WHEN v_prev.n_comunicacion = 0
          THEN (p_aspects->>'comunicacion')::NUMERIC(3,2)
          ELSE ((v_prev.avg_comunicacion * v_prev.n_comunicacion + (p_aspects->>'comunicacion')::NUMERIC) / v_nCom)::NUMERIC(3,2)
      END;
    ELSE
      v_nCom := v_prev.n_comunicacion;
      v_com  := v_prev.avg_comunicacion;
    END IF;

    -- Cumplimiento
    IF (p_aspects->>'cumplimiento') IS NOT NULL THEN
      v_nCum := v_prev.n_cumplimiento + 1;
      v_cum  := CASE
        WHEN v_prev.n_cumplimiento = 0
          THEN (p_aspects->>'cumplimiento')::NUMERIC(3,2)
          ELSE ((v_prev.avg_cumplimiento * v_prev.n_cumplimiento + (p_aspects->>'cumplimiento')::NUMERIC) / v_nCum)::NUMERIC(3,2)
      END;
    ELSE
      v_nCum := v_prev.n_cumplimiento;
      v_cum  := v_prev.avg_cumplimiento;
    END IF;

    -- Precio justo
    IF (p_aspects->>'precio_justo') IS NOT NULL THEN
      v_nPj := v_prev.n_precio_justo + 1;
      v_pj  := CASE
        WHEN v_prev.n_precio_justo = 0
          THEN (p_aspects->>'precio_justo')::NUMERIC(3,2)
          ELSE ((v_prev.avg_precio_justo * v_prev.n_precio_justo + (p_aspects->>'precio_justo')::NUMERIC) / v_nPj)::NUMERIC(3,2)
      END;
    ELSE
      v_nPj := v_prev.n_precio_justo;
      v_pj  := v_prev.avg_precio_justo;
    END IF;

    -- Rapidez
    IF (p_aspects->>'rapidez') IS NOT NULL THEN
      v_nRap := v_prev.n_rapidez + 1;
      v_rap  := CASE
        WHEN v_prev.n_rapidez = 0
          THEN (p_aspects->>'rapidez')::NUMERIC(3,2)
          ELSE ((v_prev.avg_rapidez * v_prev.n_rapidez + (p_aspects->>'rapidez')::NUMERIC) / v_nRap)::NUMERIC(3,2)
      END;
    ELSE
      v_nRap := v_prev.n_rapidez;
      v_rap  := v_prev.avg_rapidez;
    END IF;

    -- Confianza
    IF (p_aspects->>'confianza') IS NOT NULL THEN
      v_nCon := v_prev.n_confianza + 1;
      v_con  := CASE
        WHEN v_prev.n_confianza = 0
          THEN (p_aspects->>'confianza')::NUMERIC(3,2)
          ELSE ((v_prev.avg_confianza * v_prev.n_confianza + (p_aspects->>'confianza')::NUMERIC) / v_nCon)::NUMERIC(3,2)
      END;
    ELSE
      v_nCon := v_prev.n_confianza;
      v_con  := v_prev.avg_confianza;
    END IF;

    UPDATE public.seller_ratings SET
      avg_overall      = ((v_prev.avg_overall * v_prev.review_count + p_overall) / v_newN)::NUMERIC(3,2),
      review_count     = v_newN,
      avg_comunicacion = v_com,  n_comunicacion = v_nCom,
      avg_cumplimiento = v_cum,  n_cumplimiento = v_nCum,
      avg_precio_justo = v_pj,   n_precio_justo = v_nPj,
      avg_rapidez      = v_rap,  n_rapidez      = v_nRap,
      avg_confianza    = v_con,  n_confianza    = v_nCon,
      last_active      = EXTRACT(EPOCH FROM NOW())::BIGINT,
      updated_at       = NOW()
    WHERE pubkey_hex = p_pubkey
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

-- ── 4. Permisos: restringir el stored procedure a service_role ───────────────
-- Por defecto PostgreSQL otorga EXECUTE a PUBLIC en toda función nueva.
-- Con SECURITY DEFINER, el rol anon (clave pública de Supabase, expuesta en
-- frontends) podría llamar directamente a esta función vía la REST API y
-- manipular los ratings de cualquier vendedor sin pasar por los controles
-- del bot (rate limit KV, token SHA-256, UNIQUE constraint).
-- Solo service_role (el bot via SUPABASE_SERVICE_KEY) debe poder ejecutarla.
REVOKE EXECUTE ON FUNCTION public.increment_seller_rating(TEXT, SMALLINT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_seller_rating(TEXT, SMALLINT, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_seller_rating(TEXT, SMALLINT, JSONB) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.increment_seller_rating(TEXT, SMALLINT, JSONB) TO service_role;

-- ── Verificación post-migración ───────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'seller_ratings' AND column_name LIKE 'n_%';
-- → debe devolver: n_comunicacion, n_cumplimiento, n_precio_justo, n_rapidez, n_confianza
-- SELECT conname FROM pg_constraint WHERE conname = 'uq_reviewer_ratee';
-- → debe devolver: uq_reviewer_ratee
-- SELECT grantee, privilege_type FROM information_schema.routine_privileges
--   WHERE routine_name = 'increment_seller_rating';
-- → solo debe aparecer: service_role | EXECUTE
