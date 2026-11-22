# Progresso — Cine Códice v1.1.0 · Lumière

**Branch ativa:** `feat/v1.1.0-lumiere`
**Última fase concluída:** `1A`
**Próxima fase:** `1B` (Dados e migração)

## Linha do Tempo das Fases
- [x] **Fase 0 — Auditoria (somente leitura)** — concluída na `main` sem alterações.
- [x] **Fase 1A — Infraestrutura de API** — concluída na branch `feat/v1.1.0-lumiere`.
  - Criados [`src/api/limits.js`](../src/api/limits.js), [`src/api/cacheDb.js`](../src/api/cacheDb.js), [`src/api/httpClient.js`](../src/api/httpClient.js), [`src/api/anilistBatch.js`](../src/api/anilistBatch.js), [`src/lib/ratings.js`](../src/lib/ratings.js) e [`src/lib/idBridge.js`](../src/lib/idBridge.js).
  - Estendido [`src/services/cinemaApi.js`](../src/services/cinemaApi.js) com OMDb, `external_ids` e `belongs_to_collection` do TMDB, `/lookup/shows?imdb=` da TVmaze, episódios Jikan (com flag `filler`), batch AniList por aliases e restrição de `import.meta.env.VITE_*` ao modo `DEV`.
  - Atualizado [`public/_headers`](../public/_headers) liberando `www.omdbapi.com` e hosts de imagem (`image.tmdb.org`, `s4.anilist.co`, `cdn.myanimelist.net`, `static.tvmaze.com`, `m.media-amazon.com`, `img.omdbapi.com`).
  - Criada suíte [`tests/fase1a-api.test.mjs`](../tests/fase1a-api.test.mjs) (`24/24` testes passando no total, sem rede).
  - Verificações extras da Fase 1A: remoção de `apikey`/`api_key` antes de gerar chaves de cache/deduplicação, mascaramento de chaves em mensagens de erro e proteção completa contra `IndexedDB` bloqueado (modo privado / `SecurityError` / cota cheia).
- [ ] **Fase 1B — Dados, migração, chaves OMDb e Sobre/Créditos**
- [ ] **Fase 2 — Onboarding e Configurações**
- [ ] **Fase 3 — Notas externas e backdrops**
- [ ] **Fase 4 — Episódios, Obra e Franquia**
- [ ] **Fase 5 — Home**
- [ ] **Fase 6 — Perfil, social oculto e resíduos de livro**
- [ ] **Fase 7 — Testes finais, versão 1.1.0 e publicação**

## Resumo da Auditoria (Fase 0)
- Repositório na `main` com commit único `7738835` (`v1.0.0`), sem alterações não commitadas e zero chaves secretas no histórico ou código.
- Suíte inicial: `10/10` testes aprovados em `tests/cine-codice.test.mjs`.
- Armazenamento atual: catálogo (`cine_codice_backlog_v1`), perfil (`cine_codice_profile_v1`) e chaves no `localStorage`; snapshots de backup, busca 7d e miniaturas no `IndexedDB`.
- Escala de nota do usuário confirmada: inteira **0–100**.
- Riscos detectados: criação automática de `rating: 80` ao concluir obra (`useBacklog.js`, `AddScreen.jsx`), `migrateDatabase` não executado no boot do catálogo, `public/_headers` sem domínio da OMDb, e presença de módulos/textos sociais legados de livro.

## Decisões Registradas (sem chaves)
- **D1–D2:** OMDb adicionada para Filmes/Séries (`https://www.omdbapi.com`); ponte canônica `ids: { tmdb, imdb, tvmaze, anilist, mal }` mantendo espelho nos campos planos durante a v1.1.0.
- **D3:** Chaves mantidas no `localStorage` (`cine_codice_tmdb_key_v1`, nova `cine_codice_omdb_key_v1`). Fallback de `VITE_*` restrito a `import.meta.env.DEV`.
- **D4:** Fila por provedor e limites em `src/api/limits.js`, deduplicação *in-flight*, retry com `Retry-After` em HTTP `429`, batching GraphQL com aliases na AniList, e cache persistente em `IndexedDB` (`ratings`, `episodes`, `relations`, `search`) + armazenamento durável para `episodeEvaluations`.
- **D5:** Escala 0–100 preservada no app; `src/lib/ratings.js` normaliza notas externas para 0–100 apenas para comparação e cálculo de médias, nunca inventando `"N/A"` nem valores ausentes.
- **Social & Legado:** Flag `SOCIAL_ENABLED = false` em `src/config/` (Fase 6) e marcação `ratingSource: 'legacy-default'` (Fase 1B) sem apagar dados existentes.
