-- ============================================================================
-- RASCUNHO: revisar antes de aplicar
-- ============================================================================
-- OMNIPRISM v2.4.0 — Verificação Somente Leitura de RLS (Supabase / PostgreSQL)
-- Contém EXCLUSIVAMENTE consultas SELECT (não altera tabelas, dados ou políticas).
-- ============================================================================

-- 1. Confirma se RLS está habilitado em public.catalog_works e storage.objects
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE (n.nspname = 'public' AND c.relname = 'catalog_works')
   OR (n.nspname = 'storage' AND c.relname = 'objects')
ORDER BY n.nspname, c.relname;

-- 2. Lista todas as políticas ativas em public.catalog_works
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
ORDER BY cmd, policyname;

-- 3. Lista todas as políticas de storage.objects relacionadas ao bucket 'covers'
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
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND (
    policyname ILIKE '%cover%'
    OR coalesce(qual, '') ILIKE '%covers%'
    OR coalesce(with_check, '') ILIKE '%covers%'
  )
ORDER BY cmd, policyname;

-- 4. Verifica configuração do bucket 'covers'
SELECT
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  created_at,
  updated_at
FROM storage.buckets
WHERE id = 'covers';

-- 5. Audita se existem registros sem user_id em public.catalog_works (devem ser 0)
SELECT
  count(*) AS total_rows,
  count(*) FILTER (WHERE user_id IS NULL) AS rows_without_user_id,
  count(DISTINCT user_id) AS distinct_users
FROM public.catalog_works;
