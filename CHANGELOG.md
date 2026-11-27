# Changelog — Projeto Códice

## Regras de Versionamento Nominal e Semântico

Este projeto adota versionamento semântico (`MAJOR.MINOR.PATCH`) combinado a codinomes nominais para grandes marcos:

- **Pequenas atualizações / correções (`patch` / `minor`):** incrementam apenas os números (`4.1.1`, `4.1.2`, `4.2.0`), mantendo o codinome oficial atual.
- **Grandes atualizações (`major`):** recebem um novo codinome oficial (ex.: *Ymir 4.1.0*, *Odin 5.0.0*, *Alexandria 6.0.0*).

Automação via CLI (`scripts/bump-version.mjs`):

```bash
npm run version:patch
npm run version:minor
npm run version:major -- --name="Odin"
```

---

## [v2.7.2] — 2026-11

**Resumo:** Correção de carregamento de capas no Service Worker (CSP + Workbox): liberação explícita em `connect-src` (`public/_headers`) de todos os hosts de capa interceptados pelo Workbox (`images.igdb.com`, `media.rawg.io`, `shared.fastly.steamstatic.com`, `cdn.akamai.steamstatic.com`, `cdn.cloudflare.steamstatic.com`, `image.tmdb.org`, `s4.anilist.co`, `img.anili.st`, `cdn.myanimelist.net`, `static.tvmaze.com`, `m.media-amazon.com`, `img.omdbapi.com`, `commons.wikimedia.org`, `upload.wikimedia.org`, `books.google.com`, `books.googleusercontent.com`, `covers.openlibrary.org`, `*.mzstatic.com`); separação do `CacheFirst` do Supabase em `vite.config.js` restrito exclusivamente a `/storage/v1/object/public/covers/*` para nunca cachear `/rest/v1/*` nem `/auth/v1/*`; preservação de URLs protocol-relative (`//...`) no sync e em `CoverImage.jsx`; e correção do rótulo de tipo/domínio nos cartazes editoriais gerados (`JOGO`, `LIVRO`, `MANGÁ`, `ÁLBUM`, `FILME`).

## [v2.7.1] — 2026-11

**Resumo:** OmniPrism v2.7.1 ("Conexão Confiável"): auto-configuração pública do Supabase via `/api/config` (`{ supabaseUrl, supabaseAnonKey }`, nunca chaves secretas) com entrada manual recolhida em Avançado; login persistente sem espelhar refresh token no IndexedDB (com `navigator.storage.persist()`, reinscrição automática de `onAuthStateChange`, renovação silenciosa ao retornar ao foco e avisos claros em caso de sessão expirada); sincronização bidirecional entre PC e celular independente do Realtime com fila offline persistente, retry exponencial, tombstones via `deleted_at` com fallback automático pré-SQL, proteção contra timestamps inventados em obras legadas e resumo + snapshot automático na 1ª conexão de um segundo aparelho; capas resilientes com estado de autenticação na chave de cache da busca, aviso claro quando deslogado, correção do `coverUrl` duplicado em `useBacklog.js`, retry automático no `CoverImage.jsx` e hosts de capa listados explicitamente em `img-src` e no Workbox; e versão unificada em fonte única (`src/config/appVersion.js`).

## [v2.4.0] — 2026-11

**Resumo:** OmniPrism v2.4.0 ("Refino & Profundidade"): modelo único de avaliação em 5 estrelas com meia estrela (`0.5` a `5.0`, interno `0–100`) + marca opcional **"Obra da vida"** (`progress_data.lifeWork`, retrocompatível com o antigo `11` de Games) + avaliação opcional por **5 critérios por domínio** (20% / 1 estrela cada, ausente nunca é zero, sobrescrita manual livre); IndexedDB com versão de schema e migrações aditivas com snapshot automático pré-migração e pré-mesclagem; auditoria de segurança (`docs/SEGURANCA.md`), Error Boundary global com exportação de backup de emergência e rascunhos SQL locais de RLS (`supabase/migrations/20261124_rls_catalog_works.sql` e `supabase/verify_rls.sql`); busca progressiva (`250 ms` debounce, `AbortController`, local primeiro, streaming por fonte e histórico recente), imagens `lazy`/`async` com proporção fixa (`2:3` e `1:1`), paginação incremental acima de 200 itens com `IntersectionObserver`, code-splitting e banner discreto de atualização PWA; direção de arte (`docs/DESIGN.md`) com capa protagonista, 2 raios, alvos `>= 44 px` e UI limpa; catalogação search-first com folha rápida enxuta e detector de duplicatas; escopos de franquia (**Linha Principal** vs **Universo Completo**) para Cinema, Livros e Games; hierarquia musical SOUND (**Banda -> Discografia -> Álbuns / EPs / Singles -> Faixas**) com escopos e nota por faixa; **Página de Entidade** clicável para Autor, Diretor, Elenco, Estúdio e Banda; Acervo com folha única **"Filtrar"** e **Desfazer** em todas as operações em lote; Home com faixa **"Em andamento"** cross-domain + **Curador (`OracleWidget`)** adaptado ao domínio ativo; e **Configurações > Diagnóstico** (versão, tamanho do catálogo, uso de storage, status das fontes e log local copiável dos últimos 50 erros sem envio externo).

## [v2.3.3] — 2026-11

**Resumo:** Site publicado funcional para uso diário no Cloudflare Pages sem digitar chaves de API e sem risco aos dados do usuário: liberação estrita na CSP (`public/_headers`) dos hosts ausentes dos 4 domínios (`itunes.apple.com`, `musicbrainz.org`, `openlibrary.org`, `www.googleapis.com`, `www.cheapshark.com`, `www.freetogame.com`, `coverartarchive.org`) com teste automatizado, proxy autenticado via Cloudflare Pages Functions (`functions/api/` para `/api/tmdb/*`, `/api/omdb` e `/api/status`) validando Bearer token do Supabase e usando cache de borda (`caches.default`: 10 min busca / 24h detalhes), roteamento `_routes.json` para proteger `/api/*` do catch-all `_redirects`, fallback transparente para chave local quando o proxy está indisponível ou sem sessão, painel **Status das APIs** em Configurações (com indicador, latência, botão Testar e status de configuração no servidor sem exibir chaves) e testes de segurança dos dados (proteção contra nuvem vazia/erro de rede e round-trip de backup/restauração nos 4 domínios incluindo `progress_data` e `track_ratings`).

## [v1.3.0 · Lumière] — 2026-11

**Resumo:** Cinema Moderno & Motor de Cores OKLCH (Dark, White, Sepia + Harmonização Matemática da Cor de Fundo sem presets antigos), PWA Nativo Instalável para PC e Android com Cache LRU de Pôsteres limitado a 80 MB, Sistema de Backup Criptografado (.ccodex) com GZIP nativo e AES-GCM 256-bit com sincronização no Google Drive, Página da Obra com Paleta Adaptativa atmosférica (--work-accent, --work-glow), Episódios Reais Paginados em blocos de 100 da Jikan com títulos, datas e selos de Filler (*One Piece*), Radar de Franquias de Filmes vs. Universos de Séries/Animes com cálculo exato de progresso (X/Y obras), Provedores de Streaming no Brasil (Streaming BR), Badges Visuais Superiores no Catálogo, Dashboard de Métricas Zero-Scroll em 2 dobras máximas, Tela Início com resumo de catálogo vivo e título do próximo episódio no Hero, e Perfil Editorial estilo Letterboxd/Serializd com avatar quadrado arredondado (rounded-2xl), vitrine Top 4 limpa, grade de Atividade Recente e Histograma de Notas (0–100).

## [v1.2.0 · Lumière] — 2026-11

**Resumo:** Design Editorial Cinematográfico e Arquitetura Relacional Local: IndexedDB estruturado em 5 stores (`works`, `season_progress`, `episode_reviews`, `sessions_log`, `api_cache`) com snapshot prévio obrigatório, isolamento completo de rascunhos sem vazamento de sinopse, busca automática de temporadas via TMDB/TVmaze/AniList destravando `T1 → T2 → T3+`, Página Completa da Obra (`WorkDetailPage.jsx`) sem formulários abertos no modo leitura, pôsteres `2:3` reais nas sugestões curadas, Home sem duplicação entre Hero e trilho *Continuar Assistindo*, Métricas em Bento Grid focadas em Horas Assistidas/Episódios/Décadas e Perfil Editorial com Vitrine Top 4 Favoritos, Avatar Customizável e remoção física definitiva do código social morto.

## [v1.1.0 · Lumière] — 2026-11

**Resumo:** Atualização de uso pessoal e privado (`SOCIAL_ENABLED = false`), infraestrutura de fila/cache de APIs (incluindo OMDb com IMDb, Rotten Tomatoes e Metacritic), ponte canônica de IDs, migração atômica sem nota 80 automática, avaliação individual por episódio (`0–100`), radar automático de franquias (TMDB/AniList/Jikan), Home redesenhada em 4 estados e Perfil com banner da obra ativa, métricas reais e limpeza de textos residuais de livro.

## [v1.0.0 · Lumière] — 2026-11

**Resumo:** Lançamento da cinemateca pessoal Cine Códice (filmes, séries e animes) com agregador multi-fonte gratuito, controle tátil de minutagem/episódios, DNA do Espectador em 8 dimensões, Bilhete de Cinema PNG, Cine Wrapped PNG e Blindagem Tripla anti-perda.

## [v5.0.0 · Alexandria] — 2026-11

**Resumo:** Códice 5.0.0 Alexandria: Leitura Conjunta com Escudo Anti-Spoiler no DOM, Códice Wrapped exportável em PNG, Blindagem Tripla sem imagens Base64 e File Handlers PWA (.epub/.pdf/.cbz).

## [v4.17.0 · Ymir] — 2026-11

**Resumo:** Acessibilidade WCAG/teclado (UX_AUDIT.md), 3 escalas de fonte, espaçamento dislexia, badges com formas para daltonismo, PWA registerType prompt com toast e banner de modo privado

## [v4.16.0 · Ymir] — 2026-11

**Resumo:** Power user: atalhos globais (?), importador Goodreads/StoryGraph/Calibre/Lista com detector de duplicadas, scanner ISBN, tags, Para reler, empréstimos, Markdown e Undo universal

## [v4.15.0 · Ymir] — 2026-11

**Resumo:** Motion FLIP, Skeletons com forma, Passaporte do Leitor SVG, 2 dias de descanso/mês, Modo Calmo e som tátil de página opt-in

## [v4.14.0 · Ymir] — 2026-11

**Resumo:** Ecossistema sem servidor: dicionário offline-cached, Cápsula do Tempo (Neste Dia) e 3 templates editoriais PNG

## [v4.13.0 · Ymir] — 2026-11

**Resumo:** Engajamento sem ruído: check-in +1 Cap, heatmap SVG acessível com padrões daltônicos, roleta ponderada pelo DNA e timer silencioso no leitor

## [v4.12.0 · Ymir] — 2026-11

**Resumo:** Seleção em lote com Desfazer (Toast), coleções reordenáveis com capa mosaico SVG e Command Palette global (Ctrl+K)

## [v4.11.0 · Ymir] — 2026-11

**Resumo:** Fase 10: Upgrade do Leitor Manga/CBZ com RTL, Spread duplo, Webtoon virtualizado, filtros E-Ink Sumi/Noturno e Zoom 2x no toque

## [v4.10.0 · Ymir] — 2026-11

**Resumo:** Fase 9: Motor de Franquias em Andamento com deteccao de volumes faltantes, carrossel na Home e + Catalogar em 1 toque

## [v4.9.0 · Ymir] — 2026-11

**Resumo:** Fase 8: Progresso aditivo de volumes/capitulos e ownedVolumes para mangá, light novel e comic com grade clicavel acessivel

## [v4.8.0 · Ymir] — 2026-11

**Resumo:** Fase 7: Conectores AniList GraphQL e Internet Archive, backoff/8s timeout, cache 7 dias IndexedDB, dedup melhorada e Ler Gratis Agora

## [v4.7.0 · Ymir] — 2026-11

**Resumo:** Fase 6: Identidade @handle#XXXX (0001-9999), leitura estatica VITE_SUPABASE_*, busca por codigo/tag e schema RLS completo

## [v4.6.0 · Ymir] — 2026-11

**Resumo:** Fase 5: Code splitting lazy por aba/modal, Web Worker (>500 obras), pipeline de capas WebP LRU, windowing e debounce de persistencia

## [v4.5.0 · Ymir] — 2026-11

**Resumo:** Fase 4: Configuracoes em 4 abas com hash, DNA do Leitor em 8 dimensoes, exclusoes e migracao retrocompativel

## [v4.4.0 · Ymir] — 2026-11

**Resumo:** Fase 3: Acervo Estante Direta, Filtros em ResponsiveSheet, Estante de Lombadas, Cor Dominante e Capas SVG Geradas

## [v4.3.0 · Ymir] — 2026-11

**Resumo:** Fase 2: 6 temas distintos com miniaturas vivas, ResponsiveSheet, View Transitions e atalho global de Temas

## [v4.2.0 · Ymir] — 2026-11

**Resumo:** Design System v2 com tokens em 3 camadas, ThemeEngine sem flash, fontes variáveis autohospedadas e motor gráfico nativo.

## [v4.1.1 · Ymir] — 2026-11

**Resumo:** Deploy contínuo Cloudflare Pages, novos temas, check-in rápido, roleta offline, coleções e cartões de perfil sem servidor.

## [v4.1.0 · Ymir] — 2026-11

**Resumo:** Motor híbrido local/nuvem, leitor imersivo, busca seletiva e rede literária.

- Sistema oficial de versionamento nominal e semântico (`src/config/versioning.js`, `scripts/bump-version.mjs` e painel de histórico da versão).
- Aceleração da busca na catalogação (`Google Books` por padrão no modo geral, `Jikan` em mangás e `CrossRef + OpenAlex` em acadêmicos), cache persistente em `localStorage` (`codice_search_cache_v2`), renderização progressiva imediata, timeout de `4500ms` e debounce de `220ms` com sugestões rápidas.
- Blindagem do cliente Google Gemini (`geminiApi.js`) com sanitização de chave, fallback sequencial entre até 3 modelos estáveis, extração resiliente de JSON, mensagens de erro acionáveis, botão **Testar Conexão** e preenchimento inteligente local quando offline.
- Upload direto de leitura (**+ Adicionar Arquivo para Ler**) no hub **Continuar Lendo**, seção **Indicações para Sua Próxima Leitura** na Home e botão **Indicar Livro** na ficha da obra.
- Identidade dinâmica do leitor (137 títulos e Título Vivo por CDD/gênero) e rede literária híbrida com mural, feed, seguimento e chat 1:1 com anexo de livros.

## [v4.0.0] — 2026-10

- Schema relacional `4.0-codice-sql`, títulos bilíngues PT-BR/Original, progresso por percentual/Kindle Loc, estante digital offline e backup assinado com SHA-256.

## [v3.0.0] — 2026-09

- Leitor integrado em IndexedDB (`PDF`, `EPUB`, `CBZ`, `TXT` e `Markdown`), sugestão CDD/Cutter, exportação BibTeX/CSV e temas com contraste WCAG 2.2 AA.
