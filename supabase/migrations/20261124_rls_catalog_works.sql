-- ============================================================================
-- RASCUNHO: revisar antes de aplicar
-- ============================================================================
-- OMNIPRISM v2.4.0 — Políticas de Row Level Security (RLS)
-- Alvos:
--   1) Tabela public.catalog_works (isolamento estrito por auth.uid() = user_id)
--   2) Bucket de Storage 'covers' (storage.objects, caminho '<user_id>/<work_id>.<ext>')
--
-- IMPORTANTE:
-- - Este arquivo é um RASCUNHO LOCAL e NÃO foi aplicado remotamente.
-- - Revise as políticas existentes antes de executar no SQL Editor do Supabase.
-- - Execute supabase/verify_rls.sql (somente leitura) antes e depois para auditar.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. RLS em public.catalog_works
-- ----------------------------------------------------------------------------
ALTER TABLE public.catalog_works ENABLE ROW LEVEL SECURITY;

-- Opcional (revisar se funções/serviços internos precisam bypassar RLS):
-- ALTER TABLE public.catalog_works FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "catalog_works_select_own" ON public.catalog_works;
CREATE POLICY "catalog_works_select_own"
  ON public.catalog_works
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "catalog_works_insert_own" ON public.catalog_works;
CREATE POLICY "catalog_works_insert_own"
  ON public.catalog_works
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "catalog_works_update_own" ON public.catalog_works;
CREATE POLICY "catalog_works_update_own"
  ON public.catalog_works
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "catalog_works_delete_own" ON public.catalog_works;
CREATE POLICY "catalog_works_delete_own"
  ON public.catalog_works
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Garantia de índice para consultas filtradas por user_id
CREATE INDEX IF NOT EXISTS idx_catalog_works_user_updated
  ON public.catalog_works (user_id, updated_at DESC);

-- ----------------------------------------------------------------------------
-- 2. RLS no bucket 'covers' (storage.objects)
-- Padrão de caminho usado pelo app (omniSyncService.js): '<auth.uid()>/<cloudWorkId>.<ext>'
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "covers_select_own" ON storage.objects;
CREATE POLICY "covers_select_own"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "covers_insert_own" ON storage.objects;
CREATE POLICY "covers_insert_own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "covers_update_own" ON storage.objects;
CREATE POLICY "covers_update_own"
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

DROP POLICY IF EXISTS "covers_delete_own" ON storage.objects;
CREATE POLICY "covers_delete_own"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

COMMIT;
