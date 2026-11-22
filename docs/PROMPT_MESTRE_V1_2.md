# CINE CÓDICE v1.2.0 · LUMIÈRE — SUPER PROMPT DE ENGENHARIA, DESIGN SYSTEM & ARQUITETURA DE DADOS

Salve este documento integralmente em `docs/PROMPT_MESTRE_V1_2.md` no repositório antes de iniciar a Fase 1.

---

## 1. IDENTIDADE DO PROJETO, REPOSITÓRIO & GOVERNANÇA GIT

- **Repositório oficial:** `git@github.com:matheuscledsom/cine-codice.git` (pasta local: `~/cine-codice`).
- **Versão atual esperada na `main`:** `1.1.0 · Lumière` (tag `v1.1.0`).
- **Versão alvo deste ciclo:** `1.2.0 · Lumière` (tag `v1.2.0`).
- **Branch de desenvolvimento obrigatória:** `feat/v1.2.0-lumiere`.

### Protocolo Git Estrito (Executar em TODAS as fases)
1. **Pre-Flight Check antes da Fase 1:**
   - Verifique `git status`, `git branch -a` e `git log -n 5 --oneline`.
   - Caso a branch `feat/v1.1.0-lumiere` ainda não tenha sido integrada à `main` e taggeada como `v1.1.0`, execute primeiro o merge `--no-ff` da `feat/v1.1.0-lumiere` na `main`, crie a tag anotada `git tag -a v1.1.0 -m "Release v1.1.0 Lumiere"` e faça `git push origin main --tags` antes de abrir a nova branch.
   - A partir da `main` limpa e atualizada, crie e entre em: `git checkout -b feat/v1.2.0-lumiere`.
   - **Proibição absoluta:** Nunca comitar diretamente na `main` durante o desenvolvimento das Fases 1 a 6.
2. **Higiene de Commits Atômicos (Conventional Commits):**
   - Ao final de **cada fase** (Fases 1 a 6), após todos os gates da fase passarem com zero erros:
     - Rode `git status` e `git diff --stat` para garantir que nenhum arquivo temporário, log de debug, `.env` ou screenshot solto fora da pasta prevista entre no commit.
     - Faça um commit limpo e descritivo seguindo o padrão:
       - Fase 1: `feat(data): corrige vazamento de sinopse, temporadas automaticas e IndexedDB estruturado`
       - Fase 2: `feat(ui): transforma ficha da obra em pagina editorial cinematografica sem formularios abertos`
       - Fase 3: `feat(home): adiciona posteres reais nas sugestoes e elimina duplicacao de cards na inicio`
       - Fase 4: `feat(metrics): redesenha painel de metricas com foco em horas e episodios acumulados`
       - Fase 5: `feat(profile): cria vitrine Top 4 favoritos, avatar customizavel e remove codigo social legado`
       - Fase 6: `chore(release): prepara versao 1.2.0 Lumiere, suite de regressao e auditoria visual`
     - Atualize `docs/PROGRESSO.md` com o resumo da fase concluída e inclua no commit da fase.
3. **Encerramento e Publicação (Somente após aprovação explícita do dono):**
   - Ao concluir a Fase 6, **PARE** na branch `feat/v1.2.0-lumiere` e aguarde o dono responder **`publicar`**.
   - Somente após receber **`publicar`**, execute:
     ```bash
     git checkout main
     git merge --no-ff feat/v1.2.0-lumiere -m "Merge branch 'feat/v1.2.0-lumiere' into main (v1.2.0 Lumiere)"
     git tag -a v1.2.0 -m "Cine Codice v1.2.0 Lumiere - Design Editorial, Pagina de Obra e IndexedDB"
     git push origin main --tags
     ```

### Modo de Operação & Comunicação
- O dono não programa: traduza toda decisão técnica em linguagem clara e objetiva, explicando qualquer termo técnico em uma frase simples.
- Execute **UMA fase por vez** (`0 → 1 → 2 → 3 → 4 → 5 → 6`). Ao fim de cada fase, entregue o **RELATÓRIO DE FASE** padronizado e **PARE** até o dono digitar `continuar`.
- Nunca invente endpoints, parâmetros de API ou notas externas. Campo ausente = `null`, renderizado de forma limpa sem placeholders falsos (`"N/A"`, `"0%"` falso ou `"Sinopse indisponível"` inventada).

---

## 2. DIREÇÃO DE ARTE & DESIGN SYSTEM ("EDITORIAL CINEMATOGRÁFICO")

O objetivo estético da v1.2.0 é eliminar qualquer aparência de "formulário gerado por IA" ou "planilha com caixas de texto" e elevar o **Cine Códice** ao nível visual de plataformas editoriais de cinema (como Letterboxd, MUBI Notebook e Criterion Channel), mantendo compatibilidade total com os 22 presets de tema e modos Claro/Escuro/Sépia do aplicativo.

### 2.1 Hierarquia Visual, Tipografia & Superfícies
- **Separação rigorosa entre Modo Leitura e Modo Edição:**
  - Nenhuma tela de visualização (`HomeScreen`, `CatalogScreen`, `WorkDetailPage`, `StatsScreen`, `ProfileScreen`) pode exibir `<input>`, `<textarea>` ou `<select>` abertos por padrão (exceto a barra de busca global).
  - Metadados editáveis devem ser exibidos como **tipografia editorial limpa** e só viram campos de formulário dentro de um drawer/modo explícito acionado pelo botão **"Editar Metadados"**.
- **Escala Tipográfica e Alinhamento Numérico:**
  - Títulos de obra e cabeçalhos de página: hierarquia forte com tracking refinado (`-0.02em`), line-height compacto (`1.15`) e contraste mínimo AAA/AA.
  - Metadados secundários (ano, duração, estúdio, formato): `0.8125rem` (`13px`), separados por pontos médios (`·`), nunca empilhados em caixas cinzas repetitivas.
  - **Regra R2 obrigatória:** Todo número dinâmico (notas, porcentagens, horas acumuladas, contadores de episódios, `T1 · E12`, anos) deve usar `font-variant-numeric: tabular-nums`.
- **Profundidade de Superfícies & Scrims Cinematográficos:**
  - Utilize exclusivamente os tokens CSS existentes do tema ativo (`--bg-primary`, `--bg-secondary`, `--bg-elevated`, `--border-subtle`, `--accent-primary`, `--text-primary`, `--text-secondary`), sem cores hardcoded que quebrem temas claros ou pastéis.
  - Todo texto posicionado sobre imagens de capa (`backdropUrl` ou `coverUrl`) deve repousar sobre um gradiente de proteção (`linear-gradient` + scrim mínimo de `72%` de opacidade na zona de leitura) garantindo contraste **WCAG 2.2 AA (>= 4.5:1)**.
- **Proporções de Imagem & Estados de Carregamento:**
  - **Pôster vertical:** rigorosamente `aspect-ratio: 2 / 3` (`rounded-xl`, `object-fit: cover`, borda sutil `1px solid var(--border-subtle)`).
  - **Banner widescreen (Backdrop):** `aspect-ratio: 16 / 9` em mobile e altura controlada (`320px–380px`) em desktop com `object-position: center 20%` para não cortar rostos.
  - **Skeleton Loading:** Enquanto imagens externas carregam, exiba um placeholder shimmer suave nas cores do tema (`animate-pulse` discreto) antes de acionar qualquer fallback tipográfico.

### 2.2 Regras Técnicas Inegociáveis (Gates Automatizados)
- **R1:** Zero emojis em `src/` (`\p{Extended_Pictographic}`, exceto `© ® ™`). Ícones exclusivamente `lucide-react` com `strokeWidth={1.5}`.
- **R2:** `tabular-nums` em todos os contadores, notas e métricas.
- **R3:** Contraste WCAG 2.2 AA aprovado em `npm run validate:contrast`.
- **R4:** Todos os botões, abas, chips e controles de episódio com área mínima de toque `44×44 px`.
- **R5:** Zero chaves de API hardcoded ou vazadas em código/logs/testes.
- **R6:** Zero código ou interface de rede social (remoção física definitiva na Fase 5).
- **R7:** Zero vocabulário residual de livros na interface (nada de "páginas", "capítulos" para filmes, "leitura", "estante" onde deve ser "acervo/cinemateca").
- **R8:** Preservação integral dos dados do usuário via migração idempotente e snapshot automático antes de alterar o esquema de armazenamento.
- **R9:** Zero rolagem horizontal (`scrollWidth === innerWidth`) em `360 px`, `768 px` e `1280 px`.

---

## 3. ARQUITETURA DE DADOS LOCAL (INDEXEDDB RELACIONAL ESTRUTURADO)

Como o Cine Códice é uma aplicação offline-first executada no navegador sem servidor externo pago, a camada de persistência local (`src/services/codiceDatabase.js` e `src/services/cacheDb.js`) será reestruturada como um **banco relacional local em IndexedDB** (equivalente client-side ao SQL), eliminando o gargalo de 5 MB do `localStorage`:

1. **Stores (Tabelas Locais) com Índices:**
   - `works` (`keyPath: 'id'`, índices: `by_status`, `by_format`, `by_franchise`, `by_updatedAt`, `by_favoriteRank`): armazena o registro mestre de cada filme, série ou anime, incluindo `ids` externos (`tmdbId`, `imdbId`, `anilistId`, `malId`, `tvmazeId`), `coverUrl`, `backdropUrl`, `overview`, `genres`, `moods`, `tags`, `totalSeasons`, `totalEpisodes`, `episodesPerSeason`, `currentSeason`, `currentEpisode`, `rating` (0–100 ou `null`), `favoriteRank` (`1..4` ou `null`) e `favoriteScene`.
   - `season_progress` (`keyPath: ['workId', 'seasonNumber']`, índice: `by_workId`): armazena detalhadamente cada temporada de uma série/anime (`seasonNumber`, `title`, `episodeCount`, `watchedEpisodes[]`, `fillerEpisodes[]`, `arcs[]`, `completed`).
   - `episode_reviews` (`keyPath: ['workId', 'seasonNumber', 'episodeNumber']`, índice: `by_workId`): armazena notas individuais (0–100) e anotações curtas por episódio.
   - `sessions_log` (`keyPath: 'id'`, índices: `by_workId`, `by_date`): histórico acumulado de sessões assistidas (data, minutos assistidos, episódios avançados) para alimentar Métricas e o Mapa de Atividade sem depender de métricas de leitura.
   - `api_cache` (`keyPath: 'cacheKey'`, índice: `by_expiresAt`): cache de pôsteres, backdrops, temporadas e notas externas com TTL de 24 h a 7 dias.
2. **Migração Segura e Camada de Compatibilidade (R8):**
   - Na inicialização, se houver dados no formato antigo (`v1.0.0` / `v1.1.0` no `localStorage` ou store única), crie automaticamente um snapshot de segurança (`cine_codice_backup_pre_v1_2`), migre todos os registros para as novas stores relacionais do IndexedDB de forma idempotente e mantenha um espelho compacto de emergência + exportação/importação JSON 100% compatível com backups anteriores.

---

## 4. PLANO DETALHADO POR FASES

### FASE 0 — Auditoria Técnica, Git Pre-Flight & Mapeamento de Causa Raiz (SOMENTE LEITURA)
Não modifique arquivos de código ainda. Execute:
1. **Inspeção Git:** rode `git status`, `git branch -a` e `git log -n 5 --oneline` para confirmar o estado exato da `main` e da `v1.1.0`.
2. **Mapeamento exato (`arquivo:linha`) dos 6 defeitos encontrados na auditoria visual:**
   - **Defeito A (Vazamento de sinopse no cadastro):** rastreie em `AddScreen.jsx` e `useBacklog.js` por que o rascunho mantém `overview`/`synopsis` de uma busca anterior ao abrir outra obra (ex.: *Supernatural* herdando a sinopse de *Cowboy Bebop*).
   - **Defeito B (Temporadas travadas na T1 + controles duplicados):** rastreie em `cinemaApi.js`, `TactileStatusFields.jsx` e `EpisodeListTab.jsx` por que `totalSeasons` não é preenchido automaticamente nas séries/animes e por que o botão `+1 Temp` fica bloqueado em `1`.
   - **Defeito C (Sugestões sem pôster real):** localize as listas estáticas locais em `AddScreen.jsx` e `RecommendationsSection.jsx` onde `coverUrl` vem vazio/nulo, gerando capas tipográficas genéricas.
   - **Defeito D (Triplicação na Home & `0%` falso no Hero):** localize em `HomeScreen.jsx` e `homeEngine.js` por que uma única obra em andamento aparece simultaneamente no Hero, no Toque Rápido e em *Continuar Assistindo* (e por que o card do trilho ignorou `coverUrl`).
   - **Defeito E (Ficha estreita estilo formulário):** mapeie o layout e os inputs abertos de `ItemDetailSheet.jsx`.
   - **Defeito F (Código morto social):** liste todos os arquivos e imports ligados à antiga flag `SOCIAL_ENABLED` para remoção limpa na Fase 5.

Entregue o diagnóstico completo e o plano de execução. Termine com: `"Fase 0 concluída. Digite continuar para a próxima."` e **PARE**.

---

### FASE 1 — Git Setup, IndexedDB Relacional, Correção de Sinopse, Temporadas & Auto-Tagging
1. **Git:** conclua a publicação da `v1.1.0` na `main` caso ainda esteja pendente na branch anterior e crie `feat/v1.2.0-lumiere` a partir da `main`.
2. **Banco Relacional IndexedDB (`codiceDatabase.js`, `useBacklog.js`):**
   - Implemente as 5 stores estruturadas (`works`, `season_progress`, `episode_reviews`, `sessions_log`, `api_cache`) com migração automática e snapshot prévio dos dados da `v1.1.0`.
3. **Isolamento Total do Rascunho de Cadastro (`AddScreen.jsx`):**
   - Ao clicar em `+ Catalogar` em qualquer resultado de busca ou sugestão, construa o objeto inicial **exclusivamente** a partir do item clicado (com reset explícito de todos os campos de estado do modal antes de abrir), garantindo zero contaminação de sinopse, ano, estúdio ou IDs de buscas anteriores.
4. **Busca Automática de Temporadas, Episódios e Preenchimento Inteligente (`cinemaApi.js`, `genreCatalog.js`):**
   - Quando o usuário selecionar uma **Série** ou **Anime** para catalogar (ou abrir uma obra já cadastrada com `totalSeasons <= 1`), dispare em paralelo a consulta de temporadas reais:
     - Séries: TMDB `/tv/{id}` (`number_of_seasons` e array `seasons` com `episode_count` de cada temporada) ou TVmaze `/shows/{id}/seasons` (sem necessidade de chave!).
     - Animes: AniList (`episodes`, `season`, `relations` de sequências) ou Jikan `/anime/{id}` (`episodes`).
   - Salve automaticamente `totalSeasons`, `totalEpisodes` e `episodesPerSeason` no registro da obra e na store `season_progress`.
   - **Destravamento do seletor de temporadas:** permita navegar e avançar livremente entre temporadas (`T1`, `T2`, `T3`... até `totalSeasons`, além de um botão `+ Nova Temporada` para adicionar temporadas extras manualmente quando necessário).
   - **Auto-mapeamento de Gêneros, Atmosfera e Temas:** ao abrir o modal de cadastro, converta automaticamente os gêneros e keywords da API para os chips de **Atmosfera/Clima** e **Temas & Tropos** (ex.: *Supernatural* já abre com *Terror*, *Fantasia*, clima *Sombrio* e tags mapeadas selecionados), exibindo apenas os chips relevantes + botão discreto `+ Adicionar tag` em vez de uma grade gigante vazia.
5. **Gate & Commit:** rode `npm test` (incluindo novos testes unitários para migração IndexedDB, isolamento de sinopse, temporadas da TVmaze/TMDB/AniList e auto-tagging), verifique `git status` e faça o commit atômico da Fase 1.

---

### FASE 2 — Página Completa da Obra (Experiência Editorial Imersiva Sem Cara de Formulário)
Substitua o modal estreito cheio de inputs (`ItemDetailSheet.jsx`) por um componente de **Página Completa da Obra (`WorkDetailPage.jsx`)** renderizado em tela cheia (com navegação por histórico/botão Voltar e atalho `Esc`):
1. **Hero Cinematográfico da Obra:**
   - Banner widescreen (`backdropUrl` carregado via TMDB/AniList/TVmaze com cache na `api_cache`; se indisponível, composição artística com desfoque controlado do próprio `coverUrl`) coberto por gradiente escuro de alto contraste (scrim >= 72% na base).
   - Sobre a base do banner: pôster `2:3` nítido (`120×180 px` mobile / `160×240 px` desktop) com sombra profunda, título principal em destaque, título original discreto (quando diferente), linha de metadados (`Ano · Estúdio/Diretor · Duração/Temporadas · Formato`) e pílulas de status (`Assistindo`, `Concluído`, etc.).
   - Barra de ações principais com alvos >= 44 px:
     - Botão primário contextual: **`+1 Ep (T1 · E13)`** para séries/animes em andamento ou **`Marcar como Concluído`** para filmes.
     - Botão **`Fixar nos Top 4`** (estrela/marcador que fixa a obra na vitrine do Perfil).
     - Botão **`Editar Metadados`** (ícone de lápis) que abre o painel de edição sob demanda.
2. **Corpo Editorial Organizado em 3 Abas Limpas (Zero Inputs Abertos):**
   - **Aba 1 — Visão Geral:**
     - **Sinopse Editorial:** texto limpo em tipografia confortável (`max-width: 68ch`), sem caixa de texto editável, com expansão suave *"Ler sinopse completa"* se ultrapassar 4 linhas.
     - **Notas do Público & Sua Avaliação:** grade limpa com os selos reais disponíveis (IMDb, Rotten Tomatoes, Metacritic, TMDB, AniList, MAL) lado a lado com o seletor tátil da **Sua Nota (0–100)** e o comparativo visual de afinidade.
     - **Atmosfera, Gêneros & Franquia:** chips somente-leitura elegantes + card clicável da **Franquia / Universo** (mostrando outras obras da mesma saga no seu acervo e sua média na franquia).
   - **Aba 2 — Temporadas & Episódios (Unificada e Leve):**
     - Elimina a duplicidade antiga de controles de episódio.
     - Carrossel horizontal de pílulas de temporada (`T1`, `T2`, `T3`, ..., `T15` + botão `+ Temp`), mostrando progresso por temporada (`12/22 eps`).
     - Ações rápidas da temporada selecionada: **`+1 Ep`**, **`+3 Eps`** e **`Concluir Temporada`**.
     - Lista virtualizada/paginada de episódios da temporada selecionada (carregando títulos reais dos episódios via TVmaze/TMDB/Jikan quando disponíveis, sem travar a renderização mesmo em animes longos como *One Piece* com 1.100+ episódios agrupados em arcos/blocos de 50 eps), permitindo marcar assistido, filler e dar nota individual (0–100) com gráfico de evolução da temporada.
   - **Aba 3 — Cenas & Diário da Obra:**
     - Campo dedicado para registrar **Cena Marcante / Citação** e impressões pessoais da obra, com botão para gerar o **Bilhete Cinematográfico (PNG)** pronto para salvar.
3. **Drawer "Editar Metadados" (Sob Demanda):**
   - Somente ao clicar em **Editar Metadados**, abre um painel lateral/modal organizado onde o usuário pode corrigir manualmente título, diretor, estúdio, franquia, ano, total de temporadas, sinopse, URL da capa e URL do banner.
4. **Gate & Commit:** rode `npm test`, `npm run validate:contrast`, `npm run build` e faça o commit atômico da Fase 2.

---

### FASE 3 — Pôsteres Reais nas Sugestões & Tela Inicial (Home) Sem Duplicação
1. **Fim das Capas Genéricas Sem Imagem (`AddScreen.jsx`, `RecommendationsSection.jsx`, `cinemaApi.js`):**
   - Crie um resolvedor de metadados reais (`resolveCuratedSuggestions`) que enriquece as sugestões iniciais da Cinemateca (*Cidade de Deus*, *Duna*, *Dark*, *Cowboy Bebop*, *A Viagem de Chihiro*, *Neon Genesis Evangelion*, etc.) buscando automaticamente seus pôsteres `2:3` oficiais nas APIs públicas (AniList para animes sem chave; TVmaze / IMDb Suggestion API / TMDB para filmes e séries) e salvando na store `api_cache` do IndexedDB.
   - Adicione skeleton de carregamento nas capas e reserve o `posterGenerator.js` estritamente para obras cadastradas manualmente sem internet ou sem registro nas APIs.
2. **Tela Inicial (`HomeScreen.jsx`, `homeEngine.js`) Refinada e Sem Repetição:**
   - **Regra anti-duplicação:**
     - Se houver apenas **1 obra** em `Assistindo` / `Reassistindo`, ela ocupa o **Hero Cinematográfico** no topo e o trilho *Continuar Assistindo* é **ocultado** automaticamente (evitando repetir a mesma obra 3 vezes na mesma tela).
     - Se houver **2 ou mais obras** em andamento, o Hero exibe a mais recente e o trilho *Continuar Assistindo* exibe **apenas as demais** (`items.slice(1)`), sempre usando a `coverUrl` real do registro (corrigindo o bug que mostrava pôster tipográfico verde no card do trilho).
   - **Progresso honesto no Hero:**
     - Se `totalEpisodes > 0`, exibe barra de progresso e porcentagem (`tabular-nums`, ex.: `54% · T1 E12/22`).
     - Se `totalEpisodes` ainda for desconhecido (`null`/`0`), exibe **`T1 · Ep. 12 assistidos`** em vez de um enganoso `0%`.
3. **Gate & Commit:** rode `npm test`, `npm run build` e faça o commit atômico da Fase 3.

---

### FASE 4 — Métricas Acumuladas de Espectador (Prazer em Assistir, Sem Cobrança)
Redesenhe `StatsScreen.jsx` e `statsEngine.js` em um **Bento Grid Editorial** focado no acúmulo histórico do espectador:
1. **Remoção de Métricas de Cobrança:**
   - Remova os cartões *"Taxa de Conclusão (0%)"* e *"Média p/ concluir"* que penalizam quem acompanha séries longas ou animes em andamento.
2. **Novos Blocos Acumulados:**
   - **Hero de Tempo Acumulado:** destaque principal para **Horas Totais em Tela** (com conversão sutil em dias equivalentes, ex.: `142.5 h · ~5.9 dias de cinema`), **Episódios Assistidos** no total e **Obras Concluídas** (contagem absoluta, nunca porcentagem punitiva).
   - **Distribuição por Formato (Horas & Títulos):** comparativo visual equilibrado entre **Filmes**, **Séries** e **Animes**.
   - **Linha do Tempo por Década:** gráfico de barras horizontais mostrando em quais décadas (`Anos 80`, `90`, `2000`, `2010`, `2020`) seu acervo mais se concentra.
   - **Top Diretores, Estúdios & Gêneros:** ranking limpo baseado nas horas/obras acumuladas, com toggle suave entre `Direção / Estúdio` e `Gêneros`.
   - **Mapa de Sessões & Cine Wrapped:** mantenha o calendário de atividade anual com linguagem acolhedora (*"Dias com sessão registrada"*) e o gerador de **Cine Wrapped (PNG)**.
3. **Gate & Commit:** rode `npm test`, `npm run validate:contrast`, `npm run build` e faça o commit atômico da Fase 4.

---

### FASE 5 — Perfil Personalizado de Cinéfilo & Remoção Definitiva do Código Social
1. **Novo Perfil Editorial (`ProfileScreen.jsx`):**
   - **Cabeçalho Cinematográfico:** mantém a capa widescreen da última obra assistida (`backdropUrl` + scrim AA) e substitui o círculo cinza `"CI"` por um **Avatar Personalizável** (upload de imagem local redimensionada para `256×256 px` em WebP/JPEG no IndexedDB ou seleção entre 8 emblemas cinematográficos minimalistas `lucide-react`).
   - **Vitrine "Favoritos da Vida" (Top 4):** grade de 4 slots `2:3` logo abaixo da bio onde ficam expostos os pôsteres das 4 obras marcadas como favoritas (clicáveis para abrir a Página da Obra; slots vazios mostram um convite discreto `+ Escolher favorito` que abre um seletor rápido do próprio acervo).
   - **Resumo Acumulado & Últimas Cenas/Avaliações:** substitui o antigo bloco vazio *"Nenhuma publicação no diário / + Novo Bilhete"* por um feed pessoal dinâmico das suas últimas notas atribuídas e cenas marcadas nas obras, além das abas **Meu Acervo** e **Insígnias do Espectador**.
2. **Limpeza Física do Código Morto Social (Regra R6):**
   - Exclua definitivamente os arquivos de rede social que estavam apenas ocultos atrás de `SOCIAL_ENABLED = false`: `CommunityScreen.jsx`, `ProfileWall.jsx`, `DirectChatDrawer.jsx`, `UserProfileModal.jsx`, `FriendProfileCardModal.jsx`, `ShareProfileCardModal.jsx`, `AuthModal.jsx`, `BuddyReadPanel.jsx`, `buddyReadService.js` e métodos sociais não utilizados em `codiceBackend.js`, limpando todas as importações mortas em `App.jsx`, `BottomNav.jsx`, `ItemDetailSheet.jsx` e `ProfileSettingsDrawer.jsx`.
3. **Gate & Commit:** rode `npm test`, `npm run build`, `npm run validate:design` e faça o commit atômico da Fase 5.

---

### FASE 6 — Regressão Completa, Auditoria Visual Multi-Resolução & Preparação para Publicar
1. **Atualização de Versão (`1.2.0 · Lumière`):**
   - Atualize `package.json`, `src/config/versioning.js`, `README.md` e `CHANGELOG.md` mantendo o histórico completo das versões `1.0.0` e `1.1.0`.
2. **Suíte de Regressão `fase6-v120-regression.test.mjs`:**
   - Teste: (a) cadastro consecutivo de duas obras sem vazamento de sinopse; (b) série/anime preenchendo `totalSeasons` e destravando `T1 → T2 → T3`; (c) Home com 1 obra sem duplicar no trilho *Continuar Assistindo* e sem `0%` falso; (d) Top 4 Favoritos no Perfil e persistência do avatar local; (e) migração e round-trip completo do IndexedDB relacional + backup JSON R10; (f) ausência total de arquivos/rotas sociais removidos.
3. **Portões Obrigatórios (todos com 0 erros):**
   ```bash
   npm test && npm run validate:contrast && npm run build && npm run validate:design
   ```
