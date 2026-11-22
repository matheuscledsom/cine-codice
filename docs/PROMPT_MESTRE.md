# CINE CÓDICE v1.1.0 · LUMIÈRE — PROMPT MESTRE (rev. 2, pós-auditoria)

## PAPEL E MODO DE TRABALHO

Você é o engenheiro responsável por `~/cine-codice` (`git@github.com:matheuscledsom/cine-codice.git`). Versão alvo: `1.1.0 · Lumière`. Branch de trabalho: `feat/v1.1.0-lumiere` (nunca editar direto na `main`). O dono não programa: explique tudo em português simples; termo técnico só com uma frase de explicação.

### Protocolo de execução (OBRIGATÓRIO)
- Execute UMA fase por vez, na ordem: `1A → 1B → 2 → 3 → 4 → 5 → 6 → 7`. A Fase 0 (auditoria) já foi concluída; seus fatos estão abaixo.
- Ao fim de cada fase: gates da fase passando, commit, atualização de `docs/PROGRESSO.md`, RELATÓRIO DE FASE (formato no fim) e PARE. Só continue quando o dono escrever `continuar`. Se ele escrever `continuar tudo`, siga sem parar, exceto se um gate falhar.
- Antes de iniciar cada fase, releia este arquivo (REGRAS e DECISÕES valem em TODAS as fases) e `docs/PROGRESSO.md`. Reconfira no código real os fatos abaixo antes de editar cada arquivo.
- Sessão nova ou contexto perdido: leia `docs/PROMPT_MESTRE.md` e `docs/PROGRESSO.md`, diga em qual fase está e retome dela.
- Não invente endpoints nem campos de API. Confira a documentação oficial ou uma resposta real. Campo ausente = `null`, nunca valor inventado.
- Não mexa fora do escopo. Problemas fora dele vão para o relatório, sem correção.
- Se um gate falhar 2 vezes pelo mesmo motivo, pare e reporte o que tentou.
- Nunca diga "pronto" sem ter executado. O que não conseguiu verificar deve aparecer como `NÃO VERIFICADO`.
- Reutilize o que já existe. Antes de criar qualquer módulo, procure um equivalente no projeto e estenda-o.

## FATOS DO PROJETO (resultado da auditoria da Fase 0)
- Git: `main` limpa, 1 commit (`v1.0.0`). Node 20 / npm 10. Scripts: `dev`, `build`, `preview`, `test` (runner nativo do Node, `tests/cine-codice.test.mjs`, 10/10), `validate:contrast`, `validate:design` (`scripts/validate-design.mjs`), `version:patch|minor|major`. Playwright está instalado.
- Stack: React 19, Vite, Tailwind v4, PWA, lucide-react, DOMPurify. Publicado no Cloudflare Pages (CSP em `public/_headers`).
- Armazenamento: `localStorage` guarda catálogo (`cine_codice_backlog_v1`), perfil (`cine_codice_profile_v1`), sessões, espelho relacional, espelho LZW de emergência e chaves (TMDB em `cine_codice_tmdb_key_v1`, Gemini). `IndexedDB` guarda só snapshots de backup, cache de busca (7 dias) e cache de miniaturas.
- Obra: tipo em `workType` (`movie | series | anime`); status `playing` (= "Assistindo"), `queued`, `completed`, `paused`, `rewatching`, `dropped`; IDs soltos (`tmdbId`, `imdbId`, `tvmazeId`, `anilistId`, `malId`, `tmdbMediaType`); `coverUrl`, `coverSources`; `backdropUrl` é lido em `CoverArt.jsx` mas nunca gravado; nota do usuário `rating` inteira 0–100; séries com `watchedEpisodes` (mapa `"S:E"`), `fillerEpisodes`, `storyArcs`.
- Perfil: `readerFocus` (string), `annualGoal`, `preferredFormat` (= "onde assiste"), `preferredCriteria`, `preferredAtmosphere`, `favoriteGenres` (`string[]`), `onboardingCompleted`. O drawer `ProfileSettingsDrawer.jsx` também edita o foco.
- APIs já integradas (`src/services/cinemaApi.js`): AniList, Jikan (só busca), TVmaze (busca, temporadas, episódios), TMDB, IMDb Suggestion, Wikidata, Internet Archive; com cache, timeout de 8 s e isolamento por fonte. OMDb não existe. Faltam: fila/limites por provedor, tratamento de 429/`Retry-After`, retry, deduplicação, aliases AniList.
- Já existem e devem ser REUTILIZADOS: `franchiseEngine.js`, `recommendationEngine.js`, `dnaScoring.js` (DNA em 8 dimensões), Roleta por tempo disponível, Cápsula do Tempo, carrossel de Sagas, Check-in Rápido, importação CSV do Letterboxd, `backupEngine.js`, `ReadingStreakWidget`.
- Problemas confirmados:
  - Concluir uma obra grava `rating: 80` automaticamente (`useBacklog.js:225-228,358`; `AddScreen.jsx:91-96`).
  - `migrateDatabase` existe mas não roda na carga do catálogo (`useBacklog.js:246-265`).
  - `public/_headers:5` não libera a OMDb.
  - O teste de emojis usa faixas fixas, não `\p{Extended_Pictographic}`.
  - Módulos sociais herdados (Mural, Rede & Amigos, Comunidade, Chat, Login, "Leitura Conjunta") com textos de livro; `geminiApi.js` ainda tem instruções de livro (o `aiProvider.js` já está adaptado).
  - Versão aparece em: `package.json`, `src/config/versioning.js`, `src/config/domainConfig.js`, `WrappedModal.jsx`, `codiceBackend.js` (~linha 3240), `README.md`. O `CHANGELOG.md` ainda tem histórico antigo.

## DECISÕES ADOTADAS (padrão; o dono pode alterar dizendo)
- Social: NÃO apagar código nesta versão. Criar `SOCIAL_ENABLED = false` em `src/config/` e ocultar por ela todas as entradas de Mural, Rede & Amigos, Comunidade & Leitores, Chat, Login, "Leitura Conjunta" e contadores sociais. A remoção de código morto fica para a v1.2.0.
- Nota padrão 80: deixa de ser criada. Obras antigas com `rating === 80`, sem `reviewCriteria` e sem resenha recebem `ratingSource: 'legacy-default'`: ficam fora de médias e comparativos, aparecem esmaecidas com o rótulo `"nota padrão"`, e um toque do dono a confirma (`'manual'`).
- Nomes internos herdados (`readerFocus`, `readingSessions`, `useReadingStreak.js` etc.) permanecem, para não quebrar dados e backups. O que o usuário VÊ não pode ter linguagem de livro.

## REGRAS INEGOCIÁVEIS (cada uma precisa de teste ou comando de verificação)
- **R1** Zero emojis em `src/`: teste com `\p{Extended_Pictographic}` e lista de exceções explícita (`© ® ™`). Ícones só `lucide-react` com `strokeWidth={1.5}`; nada de `★ ✓ ✕` como texto. Alinhe o teste existente e o `validate-design.mjs` ao mesmo critério.
- **R2** `tabular-nums` em notas, %, tempos e contadores.
- **R3** Contraste WCAG AA (4.5:1 texto normal; 3:1 texto grande e ícones). Texto sobre imagem sempre sobre scrim com no mínimo 70% de opacidade na área do texto; considere o pior caso (imagem branca). Respeite o `validate-design` (sem gradiente roxo→rosa, sem sombras coloridas grandes).
- **R4** Alvos de toque >= 44x44 px, incluindo avatares das pílulas e botões só de ícone.
- **R5** Nenhuma chave de API no repositório, no histórico, em testes ou em logs (ver D3).
- **R6** Uso pessoal e privado: sem feed de terceiros, sem contas, sem contadores sociais, sem telemetria visível (ver decisão sobre `SOCIAL_ENABLED`).
- **R7** Resíduos de livro: nenhum texto visível ao usuário com linguagem de livro. Lista confirmada na auditoria (corrigir todos): `"Registrar Leitura Hoje"` (`ReadingStreakWidget.jsx:110`, trocar por `"Registrar Sessão Hoje"`); `"Página ou Capítulo"` (`JournalComposerModal.jsx:275`, adaptar a temporada/episódio/minuto); `"Editorial / Livro (Lora)"` e `"Clássico Literário (Merriweather)"` (`themeTokens.js:162,169`, renomear sem "Livro"/"Literário"); rótulos de acessibilidade `"do Leitor"` (`TitlesBadgesModal.jsx:37`, `ProfileScreen.jsx:788`, trocar por `"do Espectador"`); instruções de IA em `geminiApi.js` (Autor, Página, Volume, Capítulo, crítico literário), alinhando-as ao `aiProvider.js`. Telas sociais herdadas ficam ocultas pela flag. Falsos positivos legítimos já justificados: `"erro de leitura"` de arquivo, `"proposta autoral"`, `"Capítulo da Saga"`, `"leitura fácil"` do QR Code.
- **R8** Dados existentes do usuário nunca se perdem: migrações idempotentes, com teste, e backups exportados na v1.0.0 continuam importáveis. Campos antigos deixam de ser lidos pela UI, mas não são apagados.
- **R9** Sem layout quebrado: nenhuma rolagem horizontal da página em 360 px; toda imagem com `aspect-ratio` reservado; fallback quando a imagem falha; `prefers-reduced-motion` respeitado; foco visível por teclado.
- **R10** Tudo que o usuário criar nesta versão (avaliações de episódio, tags, reações, vínculos de franquia, `ratingSource`, `viewerFocus`, gêneros) entra no backup e na importação (`backupEngine.js`, importador), com teste de ida e volta.

## DECISÕES DE ARQUITETURA (valem para todas as fases)

- **D1 Fonte por tipo** (campo `workType`; o usuário pode corrigir o tipo na ficha):
  - Filme: TMDB (base) + OMDb (IMDb, RT, Metacritic).
  - Série: TMDB (base) + TVmaze (episódios, próximo episódio) + OMDb (notas).
  - Anime: AniList (base, relações, próximo episódio) + Jikan (episódios, nota MAL, flag de filler). Fallback de episódios: TMDB.
  - Detecção de anime: veio da AniList/Jikan, ou TMDB com gênero Animação + país de origem JP confirmado por busca na AniList (título + ano).
  - Falha de uma fonte degrada a ficha (mostra o que houver). Nunca bloqueia a tela.

- **D2 Ponte de IDs:** novo bloco `ids: { tmdb, imdb, tvmaze, anilist, mal }` como fonte principal. Os campos soltos atuais continuam sendo gravados como espelho durante a v1.1.0 e continuam sendo lidos de backups antigos. Resolva via `external_ids` do TMDB, busca por IMDb no TVmaze (`/lookup/shows?imdb=`) e `idMal` da AniList. Falta de ID = `null`; nunca adivinhe por título sozinho.

- **D3 Chaves:** ficam no `localStorage`, como já é hoje. Adicione `cine_codice_omdb_key_v1` no mesmo padrão e reutilize a tela de chaves existente (crie só se não houver). Sem chave, o app funciona com as fontes que não precisam dela e mostra aviso claro. O fallback `import.meta.env.VITE_*` só vale em desenvolvimento (`import.meta.env.DEV`); NUNCA definir chaves `VITE_*` no Cloudflare Pages (iriam para o código público). A anon key do Supabase é pública por desenho; não alterar.

- **D4 Limites e cache:**
  - Estenda o `cinemaApi.js` existente (cache, timeout, isolamento por fonte); NÃO reescreva. A fila e os limites entram como camada em `src/api/` que ele passa a usar. Constantes em `src/api/limits.js`.
  - Valores conservadores: AniList 30/min (ler cabeçalhos `X-RateLimit-*`), Jikan 3/s e 60/min, OMDb 1000/dia (contador local; a 90% pare as chamadas automáticas), TVmaze ~20 por 10 s.
  - Fila por provedor, deduplicação de chamadas em andamento, retry com backoff e respeito a `Retry-After` em 429. Agrupe consultas da AniList em um único request GraphQL com aliases. Nunca dispare chamadas dentro do render.
  - Dados pesados novos NÃO vão para o `localStorage` (limite pequeno): use `IndexedDB` com versão de schema e TTL: notas externas 7 dias, episódios 12 h (obra em exibição) ou 30 dias (finalizada), relações 7 dias. Cota cheia: descarte os mais antigos. Offline: sirva o cache e mostre `"dados de DD/MM"`.
  - Exceção: avaliações do usuário por episódio ficam em um armazenamento DURÁVEL no `IndexedDB` (`episodeEvaluations`, sem TTL), chaveado por `workId:S:E` (mesma convenção `"S:E"` do `watchedEpisodes`) e coberto pelo backup (R10).

- **D5 Notas:**
  ```js
  externalRatings: {
    imdb:           { value, scale: 10,  votes, fetchedAt } | null,
    rottenTomatoes: { value, scale: 100, fetchedAt } | null,
    metacritic:     { value, scale: 100, fetchedAt } | null,
    tmdb:           { value, scale: 10,  votes, fetchedAt } | null,
    anilist:        { value, scale: 100, fetchedAt } | null,
    mal:            { value, scale: 10,  fetchedAt } | null
  }
  ```
  - Nota do usuário: `rating` inteiro 0–100 (escala do app). `null` = sem nota. Normalize notas externas para 0–100 só para comparar (`src/lib/ratings.js`, funções puras).
  - `"Sua Nota vs. Público"` usa a escala 0–100 do app, com o selo original ao lado. Nota de episódio: interna 0–100, entrada rápida em passos de 5 (exibida como 0–10).
  - RT vem só do OMDb e pode faltar. Sem scraping e sem fallback inventado. Selo ausente não aparece (nada de `"N/A"`).

- **D6 Estados de tela:** toda tela com dados assíncronos implementa 5 estados: carregando (skeleton), vazio, erro (com "Tentar de novo"), offline e parcial.

- **D7 Testabilidade:** os testes usam o runner nativo do Node, que não importa JSX. Toda lógica nova (`ratings`, `episodeStats`, franquia, migrações, fila, cache) fica em módulos `.js` puros, sem React, CSS ou acesso direto ao DOM, e é testada com fixtures, sem rede.

## FASES DE EXECUÇÃO

### FASE 1A — Infraestrutura de API (`src/api/`, `src/lib/ratings.js`)
- Se `git status` estiver sujo, pare e pergunte. Se limpo, crie a branch `feat/v1.1.0-lumiere`; crie `docs/PROGRESSO.md` (fase atual, decisões, resumo da auditoria; sem chaves) e salve o prompt mestre em `docs/PROMPT_MESTRE.md` se ainda não estiver lá.
- Implemente D4: fila, limites, 429/`Retry-After`, retry, deduplicação, caches IndexedDB (notas, episódios, relações) e a integração com o `cinemaApi.js` existente.
- Adicione a OMDb ao `cinemaApi.js` e libere no CSP (`public/_headers`) os domínios de TODOS os provedores usados (`connect-src`: TMDB, OMDb, AniList, Jikan, TVmaze, Wikidata) e os hosts de imagem necessários (`img-src`, incluindo backdrops TMDB `w1280` e banners AniList). Verifique o arquivo inteiro.
- Crie `src/lib/ratings.js` (D5) e a ponte de IDs (D2).
- Aceite: testes sem rede para 429, timeout, cache expirado, chave ausente, campo ausente, deduplicação e normalização de notas.

### FASE 1B — Dados e migração
- Ligue a migração na carga do catálogo (`useBacklog.js`), rodando ANTES de `normalizeItem`, com snapshot automático (`backupEngine`) antes da primeira migração e execução idempotente.
- Migre: bloco `ids` (com espelho dos campos soltos), `ratingSource`, `legacy-default` (ver decisões), novo `viewerFocus: string[]` (a partir de `readerFocus`; ver Fase 2).
- Remova a criação automática de `rating: 80` (`useBacklog.js:225-228,358`; `AddScreen.jsx:91-96`) e trate `legacy-default` nas médias.
- Chaves: acrescente o campo da OMDb na tela de chaves existente; crie a tela "Sobre/Créditos" com as atribuições obrigatórias (TMDB com o aviso exigido por eles, OMDb, AniList, Jikan/MAL, TVmaze, JustWatch se usar provedores).
- Trocar o teste de emojis pelo critério R1 e alinhar o `validate-design.mjs`.
- Aceite: teste de migração com dados da v1.0.0 (incluindo um backup exportado), idempotência (rodar 2 vezes = mesmo resultado), nota 80 não criada, backup ida e volta (R10).

### FASE 2 — Onboarding e Configurações (`OnboardingFlow.jsx`, `ProfileSettingsDrawer.jsx`)
- Muda só o que é pedido: o assistente tem 5 etapas e as etapas 1, 4 (chave Gemini) e 5 permanecem.
- Etapa 2: `"Qual é o seu foco?"` em seleção múltipla (mín. 1; Avançar desabilitado com explicação acessível se vazio). Manter `"Critérios que mais valoriza"` (múltipla) e `"Atmosfera visual"` com preview ao vivo. Remover `"Meta anual de obras"` e `"Onde você mais assiste"` do onboarding, do drawer de Configurações e do bloco de Meta Anual da Home (`HomeScreen.jsx:106-123,522-557`). Os valores já salvos (`annualGoal`, `preferredFormat`) são mantidos sem leitura.
- Foco: novo `viewerFocus: string[]`; `readerFocus` continua existindo, derivado do primeiro item, apenas para consumidores legados. Atualize `recommendationEngine.js`, `OracleWidget.jsx`, `aiProvider.js`, `geminiApi.js` e o drawer para ler `viewerFocus`.
- Etapa 3: 3 grupos fixos: Cinema (Filmes), Séries, Animes. Grupos dos focos escolhidos aparecem primeiro. Gêneros de anime em dois tipos: `genre` (ex.: Slice of Life) e `tag` (ex.: Shonen, Seinen, Isekai, Mecha), exclusivos de Animes. Cada gênero: `{ group, id, label, tmdbGenreId?, anilistKey? }`.
- Migração de `favoriteGenres` (`string[]` → objetos) por tabela de correspondência; sem correspondência, `group: 'outros'` preservando o texto. Atualize os consumidores. Quem já fez o onboarding não o refaz. Voltar de etapa preserva as escolhas; tudo operável por teclado.

### FASE 3 — Notas externas (`cinemaApi.js`, `AddScreen.jsx`, ficha)
- Card de resultado da busca mostra só o que já vem na busca (nota TMDB/AniList). Notas completas carregam ao abrir a ficha ou ao salvar a obra, com no máx. 2 requisições simultâneas.
- Ao enriquecer uma obra, grave também `backdropUrl` (TMDB `w1280` ou banner da AniList) e `externalRatings`.
- Ficha: um selo por fonte (`IMDb 8.9`, `RT 94%`, `Metacritic 71`, `TMDB 7.8`, `AniList 88%`, `MAL 8.72`), com skeleton individual, rótulo da fonte e data da coleta.
- `"Sua Nota vs. Público"`: só com nota do usuário (excluindo `legacy-default`) E pelo menos 1 fonte. A diferença usa sinal e texto (`+12 / -8`), nunca só cor.
- Aceite: teste para cada combinação de fonte presente/ausente e para a OMDb sem chave.

### FASE 4 — Episódios, Obra e Franquia
Reutilize e estenda o que existe (`franchiseEngine.js`, `watchedEpisodes`, `fillerEpisodes`, `storyArcs`). Lógica pura primeiro (`src/lib/episodeStats.js`, extensões do `franchiseEngine.js`); UI depois.
- Episódios (`EpisodeListTab.jsx` dentro de `ItemDetailSheet.jsx`):
  - Carregue por temporada sob demanda, com cache (D4); lista virtualizada acima de 100 itens.
  - `"Assistido"` usa o `watchedEpisodes` existente. Avaliação, tag (`Obra-prima`, `Filler`, `Virada de Chave`, `Final Épico`) e reação de até 280 caracteres vão para `episodeEvaluations` (D4). Ações extras: `"marcar até aqui"` e `"temporada inteira"`. Tudo com desfazer.
  - Filler da Jikan aparece como sugestão visualmente distinta e não sobrescreve `fillerEpisodes` do usuário.
  - Arcos: use `storyArcs` quando existirem (dados do usuário); `episode groups` do TMDB entram só como sugestão. Sem nenhuma fonte, nenhuma aba de arcos.
  - `episodeStats`: média só dos avaliados com `"N de M avaliados"`; Top 3 (desempate pela ordem de exibição; lista menor se houver menos de 3); pior episódio só com 2 ou mais avaliados; botão `"Aplicar média na nota da série"` ativo com 3 ou mais avaliados e com confirmação se já existir nota manual; guardar `ratingSource: 'manual' | 'episodes'`.
  - Gráfico de barras em SVG: escala fixa, episódio sem nota = barra tracejada, rolagem horizontal só dentro do gráfico, valor em texto além da cor, alternativa acessível em tabela.
  - Notas públicas por episódio (OMDb por temporada, score da Jikan) ao lado das suas, só quando disponíveis.
- Franquia (estender `franchiseEngine.js`):
  - Vínculos: filmes via `belongs_to_collection` (TMDB); anime via relações AniList/Jikan; séries live-action e universos por vínculo manual na ficha.
  - Grafo com conjunto de visitados (sem ciclos), profundidade máx. 3, máx. 60 nós, deduplicado por ID.
  - Média da franquia usa só obras avaliadas (sem `legacy-default`); ranking `#k de N` só quando a obra atual tem nota; franquia com 1 obra não mostra comparativo. Progresso do universo = assistidas / total conhecido, separado por filmes, OVAs, especiais e spin-offs.
- Extras: badge `"Ep. N em DD/MM"` (fuso do aparelho; oculto se finalizada ou sem data); Diretor/Estúdio clicáveis filtram o acervo primeiro, e `"buscar mais títulos"` vem depois, com limite.

### FASE 5 — Home (`HomeScreen.jsx`)
Renderiza do acervo local; nenhuma chamada de rede bloqueia a tela.
- Tabela de/para obrigatória ANTES de editar: para cada bloco atual da Home (3 cards de resumo, Meta Anual, Check-in Rápido, sequência de dias, Em Cartaz, Sagas, Roleta, Curador IA, Recomendações, Cápsula do Tempo, Cartazes em Destaque), diga se será mantido, movido, fundido ou removido por pedido. Nada some sem estar nessa tabela. Padrão: Meta Anual removida (pedido); Check-in Rápido vira pílulas; sequência de dias fica como chip compacto; Curador IA e Recomendações fundem no trilho de sugestões; Roleta vira o botão `"O que assistir hoje?"`.
- Hero, 4 estados: (a) obra mais recente com status `playing` ou `rewatching`; (b) acervo existe mas nada em andamento: destaque da fila Quero Ver (`queued`) com botão `"Começar"`; (c) acervo vazio: boas-vindas com um único botão `"Catalogar Primeira Obra"`, sem caixa tracejada; (d) carregando: skeleton.
- Imagem: `backdropUrl` > capa com desfoque > gradiente do tema. Se a obra não tiver `backdropUrl`, busque uma vez em segundo plano (TMDB/AniList), grave e use o fallback até chegar. Título, progresso (`Temp. X · Ep. Y` ou minutagem), botão primário (`+1 Ep` / `Continuar Sessão`) e secundário `Ficha`.
- `+1 Ep` passando do total pede confirmação de conclusão. `+20 min` nunca passa da duração. Toast `"Desfazer"` por 6 s e trava contra toque duplo.
- Pílulas de sessão: avatares circulares >= 44 px (preferir 56) com anel de progresso, por atividade recente, máx. 12 e depois `"ver todas"`. Ação em 1 toque, sem campo de texto aberto.
- Trilhos (pôster 2:3 fixo, `object-fit: cover`, skeleton, placeholder tipográfico sem pôster, scroll-snap, setas no desktop, teclado): Continuar Assistindo (barra de progresso e nota só se existir); Franquias & Sagas (% e média; some sem franquia de 2 ou mais obras); Sugestões do DNA / Quero Ver (reutilizar `recommendationEngine`, TMDB discover e AniList pelos gêneros do onboarding, cache 24 h, exclui o que já está no acervo ou foi dispensado) com o botão `"O que assistir hoje?"` (reutilizar a Roleta); Cápsula do Tempo & Destaques (reutilizar a existente; citação ou cena favorita via novo campo opcional na ficha, até 200 caracteres).
- Trilho sem conteúdo não é renderizado (nem o título). Trilhos abaixo do Hero carregam sob demanda (`IntersectionObserver`).

### FASE 6 — Perfil, social oculto e resíduos (`ProfileScreen.jsx`)
- Banner: `backdropUrl` da obra em andamento com filtro escuro AA; sem obra, gradiente do tema.
- Remover `"0 Seguidores · 0 Seguindo"` (`ProfileScreen.jsx:464-490`). Métricas reais com fórmula escrita no código e em teste: Obras (total e concluídas), Episódios/Horas (soma de durações conhecidas; duração desconhecida é excluída e indicada), Média Geral (média de notas do usuário, excluindo `legacy-default`; `"—"` se nenhuma).
- Criar `SOCIAL_ENABLED = false` e ocultar por ela as abas e entradas sociais (Diário público, Mural, Estante Pública quando forem sociais, Rede & Amigos, Comunidade, Chat, Login, `"Conjunta"` na Ficha, botão `@handle#XXXX`). Nenhum dado é apagado.
- Aplicar a lista de correções de R7 e rodar a busca de resíduos novamente; relatar o que sobrou, justificado.

### FASE 7 — Testes, versão e publicação
- Testes em `tests/` (`node:test`, sem rede): onboarding multi-foco sem meta/onde-assiste, migrações (`viewerFocus`, `favoriteGenres`, `ids`, `legacy-default`) incluindo backup da v1.0.0, média de episódios (0, 1, 2, 3+ avaliados, empates), aplicar média com e sem nota manual, Filme × Franquia (1 obra, 2+, atual sem nota), Episódio × Obra × Universo (com ciclo e profundidade), notas externas (cada fonte ausente), limites e cache da Fase 1A, nota 80 não criada, backup ida e volta (R10), zero emojis (R1) e resíduos de livro (R7).
- Versão `1.1.0` em TODOS os lugares listados nos fatos. Antes de usar `npm run version:minor`, leia o que o script faz; se ele criar commit ou tag, não use e edite manualmente. No `CHANGELOG.md`, acrescente uma entrada resumida da `v1.0.0` e a da `v1.1.0` (mantendo o histórico antigo abaixo).
- Gates (todos com 0 erros): `npm test && npm run validate:contrast && npm run build && npm run validate:design`.
- Verificação visual com o Playwright já instalado (se os navegadores dele não estiverem instalados, liste como `NÃO VERIFICADO`): screenshots em 360, 768 e 1280 px de Home vazia, Home com obra em andamento, Onboarding etapas 2 e 3, ficha com notas parciais, aba Episódios e ficha de filme com franquia. Confirme também que o app publicável (`npm run build` + `preview`) busca a OMDb sem violar o CSP.
- Git: commit por fase (`feat(...)`, `test(...)`). Antes de cada `git add`, rode `git status` e confirme que não há `.env`, `node_modules` ou `dist`. Ao final, com gates verdes, PARE e peça ao dono a palavra `publicar`. Só então: merge em `main`, `git tag v1.1.0`, `git push origin main --tags`.

## RELATÓRIO DE FASE (use ao fim de cada fase, em português simples)
1. O que mudou (2–4 linhas).
2. Como conferir em 2 minutos (passos numerados para o dono).
3. NÃO VERIFICADO e riscos conhecidos.
4. Saída resumida dos testes/gates desta fase.
- Termine com: `"Fase X concluída. Digite continuar para a próxima."`

## RELATÓRIO FINAL (após a Fase 7)
Inclua também: chaves necessárias e onde colar, lista dos resíduos de livro removidos ou justificados, o que ficou oculto pela flag `SOCIAL_ENABLED`, e pendências para a v1.2.0 (limpeza do código social, importação do CSV do IMDb, etc.).
