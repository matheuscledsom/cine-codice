-- ============================================================================
-- RASCUNHO: revisar antes de aplicar
-- ============================================================================
-- OMNIPRISM v2.7.1 — Auditoria Somente Leitura (Supabase / PostgreSQL)
-- Contém EXCLUSIVAMENTE consultas SELECT (não modifica tabelas, dados,
-- colunas, índices ou políticas). Rode este script PRIMEIRO no SQL Editor
-- e envie o resultado antes de aplicar qualquer migração.
-- ============================================================================

-- 1. Colunas e tipos atuais da tabela public.catalog_works (inclui checagem de deleted_at)
SELECT
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name = 'catalog_works'
ORDER BY c.ordinal_position;

-- 2. Índices existentes em public.catalog_works
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'catalog_works'
ORDER BY indexname;

-- 3. Estado de RLS e REPLICA IDENTITY em public.catalog_works e storage.objects
-- relreplident: 'd' = default (PK), 'f' = full, 'i' = index, 'n' = nothing
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  c.relreplident AS replica_identity_code
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE (n.nspname = 'public' AND c.relname = 'catalog_works')
   OR (n.nspname = 'storage' AND c.relname = 'objects')
ORDER BY n.nspname, c.relname;

-- 4. Todas as políticas RLS existentes em public.catalog_works
-- ATENÇÃO: políticas PERMISSIVE combinam com OR no PostgreSQL.
-- A coluna security_flag sinaliza políticas possivelmente mais permissivas
-- do que auth.uid() = user_id (ex.: USING (true) ou acesso para anon/public).
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check,
  CASE
    WHEN lower(trim(coalesce(qual, ''))) = 'true'
      OR lower(trim(coalesce(with_check, ''))) = 'true'
      OR (
        coalesce(qual, '') NOT ILIKE '%auth.uid()%'
        AND coalesce(with_check, '') NOT ILIKE '%auth.uid()%'
      )
      OR ('anon' = ANY(roles))
      OR ('public' = ANY(roles) AND coalesce(qual, '') NOT ILIKE '%auth.uid()%')
    THEN 'ALERTA: possivelmente mais permissiva que auth.uid() = user_id'
    ELSE 'OK (escopo por auth.uid())'
  END AS security_flag
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'catalog_works'
ORDER BY cmd, policyname;

-- 5. Todas as políticas de storage.objects relacionadas ao bucket 'covers'
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check,
  CASE
    WHEN lower(trim(coalesce(qual, ''))) = 'true'
      OR lower(trim(coalesce(with_check, ''))) = 'true'
      OR (
        coalesce(qual, '') NOT ILIKE '%auth.uid()%'
        AND coalesce(with_check, '') NOT ILIKE '%auth.uid()%'
      )
      OR ('anon' = ANY(roles))
    THEN 'ALERTA: possivelmente mais permissiva que pasta por auth.uid()'
    ELSE 'OK (escopo por auth.uid())'
  END AS security_flag
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND (
    policyname ILIKE '%cover%'
    OR coalesce(qual, '') ILIKE '%covers%'
    OR coalesce(with_check, '') ILIKE '%covers%'
  )
ORDER BY cmd, policyname;

-- 6. Publicação supabase_realtime (verifica se public.catalog_works já participa)
SELECT
  p.pubname AS publication_name,
  pt.schemaname,
  pt.tablename
FROM pg_publication p
LEFT JOIN pg_publication_tables pt
  ON pt.pubname = p.pubname
  AND pt.schemaname = 'public'
  AND pt.tablename = 'catalog_works'
WHERE p.pubname = 'supabase_realtime';

-- 7. Configuração do bucket 'covers' no Storage
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

-- 8. Contagem geral e auditoria de user_id em public.catalog_works
SELECT
  count(*) AS total_rows,
  count(*) FILTER (WHERE user_id IS NULL) AS rows_without_user_id,
  count(DISTINCT user_id) AS distinct_users
FROM public.catalog_works;
