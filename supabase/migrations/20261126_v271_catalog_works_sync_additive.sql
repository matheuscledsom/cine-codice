-- ============================================================================
-- RASCUNHO: revisar antes de aplicar
-- ============================================================================
-- OMNIPRISM v2.7.1 — Migração Aditiva e Idempotente de Sincronização (Supabase)
--
-- Baseada na auditoria real de `public.catalog_works`:
-- - A tabela `public.catalog_works`, o RLS, a política `owner_all_catalog`
--   (`auth.uid() = user_id`) e as constraints existentes JÁ estão corretas e
--   NÃO são tocadas nem duplicadas por este script.
-- - NUNCA executa DROP, NUNCA altera tipos ou constraints e NUNCA cria ou
--   remove políticas RLS.
-- ============================================================================

-- 1. Coluna aditiva nullable para tombstones (soft delete entre aparelhos)
ALTER TABLE public.catalog_works
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

-- 2. Índices aditivos para ordenação por atualização e filtragem de tombstones
CREATE INDEX IF NOT EXISTS idx_catalog_works_user_updated_v271
  ON public.catalog_works (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_catalog_works_user_deleted_v271
  ON public.catalog_works (user_id, deleted_at);

-- 3. REPLICA IDENTITY FULL (permite payload completo em eventos de atualização/exclusão)
ALTER TABLE public.catalog_works REPLICA IDENTITY FULL;

-- 4. Publicação supabase_realtime (opcional/extra — adiciona somente se ainda não estiver)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'catalog_works'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.catalog_works;
  END IF;
END
$$;
