# Plano de Engenharia — OMNIPRISM v2.4.0 ("REFINO & PROFUNDIDADE")

**Branch oficial:** `feat/v2.4.0-refino` (criada a partir da `main` em `a201f06`)
**Versão base:** `2.3.3` -> **Versão alvo:** `2.4.0`
**Protocolo:** Execução sequencial por fases (0 -> 1 -> 2 -> 3 -> 4 -> 5), com validação integral (`npm test`, `npm run validate:contrast`, `npm run build`, `npm run validate:design`), commit atômico próprio (Conventional Commits sem acentos) e registro em [`docs/PROGRESSO.md`](./PROGRESSO.md) ao final de cada fase.

---

## 1. Princípios Inegociáveis & Limites de Escopo

### Preservar integralmente
- Motor visual **OKLCH** com os **3 modos de superfície** (`dark`, `white`, `sepia`) e harmonização de cor de ambiente (`bgTintColor`).
- Abas de domínio (`Cinema`, `Livros`, `Games`, `Música` / `Todos`) e barra inferior atual (`BottomNav`).
- Persistência **IndexedDB local-first** e sincronização não-destrutiva com **Supabase** (`catalog_works`, bucket `covers`).
- IDs internos de status (`queued`, `playing`, `rewatching`, `paused`, `completed`, `dropped`), chaves de `localStorage` e formato de backup (`.json` e `.ccodex` GZIP + AES-GCM).
- Regras R1 a R8 (`docs/PROMPT_MESTRE_V1_3.md`): zero emojis em `src/`, `tabular-nums`, contraste WCAG 2.2 AA, alvos >= 44px, zero secrets hardcoded, zero rede social, zero vazamento de vocabulário fora de domínio, migração idempotente com preservação total dos dados.

### Fora de escopo / Não aprovado
- Não mesclar na `main`, não fazer deploy e dar push apenas de `feat/v2.4.0-refino` ao final.
- Não aplicar SQL remoto nem alterar RLS no Supabase (gerar apenas rascunhos locais revisáveis).
- Não escrever valores de secrets, não remover funcionalidades existentes e não instalar novas dependências sem justificativa explícita.
- Não implementar perfil estilo Instagram (grade de publicações/fixados) nem adicionar APIs pagas.

---

## 2. Roteiro por Fases

### FASE 0 — Baseline e Documentação
- Verificar branch, status e `git log` recente.
- Criar `feat/v2.4.0-refino` a partir da `main` atualizada.
- Medir e registrar linha de base em `docs/PROGRESSO.md`: tamanho dos chunks de bundle (`vite build`), maiores arquivos de `src/` e tempo/total da suíte `npm test`.
- Criar `docs/PLANO_v2.4.0.md` e `docs/DESIGN.md` (diretrizes visuais para a Fase 3).

### FASE 1 — Fundação, Segurança e Modelo de Notas (5 Estrelas + 5 Critérios)
1. **IndexedDB versionado com migrações aditivas (`src/services/relationalDb.js`, `src/services/backupEngine.js`):**
   - Bump seguro de versão do schema com fila de migrações aditivas idempotentes (`SCHEMA_VERSION` / store `schema_meta`).
   - Snapshot automático no `IndexedDB`/`localStorage` **antes de migrar** e **antes de restaurar backup no modo Mesclar (`merge`)**.
   - Suíte de testes com fixtures antigas (v1.0/v1.1/v2.1/v2.3) garantindo preservação integral e rollback/snapshot.
2. **Modelo único de nota (`src/lib/ratingModel.js` + componente reutilizável `src/components/StarRatingPicker.jsx`):**
   - Armazenamento interno normalizado de `0` a `100` (mantendo compatibilidade com `rating` e `gameRating11`).
   - Exibição principal em **5 estrelas com meia estrela (`0.5` a `5.0`)** + marca opcional **"Obra da vida"** (`progress_data.lifeWork`, equivalente ao antigo `11` de Games sem perder retrocompatibilidade).
   - Avaliação inteligente opcional por **5 critérios específicos por domínio** (Cinema, Leitura, Games, Música), onde cada critério de `0` a `10` equivale a 1 estrela (20% do total). A média dos critérios preenchidos sugere automaticamente a nota em estrelas (arredondada em passos de `0.5`), permitindo sobrescrita manual a qualquer momento. Critério ausente (`null`/`undefined`/`''`) **nunca** é tratado como `0`.
   - Testes completos de borda (0, 0.5, 5.0, arredondamento 0.5, critério ausente vs 0 explícito, override manual, `lifeWork` <-> `gameRating11: 11`, compatibilidade `legacy-default`).
3. **Auditoria de Segurança (`docs/SEGURANCA.md`) e Error Boundary Global (`src/components/ErrorBoundary.jsx`, `src/App.jsx`):**
   - Varredura de XSS / `innerHTML` / `dangerouslySetInnerHTML`, auditoria de links `target="_blank"` com `rel="noopener noreferrer"`, busca por padrões de secrets, revisão de headers em `public/_headers`.
   - Error Boundary global envolvendo a raiz do app com botão direto de **Exportar Backup** (JSON de emergência direto do armazenamento local, mesmo em estado de falha).
4. **Rascunhos locais Supabase (NÃO APLICAR):**
   - `supabase/migrations/20261124_rls_catalog_works.sql` (RLS estrito `auth.uid() = user_id` para `public.catalog_works` e bucket `storage.objects` `covers`).
   - `supabase/verify_rls.sql` (consultas exclusivamente `SELECT` somente leitura para auditar políticas ativas).
   - Ambos marcados no topo como `-- RASCUNHO: revisar antes de aplicar`.

### FASE 2 — Velocidade, Cache e Busca Progressiva
1. **Busca progressiva (`src/services/multiDomainSearchService.js`, `src/services/cinemaApi.js`, `src/screens/AddScreen.jsx`):**
   - Debounce de `250 ms` e `AbortController` cancelando requisições anteriores a cada nova digitação.
   - Busca local no acervo exibida imediatamente antes da rede.
   - Streaming progressivo por fonte (`onPartialResults`): exibe resultados conforme cada API responde, sem bloquear aguardando fontes lentas (MusicBrainz, Wikidata, Open Library).
   - Histórico local de buscas recentes por domínio (persistido em `localStorage`, limpável em 1 toque).
2. **Imagens e Listas (`src/components/CoverImage.jsx`, `src/components/CoverArt.jsx`, `src/screens/ListScreen.jsx`):**
   - `loading="lazy"`, `decoding="async"` e `aspect-ratio` fixo (`2/3` para Cinema/Livros/Games, `1/1` para Música) eliminando CLS.
   - Paginação incremental no Catálogo (`ListScreen.jsx`) acima de `200` itens via `IntersectionObserver` + memoização dos cards e listas derivadas.
3. **Code-splitting e atualização do PWA (`src/App.jsx`, `src/main.jsx`, `src/components/PwaUpdateBanner.jsx`):**
   - Eliminar importação estática duplicada de modais pesados (`OfflineBookPickerModal`, `FranchiseRadarPanel`, `EpisodeListTab`, painéis pesados de Perfil/Diagnóstico).
   - Aviso discreto de atualização do PWA (`"Nova versão disponível"`) acionado pelo evento `needRefresh` do Service Worker (`registerType: 'prompt'`).

### FASE 3 — Direção de Arte (`docs/DESIGN.md`) e UI Limpa
- Aplicar sistematicamente `docs/DESIGN.md` em tokens (`src/design/tokens.css`, `src/index.css`) e telas principais (`HomeScreen`, `ListScreen`, `AddScreen`, `WorkDetailPage`, `ProfileScreen`, `WorkCard`, `DomainSwitcherBar`, `BottomNav`):
  - Capa como protagonista, hierarquia por tipografia e respiro (sem card dentro de card).
  - Cor do domínio restrita à aba ativa, ação principal e barra de progresso.
  - Exatamente 2 valores de raio principais (`6px` e `14px`).
  - Alvos de toque >= `44px`, serifa apenas em títulos de obra/tela, números tabulares.
  - Remover excesso de chips com borda tingida, frases genéricas e caixas vazias pesadas (estado vazio = busca ou ação direta + 1 frase curta no vocabulário do domínio).

### FASE 4 — Catalogar e Acervo (Franquias, Hierarquia Musical e Entidades)
1. **Catalogar (`src/screens/AddScreen.jsx`):**
   - Search-first com foco automático, grade de capas e link discreto para cadastro manual.
   - Folha rápida enxuta sem opções pré-selecionadas: Fila ("Quero...") sem perguntas; Games em andamento pergunta "Onde você está jogando?" (plataformas da API + "outra plataforma"); Leitura ("Lendo") pergunta página atual; Concluído/Lido/Zerado/Ouvido exibe seletor de **5 estrelas (meia estrela)** + botão discreto **"Avaliar por 5 critérios"**. Formato, dublagem, edição e tipo de conclusão recolhidos na ficha.
   - Aviso claro de duplicata por `external_ids` ou `título + ano`.
2. **Franquias & Escopos (`src/lib/franchiseTier.js`, `src/services/franchiseService.js`, `src/components/FranchiseRadarPanel.jsx`, `src/components/WorkDetailPage.jsx`):**
   - Classificação `progress_data.franchiseTier`: `mainline` (Cronologia / História Principal), `spinoff` (Spin-off / Universo Expandido) e `companion` (Guias, Entrevistas, Especiais/OVAs).
   - Dois indicadores transparentes na visão de franquia/série: **Linha Principal** (ex.: `3/5 livros`) e **Universo Completo** (ex.: `4/9`), mantendo extras/entrevistas separados da cronologia principal.
3. **Hierarquia Musical — SOUND (`src/lib/musicHierarchy.js`, `src/components/MusicDiscographyView.jsx`, `src/screens/ListScreen.jsx`):**
   - Visão agrupada **Banda / Artista -> Discografia -> Álbuns / EPs / Singles -> Faixas**.
   - Filtro de escopo: `Estúdio`, `EPs / Singles`, `Ao Vivo / Coletâneas`, `Todos`, com progresso transparente e nota individual por faixa.
4. **Página de Entidade (`src/components/EntitySheetModal.jsx`, `src/components/WorkDetailPage.jsx`):**
   - Nomes clicáveis de Autor, Diretor, Ator/Elenco, Estúdio e Banda na ficha da obra abrindo folha/visão dedicada com obras já catalogadas no acervo local + busca filtrada nas APIs externas.
5. **Acervo (`src/screens/ListScreen.jsx`, `src/components/WorkCard.jsx`):**
   - Parede de capas limpa (indicador fino de status, barra de progresso na base quando em andamento, estrelas no foco/lista, sem pílulas poluindo a capa).
   - Filtros unificados em folha única (`"Filtrar"`) e seleção em lote com **Desfazer**.

### FASE 5 — Home, Perfil, Diagnóstico e Fechamento
1. **Home (`src/screens/HomeScreen.jsx`, `src/components/OracleWidget.jsx`):**
   - Faixa **"Em andamento"** cross-domain com ações rápidas (`+1 ep`, `+10 págs`, `+1 cap`, `+30 min`, `+1h`, `+1 escuta`) e **Desfazer**.
   - Curador (`OracleWidget`) adaptado ao domínio ativo (vocabulário, critérios e contexto do domínio).
2. **Perfil & Diagnóstico (`src/screens/ProfileScreen.jsx`, `src/components/DiagnosticsPanel.jsx`, `src/lib/errorLogger.js`):**
   - Identidade editável, resumo dos 4 mundos, Top 4 manual por domínio, central de backup/restauração, "Novidades da versão" (alimentado por `CHANGELOG.md` / `versioning.js`).
   - Página **Configurações > Diagnóstico**: versão, tamanho do catálogo por domínio, uso de storage (`navigator.storage.estimate` + `localStorage`), status das fontes de API e log local dos últimos `50` erros copiável (100% local, zero telemetria).
3. **Versão & Entrega:**
   - Atualizar `package.json`, `src/config/versioning.js`, `CHANGELOG.md` e `docs/PROGRESSO.md` para `2.4.0`.
   - Executar todos os 4 portões, criar testes de regressão da v2.4.0, commit final e `git push origin feat/v2.4.0-refino`.
