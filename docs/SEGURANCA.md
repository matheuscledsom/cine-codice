# Auditoria de Segurança — OMNIPRISM v2.4.0

**Data da auditoria:** 2026-11-24
**Escopo auditado:** `src/`, `functions/`, `public/_headers`, `index.html`, `.env.example`, `.gitignore` e rascunhos SQL em `supabase/`.
**Regra aplicada:** Nenhum valor de segredo é registrado ou versionado; nenhuma alteração remota no Supabase foi executada.

---

## 1. Varredura XSS, `innerHTML` e Sanitização

| Vetor verificado | Escopo | Resultado | Ação / Evidência |
| --- | --- | --- | --- |
| `dangerouslySetInnerHTML` | `src/` | **0 ocorrências** | Bloqueado automaticamente em `scripts/validate-design.mjs`. |
| `innerHTML` / `outerHTML` / `insertAdjacentHTML` / `document.write` | `src/`, `functions/`, `index.html` | **0 ocorrências** | Renderização estritamente declarativa via React JSX. |
| `eval()` / `new Function()` | `src/`, `functions/` | **0 ocorrências** | Nenhuma avaliação dinâmica de strings. |
| Sanitização de entradas / importação | `src/utils/catalogImporters.js`, `src/services/peerProfileShare.js` | **OK (`dompurify`)** | Payload sanitizado via `DOMPurify` e validado em `tests/cine-codice.test.mjs`. |
| Protocolo em links dinâmicos (`href`) | `src/components/MediaCarousel.jsx` | **Corrigido na v2.4.0** | Restrito a `^https?://` para bloquear `javascript:` em URLs externas. |

---

## 2. Links Externos (`target="_blank"` + `rel="noopener noreferrer"`)

Foram auditadas todas as tags `<a ... target="_blank">` em `src/`:

1. `src/components/OnboardingFlow.jsx` (link de documentação do Google AI Studio): atualizado de `rel="noreferrer"` para `rel="noopener noreferrer"`.
2. `src/components/MediaCarousel.jsx` (link externo de slide de mídia): atualizado de `rel="noreferrer"` para `rel="noopener noreferrer"` com guarda de protocolo `https?://`.
3. `src/components/AiProvidersPanel.jsx` (links de documentação dos provedores de IA): atualizado de `rel="noreferrer"` para `rel="noopener noreferrer"`.

Status final: **100% dos links externos com `target="_blank"` usam `rel="noopener noreferrer"`**, protegido por teste automatizado em `tests/v240-fase1-fundacao-notas-seguranca.test.mjs`.

---

## 3. Auditoria de Segredos e Credenciais

- **Varredura por regex em código versionado** (`service_role`, `sk-*`, `AIza*`, JWT `eyJhbGciOiJIUzI1NiIs`): **0 ocorrências** em `src/`, `functions/`, `public/` e `.env.example`.
- **Arquivo `.env`:** confirmado fora do índice Git (`git ls-files .env` vazio) e listado em `.gitignore`.
- **Fallback `VITE_*`:** restrito ao modo `DEV` (`import.meta.env.DEV`); em produção, as chaves TMDB e OMDb são injetadas apenas no servidor via Cloudflare Pages Functions (`functions/api/tmdb/[[path]].js` e `functions/api/omdb.js`), exigindo Bearer token válido do Supabase.
- **Scrubbing de chaves em cache e logs:** `stripApiKeysFromUrl` remove `api_key`/`apikey` antes de gravar em cache IndexedDB; `src/lib/errorLogger.js` mascara `api_key`, `apikey`, `Bearer`, `sk-*` e `AIza*` antes de armazenar os últimos 50 erros locais.

---

## 4. Cabeçalhos HTTP de Segurança (`public/_headers`)

Cabeçalhos ativos em `/*`:

- `X-Content-Type-Options: nosniff` — impede MIME sniffing.
- `X-Frame-Options: SAMEORIGIN` *(adicionado na v2.4.0)* — proteção complementar contra clickjacking em navegadores legados (além de `frame-ancestors 'self'` no CSP).
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` *(adicionado na v2.4.0)* — força HTTPS no domínio em produção.
- `Referrer-Policy: strict-origin-when-cross-origin` — evita vazamento de caminhos completos em referrers externos.
- `Permissions-Policy: camera=(self), microphone=(), geolocation=(), interest-cohort=()` — princípio do menor privilégio.
- `Content-Security-Policy`:
  - `default-src 'self'`
  - `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`
  - `connect-src` com allowlist explícita dos hosts dos 4 domínios + Supabase + provedores de IA configuráveis (cobertura validada automaticamente em `tests/omniprism-v233-site-funcional.test.mjs`).
  - **Observação de revisão futura:** `img-src` ainda mantém `https:` ao final devido à variedade de CDNs de capas retornadas por Google Books, Open Library, iTunes/CoverArtArchive e CheapShark; recomenda-se consolidar proxy/allowlist de imagens quando todas as CDNs de capas estiverem mapeadas.

---

## 5. Resiliência de Dados & Error Boundary Global

- **Error Boundary Global (`src/components/ErrorBoundary.jsx` + `src/main.jsx`):** envolve toda a árvore `<App />` na raiz. Em caso de exceção inesperada:
  - Registra o erro sanitizado no log local (`omniprism_local_error_log_v1`, teto de 50 entradas, sem envio externo).
  - Preserva todos os dados em `IndexedDB` e `localStorage`.
  - Oferece botão **"Exportar backup (.json)"** diretamente a partir do `localStorage` (`downloadEmergencyBackupFromStorage`), funcionando mesmo quando o estado React foi interrompido.
- **Snapshots automáticos de proteção:** gravados antes de migrações aditivas do IndexedDB (`runRelationalSchemaMigrations`) e antes de restaurações de backup tanto no modo **Substituir** quanto no modo **Mesclar** (`restoreSnapshotWithSafety`).

---

## 6. Rascunhos Locais de RLS no Supabase (Não Aplicados)

- [`supabase/migrations/20261124_rls_catalog_works.sql`](../supabase/migrations/20261124_rls_catalog_works.sql): rascunho revisável original para habilitar RLS em `public.catalog_works` (`auth.uid() = user_id` em `SELECT`/`INSERT`/`UPDATE`/`DELETE`) e políticas de pasta por usuário no bucket `covers` (`(storage.foldername(name))[1] = auth.uid()::text`).
- [`supabase/migrations/20261126_v271_catalog_works_sync_additive.sql`](../supabase/migrations/20261126_v271_catalog_works_sync_additive.sql): migração estritamente **aditiva e idempotente** (sem `DROP`, sem alteração de tipos/constraints e sem criação/remoção de políticas RLS, preservando a política existente `owner_all_catalog`), adicionando apenas `deleted_at timestamptz NULL`, índices `(user_id, updated_at DESC)` e `(user_id, deleted_at)`, `REPLICA IDENTITY FULL` e inclusão condicional em `supabase_realtime`.
- [`supabase/verify_rls.sql`](../supabase/verify_rls.sql): consultas estritamente somente leitura (`SELECT`) para auditar colunas, índices, RLS, políticas existentes (com alerta para políticas potencialmente mais permissivas que `auth.uid() = user_id`), publicação realtime, bucket `covers` e registros sem `user_id` antes e depois de aplicar a migração manualmente no SQL Editor do Supabase.

---

## 7. Auto-Configuração (`/api/config`) e Política de Sessão (v2.7.1)

- **Endpoint público `/api/config` (`functions/api/config.js`):** devolve **exclusivamente** `{ supabaseUrl, supabaseAnonKey }` lidos de `SUPABASE_URL` e `SUPABASE_ANON_KEY` no Cloudflare Pages, com bloqueio de origem `cross-site` e recusa explícita de chaves privilegiadas (`sb_secret_*` ou JWT com role privilegiada). Ambas as informações são públicas por desenho e protegidas por RLS no Supabase.
- **Decisão explícita — NÃO espelhar sessão Supabase no IndexedDB:** a sessão de autenticação do Supabase (`omniprism_supabase_auth_v1`) contém `access_token` e `refresh_token`. Conforme a diretriz de segurança do projeto (nenhum token ou credencial de autenticação gravado no IndexedDB ou exportado em backups/snapshots), a sessão permanece **exclusivamente** no storage nativo do SDK Supabase (`localStorage`, com `persistSession: true` e `autoRefreshToken: true`), reforçada por:
  1. Solicitação best-effort de armazenamento persistente (`navigator.storage.persist()`) no login para reduzir evicção automática do navegador.
  2. Auto-configuração via `/api/config` (apenas dados públicos), garantindo que o usuário nunca precise redigitar URL/chave após reinstalação ou limpeza.
  3. Reinscrição automática de `onAuthStateChange` após hidratação de `/api/config`, renovação silenciosa ao retornar ao foco (`visibilitychange`), tolerância offline sem deslogar a interface e aviso claro em português caso a sessão realmente expire.
