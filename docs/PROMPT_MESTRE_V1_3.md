# CINE CÓDICE v1.3.0 · LUMIÈRE — SUPER PROMPT DE ENGENHARIA, DESIGN SYSTEM OKLCH, PWA NATIVO & IMERSÃO CINEMATOGRÁFICA

Salve este documento integralmente em `docs/PROMPT_MESTRE_V1_3.md` no repositório antes de iniciar a Fase 1.

---

## 1. VISÃO DE PRODUTO, GOVERNANÇA GIT & PROTOCOLO DE EXECUÇÃO

- **Repositório oficial:** `git@github.com:matheuscledsom/cine-codice.git` (diretório local: `~/cine-codice`).
- **Versão atual na branch `feat/v1.2.0-lumiere`:** `1.2.0 · Lumière`.
- **Versão alvo deste ciclo:** `1.3.0 · Lumière` (tag `v1.3.0`).
- **Branch de desenvolvimento obrigatória:** `feat/v1.3.0-lumiere` (criada a partir da `main` após integrar a `v1.2.0`).

### Protocolo Git Estrito
1. **Pre-Flight Check & Publicação da Base `v1.2.0` antes da Fase 1:**
   - Verifique `git status` e `git branch -a`.
   - Integre a `feat/v1.2.0-lumiere` na `main` (`git checkout main && git merge --no-ff feat/v1.2.0-lumiere -m "Merge branch 'feat/v1.2.0-lumiere' into main (v1.2.0 Lumiere)"`), crie a tag anotada `git tag -a v1.2.0 -m "Release v1.2.0 Lumiere"` e envie ao remoto (`git push origin main --tags`).
   - A partir da `main` limpa e atualizada, crie e entre na nova branch: `git checkout -b feat/v1.3.0-lumiere`.
   - **Proibição absoluta:** Nunca edite ou comite diretamente na `main` durante as Fases 1 a 6.
2. **Commits Atômicos por Fase (Conventional Commits):**
   - Ao final de cada fase (`1 → 2 → 3 → 4 → 5 → 6`), após todos os gates da fase passarem com 0 erros:
     - Rode `git status` e `git diff --stat` para impedir entrada de lixo, logs ou chaves.
     - Atualize `docs/PROGRESSO.md` com o resumo técnico da fase.
     - Execute o commit atômico da fase:
       - Fase 1: `feat(design): substitui 21 presets por motor OKLCH (Dark, White, Sepia + cor de fundo harmonizada)`
       - Fase 2: `feat(pwa,storage): configura app instalavel PC/Android, compressao GZIP, AES-GCM e backup Google Drive`
       - Fase 3: `feat(work-page): adiciona paleta adaptativa por obra, episodios reais paginados (One Piece) e selos de critica`
       - Fase 4: `feat(universe,catalog): separa Franquias de Filmes vs Universos de Series/Animes, streaming BR e badges de formato`
       - Fase 5: `feat(home,metrics,profile): compacta metricas zero-scroll, refina Inicio e redesenha Perfil editorial`
       - Fase 6: `chore(release): prepara versao 1.3.0 Lumiere, regressao end-to-end e auditoria visual`
3. **Execução Contínua com Relatórios por Fase & Parada Final:**
   - Execute **todas as fases (`0 → 1 → 2 → 3 → 4 → 5 → 6`) em sequência contínua**, sem pausar entre fases para pedir `continuar`, mas **imprimindo obrigatoriamente o RELATÓRIO DE FASE completo** ao término de cada etapa.
   - **PARE somente ao concluir a Fase 6** na branch `feat/v1.3.0-lumiere` e solicite ao dono a palavra **`publicar`** antes de executar o merge final na `main` e o `git push origin main --tags`.

---

## 2. NOVO DESIGN SYSTEM ("CINEMA MODERNO & MOTOR DE CORES OKLCH")

Vamos eliminar os 21 presets retrô/bregas com bordas amarelas pesadas e substituí-los por um **Sistema Visual Tecnológico de Alta Precisão** inspirado em interfaces contemporâneas de cinema e software (Apple TV+, Linear, MUBI Notebook, Letterboxd).

### 2.1 Apenas 3 Modos Base + Seletor Inteligente de Cor de Fundo
1. **Os 3 Modos Oficiais (`themeMode`):**
   - **`dark` (Modo Escuro / OLED Grafite):** base profunda (`#0B0D12`), superfícies elevadas com vidro fosco sutil (`backdrop-filter: blur(16px)`), bordas ultrafinas (`1px solid rgba(255,255,255,0.08)`), sombras suaves e texto nítido sem brilho agressivo.
   - **`white` (Modo Claro / Editorial Branco):** base limpa (`#F7F8FA`), cards brancos puros (`#FFFFFF`) com elevação por sombra difusa (`0 1px 3px rgba(15,23,42,0.06)`), bordas sutis (`1px solid rgba(15,23,42,0.08)`) e tipografia em grafite profundo (`#0F172A`).
   - **`sepia` (Modo Sépia / Celuloide Quente):** papel quente (`#F3EDE2`), cards em marfim suave (`#FAF6EE`), tinta marrom-carvão (`#231D16`) e acento âmbar-cobre calibrado para leitura confortável sem fadiga ocular.
2. **Cor de Fundo Customizável com Harmonização Automática (`bgTintColor`):**
   - No painel **Aparência**, além de alternar entre **Dark**, **White** e **Sépia**, o usuário pode escolher uma **Cor de Ambiente / Fundo** (via 8 swatches curados: *Neutro Puro*, *Azul Meia-Noite*, *Roxo Cósmico*, *Verde Esmeralda*, *Bordô Película*, *Ciano Profundo*, *Âmbar Quente*, *Grafite Aço* OU qualquer cor livre via `<input type="color">`).
   - **Algoritmo de Harmonização (`themeEngine.js` via `color-mix()` / conversão HSL/OKLCH):**
     - O sistema **nunca** joga uma cor saturada chapada no fundo (o que deixaria a interface amadora).
     - A partir do matiz (`H`) escolhido pelo usuário, o motor gera automaticamente 5 variáveis CSS derivadas:
       - `--bg-canvas`: mistura de 90% da base do modo (`dark` / `white` / `sepia`) com apenas **10%** da cor escolhida.
       - `--bg-surface`: mistura de 86% da base com **14%** da cor escolhida (criando profundidade natural entre fundo e card).
       - `--bg-elevated`: mistura de 82% da base com **18%** da cor escolhida.
       - `--border-hairline`: borda translúcida derivada do mesmo matiz com 14% de opacidade.
       - `--accent-primary` e `--accent-contrast`: cor de destaque vibrante e legível calibrada automaticamente para garantir contraste **WCAG 2.2 AA >= 4.5:1** em qualquer cor escolhida!
3. **Paleta Adaptativa Dinâmica na Página da Obra (`WorkDetailPage`):**
   - Ao abrir a página de qualquer filme, série ou anime, o app extrai via `<canvas>` (com fallback seguro quando a imagem externa bloquear leitura de pixel) as **2 cores dominantes** do pôster (`--work-accent` e `--work-glow`).
   - O fundo da página recebe o `backdropUrl` (ou `coverUrl` em alta resolução) em camada full-bleed desfocada (`blur(32px) saturate(1.25)`) sob um véu escuro/claro do tema ativo, e os botões de ação, barras de progresso e abas ativas assumem suavemente a paleta daquela obra — retornando às cores globais ao voltar.

### 2.2 Vocabulário Oficial da Interface (Fim de "Cinemateca" e "Acervo")
- Substitua **todas** as ocorrências visíveis de *"Cinemateca"* e *"Acervo"* na interface por **"Catálogo"** (ex.: aba inferior **"Catálogo"**, *"Guardar no Catálogo"*, *"Meu Catálogo"*, *"Sugestões do Catálogo"*), preservando apenas chaves internas de `localStorage`/IndexedDB para compatibilidade com backups anteriores (Regra R8).

### 2.3 Regras Inegociáveis (Gates Automatizados)
- **R1:** Zero emojis em `src/` (`\p{Extended_Pictographic}`, exceto `© ® ™`). Ícones exclusivamente `lucide-react` com `strokeWidth={1.5}`.
- **R2:** `font-variant-numeric: tabular-nums` em todas as notas, horas, %, contadores, temporadas e episódios.
- **R3:** Contraste WCAG 2.2 AA aprovado em `npm run validate:contrast` para `dark`, `white`, `sepia` e todas as cores de ambiente.
- **R4:** Alvos de toque >= `44×44 px` em mobile e desktop.
- **R5:** Nenhuma chave de API hardcoded no código ou histórico.
- **R6:** Zero código ou interface de rede social (app 100% pessoal e privado).
- **R7:** Zero textos residuais de livro na interface.
- **R8:** Preservação total dos dados existentes via migração idempotente.
- **R9:** Zero rolagem horizontal (`scrollWidth === innerWidth`) em `360 px`, `768 px` e `1280 px`.

---

## 3. ARQUITETURA PWA INSTALÁVEL (PC & ANDROID), COMPRESSÃO, CRIPTOGRAFIA & GOOGLE DRIVE

Para funcionar como aplicativo nativo instalável no **PC (Windows/Linux)** e no **Android**, ocupando o mínimo de espaço em disco e mantendo backup seguro na nuvem pessoal do usuário sem servidor pago:
1. **PWA Instalável Completo (`manifest.webmanifest` + Service Worker + Botão "Instalar App"):**
   - Configure `manifest.webmanifest` com `display: "standalone"`, ícones maskable e atalhos rápidos (*Catalogar Obra*, *Continuar Assistindo*).
   - Adicione um banner/botão discreto **"Instalar Cine Códice no Dispositivo"** nas Configurações e na Home (quando `beforeinstallprompt` estiver disponível) para instalação em 1 toque no PC e no Android.
2. **Gestão Enxuta de Armazenamento Local (Economia de Espaço):**
   - **Nunca gravar pôsteres/backdrops em Base64 no banco:** armazene apenas URLs canônicas; imagens baixadas ficam no Cache Storage gerenciado pelo Service Worker com política **LRU (teto máximo de 80 MB)**, descartando automaticamente imagens antigas menos acessadas sem tocar nos dados do usuário.
   - **Compressão Nativa (`CompressionStream('gzip')`):** antes de gerar arquivos de exportação ou enviar backup para a nuvem, comprima o JSON usando a API nativa `CompressionStream` / `DecompressionStream` do navegador (reduzindo ~80% do tamanho do arquivo sem dependências externas).
3. **Criptografia Ponta-a-Ponta Opcional (`Web Crypto API — PBKDF2 + AES-GCM 256-bit`):**
   - No módulo `backupCryptoService.js`, permita exportar/sincronizar backups no formato `.ccodex` (GZIP comprimido) com opção de **Senha de Criptografia**:
     - Derivação de chave via `PBKDF2` (`SHA-256`, 150.000 iterações, salt aleatório de 16 bytes) + cifragem `AES-GCM` (256 bits, IV de 12 bytes).
     - O arquivo salvo no computador, no celular ou no Google Drive fica ilegível sem a senha do usuário.
4. **Integração Direta com Google Drive Pessoal (Client-Side OAuth / Picker):**
   - Em **Configurações → Backup & Nuvem**, adicione integração client-side com a **Google Drive API** (`drive.appdata` / pasta privada `Cine Codice Backups`), permitindo **Enviar Backup para o Google Drive** e **Restaurar do Google Drive** diretamente do PC ou do Android, usando `VITE_GOOGLE_CLIENT_ID` configurável pelo próprio usuário nas configurações (sem exigir backend próprio).

---

## 4. PLANO DETALHADO POR FASES

### FASE 0 — Auditoria Técnica & Mapeamento de Impacto (SOMENTE LEITURA)
1. Estado do Git (`feat/v1.2.0-lumiere` vs `main`).
2. Todos os arquivos que referenciam os 21 presets antigos (`themeTokens.js`, `ThemeModal.jsx`, `App.jsx`, `validate-contrast.mjs`) para substituição limpa pelo novo motor `OKLCH` (`dark`, `white`, `sepia` + `bgTintColor`).
3. Todas as ocorrências visíveis de `"Cinemateca"` e `"Acervo"` na interface para migração uniforme para `"Catálogo"`.
4. Como `EpisodeListTab.jsx`, `cinemaApi.js`, `FranchiseRadarPanel.jsx` e `AddScreen.jsx` tratam hoje episódios de animes longos (*One Piece*), streaming BR e franquias/universos.

---

### FASE 1 — Git Setup (`v1.2.0` na `main` + `feat/v1.3.0-lumiere`) & Novo Motor Visual OKLCH + Vocabulário "Catálogo"
1. **Git:** faça o merge `--no-ff` de `feat/v1.2.0-lumiere` na `main`, crie a tag `v1.2.0` com push e abra `feat/v1.3.0-lumiere` a partir da `main`.
2. **Novo Motor de Temas (`themeEngine.js`, `themeTokens.js`, `ThemeModal.jsx`):**
   - Remova os 21 presets antigos e substitua pelo seletor moderno de **3 Modos Base (`Dark`, `White`, `Sépia`)** + **Cor de Fundo / Ambiente (`bgTintColor`)** com 8 tons curados + seletor de cor livre e preview instantâneo.
   - Atualize `scripts/validate-contrast.mjs` para validar os 3 modos base e todas as cores de ambiente contra WCAG 2.2 AA.
3. **Padronização de Vocabulário ("Catálogo"):**
   - Renomeie *"Acervo"* e *"Cinemateca"* em toda a interface visível para **"Catálogo"** (barra inferior `BottomNav.jsx`, títulos de tela, botões e mensagens).
4. **Gate & Commit:** rode `npm test && npm run validate:contrast && npm run build`, faça o commit da Fase 1 e imprima o Relatório de Fase 1.

---

### FASE 2 — PWA Instalável (PC & Android), Compressão GZIP, Criptografia AES-GCM & Backup Google Drive
1. **PWA Nativo (`manifest.webmanifest`, `sw.js` / `vite.config.js`, `InstallAppBanner.jsx`):**
   - Garanta instalação limpa no Windows/Linux e Android (`standalone`, ícones maskable, shortcuts) e botão explícito **"Instalar App no Dispositivo"** nas Configurações e na Home quando elegível.
   - Configure limite LRU de 80 MB no cache de imagens do Service Worker para não inflar o armazenamento do celular/PC.
2. **Compressão & Criptografia (`backupCryptoService.js`):**
   - Implemente exportação e importação compactada em GZIP (`.ccodex`) com criptografia opcional `PBKDF2 + AES-GCM 256-bit` via Web Crypto API nativa (mantendo compatibilidade total para importar backups `.json` antigos sem senha).
3. **Backup no Google Drive (`googleDriveBackup.js`, `ProfileSettingsDrawer.jsx`):**
   - Implemente envio e restauração de backup `.ccodex` na pasta privada do Google Drive do usuário (com campo opcional para `Google Client ID` nas Configurações e instruções claras de uso).
4. **Gate & Commit:** crie testes unitários para compressão GZIP, criptografia/descriptografia AES-GCM e retrocompatibilidade `.json`; rode `npm test && npm run build`, faça o commit da Fase 2 e imprima o Relatório de Fase 2.

---

### FASE 3 — Página da Obra Imersiva: Paleta Dinâmica por Obra, Episódios Reais Paginados (*One Piece*) & Selos de Crítica
1. **Imersão Visual & Paleta Adaptativa (`colorExtractor.js`, `WorkDetailPage.jsx`):**
   - Ao abrir a página de uma obra, aplique o `backdropUrl` (ou `coverUrl` em alta resolução) como fundo imersivo desfocado (`blur(32px)`) sob véu legível do tema ativo.
   - Extraia as 2 cores dominantes do pôster (`--work-accent`, `--work-glow`) e aplique-as localmente aos controles, barra de progresso e abas da página da obra.
2. **Episódios Reais Paginados da Jikan / TVmaze / TMDB (`cinemaApi.js`, `EpisodeListTab.jsx`):**
   - Elimine a queda para "12 episódios genéricos" em animes e séries:
     - Para animes com `malId` (ex.: *One Piece* — `malId: 21`), busque os episódios reais via Jikan (`/anime/{id}/episodes?page={p}`) sob demanda por página/bloco de 100 episódios, exibindo **título real do episódio, data e badge `Filler` oficial** da Jikan, além de campo rápido **"Ir para o ep. #"** (ex.: digitar `1015` leva direto ao bloco `1001–1100` e destaca o episódio).
     - Para séries com `tmdbId` ou `tvmazeId`, busque a lista real de episódios da temporada selecionada (`T1`, `T2`, ..., `T15`) com título, sinopse curta e duração de cada episódio.
3. **Selos Comparativos ("Sua Nota vs. Público" — `ratingBadges.js`, `WorkDetailPage.jsx`):**
   - Calcule e exiba selos elegantes comparando sua nota pessoal (0–100) com a média externa (IMDb/AniList/TMDB):
     - **Obra-Prima Consensual** (ambos >= 88)
     - **Sintonia Total** (diferença <= 5 pts)
     - **Você Amou Mais que o Público** (sua nota >= +12 pts acima do público, exibindo `Você 92 · Público 76`)
     - **Mais Exigente que a Crítica** (sua nota <= -12 pts abaixo do público)
4. **Gate & Commit:** rode `npm test && npm run validate:contrast && npm run build`, faça o commit da Fase 3 e imprima o Relatório de Fase 3.

---

### FASE 4 — Franquias (Filmes) vs. Universos (Séries/Animes), Onde Assistir (BR) & Distinção Visual no Catálogo
1. **Separação Determinística de Franquias vs. Universos (`franchiseService.js`, `FranchiseRadarPanel.jsx`):**
   - **Para Filmes → Seção "Franquia & Sequências":**
     - Consulta `belongs_to_collection` no TMDB (ou Wikidata `P179` como fallback) e lista **todos os filmes oficiais da saga em ordem cronológica**, cruzando com seu Catálogo local para mostrar: **Concluído (com sua nota)**, **Na fila** ou **Não catalogado** (com botão `+ Adicionar` em 1 clique).
     - Cabeçalho com progresso exato da franquia: **`4/5 filmes · 80% concluído`**.
   - **Para Séries e Animes → Seção "Obras do Mesmo Universo":**
     - Consulta relações na AniList/Jikan/TMDB filtrando estritamente `SEQUEL`, `PREQUEL`, `SIDE_STORY`, `SPIN_OFF` e `PARENT` (bloqueando ruídos `CHARACTER`/`OTHER`), separadas visualmente em abas/grupos: **Série Principal**, **Filmes** e **OVAs / Especiais**, com contador de progresso por grupo e total (`5/6 obras · 83% do universo`).
2. **Onde Assistir no Brasil & Estrutura antes de Salvar (`cinemaApi.js`, `AddScreen.jsx`):**
   - No card de busca e no modal de cadastro, exiba com destaque:
     - **Badges de Streaming (BR):** `Netflix`, `Crunchyroll`, `Prime Video`, `Max`, `Disney+`, `Apple TV+`, `Globoplay` (via TMDB Watch Providers `results.BR.flatrate` + links externos AniList/Jikan).
     - **Badge de Estrutura:** `15 Temporadas · 327 Episódios` ou `1.122+ Episódios · Em exibição`.
     - Separação clara entre **Gêneros Oficiais (API)** e **Clima & Marcadores Pessoais**.
3. **Distinção Visual no Catálogo (`CatalogScreen.jsx`):**
   - Adicione nos cards da grade um **selo visual superior diferenciado por formato** (ícone + cor semântica sutil + dado-chave):
     - **Filme:** `Filme · 2h 28m`
     - **Série:** `Série · T1 E12`
     - **Anime:** `Anime · DUB` / `LEG`
   - Filtros rápidos no topo do Catálogo com contadores (`Todos`, `Filmes`, `Séries`, `Animes`).
4. **Gate & Commit:** rode `npm test && npm run validate:contrast && npm run build`, faça o commit da Fase 4 e imprima o Relatório de Fase 4.

---

### FASE 5 — Métricas Compactas ("Zero-Scroll"), Início Refinada & Perfil Editorial (Inspirado no Letterboxd/Serializd)
1. **Métricas Compactas sem Excesso de Scroll (`StatsScreen.jsx`):**
   - Reorganize o layout em **Dashboard Denso de 2 Dobra Máximas**:
     - **Linha 1 (4 KPIs horizontais compactos):** `Horas em Tela`, `Episódios Vistos`, `Obras Concluídas`, `Média Geral`.
     - **Linha 2 (Grid 2 colunas no desktop / empilhado compacto no mobile):** Coluna A = *Horas por Formato + Décadas* (alternáveis em abas internas); Coluna B = *Top 5 Diretores / Estúdios / Gêneros*.
     - **Linha 3:** *Mapa de Sessões* horizontal compacto + botão **Cine Wrapped (PNG)**.
2. **Tela Inicial (`HomeScreen.jsx`) Mais Viva:**
   - Saudação contextual com resumo vivo de 1 linha (*"3 obras em andamento · 142h acumuladas"*).
   - No Hero, exiba o **título do próximo episódio** (quando disponível na API) ao lado de `T1 · E13`.
   - Barra de atalhos rápidos abaixo do Hero: *Sortear da fila Quero Ver* e *Continuar última sessão*.
3. **Perfil Editorial (`ProfileScreen.jsx` — Zero Cara de IA):**
   - Inspirado diretamente no **Letterboxd e Serializd**:
     - Header com capa panorâmica da última obra assistida, avatar quadrado arredondado (`rounded-2xl`), nome, bio curta e **4 métricas diretas** (`Obras · Horas · Episódios · Média`).
     - **Favoritos (Top 4 pôsteres `2:3`)** limpos, sem caixas pesadas.
     - **Atividade Recente (Grade visual de pôsteres)** mostrando as últimas obras avaliadas/assistidas com sua nota, selo de crítica (*Você vs. Público*) e ícone quando há cena/anotação salva.
     - **Histograma de Notas (0–100):** gráfico de barras minimalista mostrando a distribuição real das suas avaliações.
4. **Gate & Commit:** rode `npm test && npm run validate:contrast && npm run build`, faça o commit da Fase 5 e imprima o Relatório de Fase 5.

---

### FASE 6 — Regressão Ponta-a-Ponta, Auditoria Visual Multi-Resolução & Preparação para Publicar
1. Atualize a versão para **`1.3.0`** (`Lumière`) em `package.json`, `package-lock.json`, `src/config/versioning.js`, `README.md` e `CHANGELOG.md` (mantendo o histórico de `1.2.0`, `1.1.0` e `1.0.0`).
2. Crie `tests/fase6-v130-regression.test.mjs` validando:
   - Motor de temas OKLCH (`dark`, `white`, `sepia` + harmonização de cor de fundo sem presets antigos).
   - Vocabulário `"Catálogo"` sem ocorrências visíveis de `"Cinemateca"` ou `"Acervo"`.
   - Compressão GZIP + criptografia/descriptografia AES-GCM 256-bit (`.ccodex`) + compatibilidade `.json`.
   - Episódios paginados reais de anime longo (*One Piece*) e separação Franquia (Filmes) vs. Universo (Séries/Animes) com cálculo `X/Y`.
   - Selos comparativos *Sua Nota vs. Público*.
3. Rode todos os portões obrigatórios com 0 erros:
   `npm test && npm run validate:contrast && npm run build && npm run validate:design`
4. Rode auditoria visual via Playwright em `360 px`, `768 px` e `1280 px` verificando `scrollWidth === innerWidth` e zero erros de console/CSP.
5. Faça o commit `chore(release): prepara versao 1.3.0 Lumiere, regressao end-to-end e auditoria visual` na branch `feat/v1.3.0-lumiere` e PARE, pedindo ao dono a palavra **`publicar`**.
