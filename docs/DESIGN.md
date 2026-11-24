# Direção de Arte & Sistema Visual — OMNIPRISM v2.4.0

Este documento define as diretrizes visuais oficiais do OMNIPRISM a partir da v2.4.0 ("Refino & Profundidade"). Ele preserva integralmente o motor de cores **OKLCH** com os **3 modos de superfície** (`dark`, `white`, `sepia`) e a harmonização de cor de ambiente, refinando densidade, hierarquia, ritmo espacial e protagonismo das capas.

---

## 1. Princípios Fundamentais

1. **Capa como protagonista**
   - A arte da obra (pôster, capa de livro, capa de jogo ou capa de álbum) é o elemento visual primário.
   - **Proporção rígida (zero CLS):** `aspect-[2/3]` para Cinema, Livros e Games; `aspect-square` (`1:1`) para Música.
   - **Proibido sobrepor pílulas/selos pesados sobre a capa.** Na parede de capas do Catálogo, apenas:
     - Indicador fino de status (`2px–3px` ou ponto discreto fora da arte/no topo extremo);
     - Barra de progresso fina (`3px`) rente à base da capa **somente** quando a obra estiver em andamento (`playing` / `rewatching`);
     - Nota em estrelas exibida no foco/hover ou abaixo da capa/no modo lista, nunca tampando o título da arte.

2. **Hierarquia por tipografia e espaço (fim de card dentro de card)**
   - Prefira superfícies abertas separadas por espaçamento (`16px` / `24px` / `32px`) e divisores `1px` (`border-line`) em vez de empilhar bordas dentro de bordas.
   - Regra prática: um container elevado (`bg-card border border-line`) não deve conter outros cards com fundo e borda pesados — filhos internos usam divisores sutis (`divide-y divide-line`) ou superfície limpa.

3. **Cor do domínio com parcimônia**
   - Cada domínio mantém seu matiz OKLCH calibrado (Cinema âmbar, Leitura esmeralda, Games violeta, Música carmesim).
   - **Onde a cor do domínio (`--accent-primary` / `--accent-color`) deve aparecer:**
     1. Aba ativa do seletor de domínio (`DomainSwitcherBar`) e item ativo da barra inferior (`BottomNav`);
     2. Ação principal (CTA primário único por contexto);
     3. Barra de progresso de obra em andamento e estrelas preenchidas.
   - **Onde NÃO usar cor do domínio:** bordas decorativas de chips secundários, múltiplos badges na mesma linha, fundos saturados extensos ou caixas de estado vazio.

4. **Disciplina de raios (exatamente 2 valores)**
   - `--radius-control` / `--radius-card`: **`6px`** — botões, campos de busca, capas, cards e painéis inline.
   - `--radius-sheet`: **`14px`** — modais, folhas inferiores (`ResponsiveSheet`) e gavetas.
   - Exceção funcional estrita: avatares circulares ou pontos de status/barras finas de progresso podem usar `rounded-full`. Evitar mistura arbitrária de `rounded-sm`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-3xl` na mesma tela.

5. **Tipografia Editorial + Precisão Numérica (R2)**
   - **Serifa (`--font-editorial-serif` / `Newsreader Variable`):** reservada exclusivamente para **títulos de obra** e **títulos principais de tela** (`h1` / título de página).
   - **Sans humanista (`--font-humanist-sans` / `Source Sans 3 Variable`):** todo o restante da interface (controles, rótulos, metadados, sinopses, filtros, listas).
   - **Números tabulares (`font-variant-numeric: tabular-nums`):** obrigatório em estrelas (`4.5`), notas (`0–100`), horas, páginas, capítulos, episódios, contagens (`3/5`) e anos.

6. **Ergonomia & Acessibilidade (R1, R3, R4)**
   - **Alvos de toque >= `44×44 px`** (`min-h-[44px] min-w-[44px]`) em todos os botões interativos, controles de filtro, seletores de estrelas e ações rápidas.
   - **Contraste WCAG 2.2 AA:** mínimo `4.5:1` para texto normal e `3.0:1` para componentes de UI em `dark`, `white`, `sepia` e todas as cores de ambiente (`npm run validate:contrast`).
   - **Iconografia (R1):** zero emojis em `src/`; exclusivamente `lucide-react` com `strokeWidth={1.5}`.

---

## 2. Padrões de Componentes

### Estados Vazios
- **Nunca** usar caixas grandes com borda tracejada, ícones gigantes decorativos ou parágrafos motivacionais genéricos.
- Estrutura obrigatória: **1 campo de busca ou 1 ação direta primária + 1 frase curta no vocabulário do domínio** (ex.: *"Nenhum livro na sua estante ainda."* + botão/campo de busca).

### Chips e Filtros
- Substituir fileiras de chips com borda tingida por segmentos neutros limpos (`bg-app` / `border-line`, texto `text-muted`, estado ativo em `text-ink` com indicador ou fundo neutro elevado).
- Na tela de Catálogo, consolidar filtros secundários em uma única folha (`"Filtrar"`), mantendo no topo apenas a busca e os controles essenciais.

### Avaliações (5 Estrelas + 5 Critérios)
- Exibição padrão em **5 estrelas com meia estrela (`0.5` a `5.0`)** + ícone/marca discreta **"Obra da vida"** (sem ruído visual).
- O detalhe dos **5 critérios** permanece recolhido sob demanda (`"Avaliar por 5 critérios"`), mantendo a catalogação rápida limpa e objetiva.

### Feedback e Reversibilidade
- Toda ação rápida de progresso (`+1 ep`, `+10 págs`, `+1 cap`, `+30 min`, `+1h`, `+1 escuta`) e operação em lote oferece **Desfazer** imediato via toast discreto.
- Atualizações do PWA usam aviso sutil não-bloqueante (`"Nova versão disponível"` + botão `"Atualizar"`).
