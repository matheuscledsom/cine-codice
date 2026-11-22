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
