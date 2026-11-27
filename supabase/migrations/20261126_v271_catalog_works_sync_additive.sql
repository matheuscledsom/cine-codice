-- ============================================================================
-- RASCUNHO: revisar antes de aplicar
-- ============================================================================
-- OMNIPRISM v2.7.1 — Migração Aditiva e Idempotente de Sincronização (Supabase)
--
-- GARANTIAS DE SEGURANÇA DESTA MIGRAÇÃO:
-- - SOMENTE ADITIVA e IDEMPOTENTE (pode ser executada com segurança mesmo se
--   a tabela ou parte das colunas/índices já existir).
-- - NUNCA executa DROP, NUNCA altera tipos de colunas existentes, NUNCA apaga
--   dados e NUNCA remove políticas RLS antigas sem autorização explícita.
-- - Cria políticas com NOMES NOVOS (prefixo `omniprism_v271_`).
-- - Execute PRIMEIRO `supabase/verify_rls.sql` (somente leitura) para auditar
--   o estado atual do seu banco.
-- - ATENÇÃO: no PostgreSQL, políticas PERMISSIVE são combinadas com OR. Se o
--   resultado da consulta final apontar alguma política antiga mais permissiva
--   que `auth.uid() = user_id` (ex.: `USING (true)`), avise antes de removê-la.
-- ============================================================================

-- 1. Garante a tabela public.catalog_works (somente se ainda não existir)
CREATE TABLE IF NOT EXISTS public.catalog_works (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  domain text NOT NULL DEFAULT 'cinema',
  media_type text NOT NULL DEFAULT 'movie',
  title text NOT NULL,
  creator text DEFAULT '',
  release_year integer,
  status text NOT NULL DEFAULT 'queued',
  rating integer,
  external_rating jsonb,
  external_ids jsonb DEFAULT '{}'::jsonb,
  cover_url text,
  backdrop_url text,
  synopsis text DEFAULT '',
  genres jsonb DEFAULT '[]'::jsonb,
  tags jsonb DEFAULT '[]'::jsonb,
  progress_data jsonb DEFAULT '{}'::jsonb,
  franchise_key text,
  favorite_rank integer,
  favorite_quote_or_scene text,
  personal_notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

-- 2. Coluna aditiva nullable para tombstones (soft delete entre dispositivos)
ALTER TABLE public.catalog_works
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

-- 3. Índices aditivos (não alteram índices existentes)
CREATE INDEX IF NOT EXISTS idx_catalog_works_user_updated_v271
  ON public.catalog_works (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_catalog_works_user_deleted_v271
  ON public.catalog_works (user_id, deleted_at);

-- 4. Habilita Row Level Security em public.catalog_works
ALTER TABLE public.catalog_works ENABLE ROW LEVEL SECURITY;

-- 5. Políticas RLS aditivas com nomes NOVOS em public.catalog_works
--    (não remove nem sobrescreve políticas existentes)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'catalog_works'
      AND policyname = 'omniprism_v271_catalog_works_select_own'
  ) THEN
    CREATE POLICY "omniprism_v271_catalog_works_select_own"
      ON public.catalog_works
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'catalog_works'
      AND policyname = 'omniprism_v271_catalog_works_insert_own'
  ) THEN
    CREATE POLICY "omniprism_v271_catalog_works_insert_own"
      ON public.catalog_works
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'catalog_works'
      AND policyname = 'omniprism_v271_catalog_works_update_own'
  ) THEN
    CREATE POLICY "omniprism_v271_catalog_works_update_own"
      ON public.catalog_works
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'catalog_works'
      AND policyname = 'omniprism_v271_catalog_works_delete_own'
  ) THEN
    CREATE POLICY "omniprism_v271_catalog_works_delete_own"
      ON public.catalog_works
      FOR DELETE
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END
$$;

-- 6. Políticas RLS aditivas com nomes NOVOS no bucket 'covers' (storage.objects)
--    Padrão usado pelo cliente: '<auth.uid()>/<cloudWorkId>.<ext>'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'omniprism_v271_covers_select_own'
  ) THEN
    CREATE POLICY "omniprism_v271_covers_select_own"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'covers'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'omniprism_v271_covers_insert_own'
  ) THEN
    CREATE POLICY "omniprism_v271_covers_insert_own"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'covers'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'omniprism_v271_covers_update_own'
  ) THEN
    CREATE POLICY "omniprism_v271_covers_update_own"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'covers'
        AND (storage.foldername(name))[1] = auth.uid()::text
      )
      WITH CHECK (
        bucket_id = 'covers'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'omniprism_v271_covers_delete_own'
  ) THEN
    CREATE POLICY "omniprism_v271_covers_delete_own"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'covers'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END
$$;

-- 7. Realtime (opcional / extra — o app não depende dele, mas acelera atualizações)
ALTER TABLE public.catalog_works REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'catalog_works'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.catalog_works;
  END IF;
END
$$;

-- 8. Verificação final: lista políticas antigas possivelmente mais permissivas
--    que auth.uid() = user_id (políticas antigas NÃO foram removidas).
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'catalog_works'
  AND policyname NOT LIKE 'omniprism_v271_%'
  AND (
    lower(trim(coalesce(qual, ''))) = 'true'
    OR lower(trim(coalesce(with_check, ''))) = 'true'
    OR (
      coalesce(qual, '') NOT ILIKE '%auth.uid()%'
      AND coalesce(with_check, '') NOT ILIKE '%auth.uid()%'
    )
    OR ('anon' = ANY(roles))
  )
ORDER BY policyname;
