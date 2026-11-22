# Cine Códice — v1.0.0 · Lumière

Cinemateca pessoal e offline-first construída em **React + Vite + Tailwind CSS v4** para catalogar, organizar e acompanhar **filmes, séries e animes** com estética física de videolocadora curada.

## Principais Recursos

- **Agregador Multi-Fonte Gratuito (`src/services/cinemaApi.js`):** Consulta paralela com timeout de 8s, cache local + IndexedDB (7 dias), deduplificação por título normalizado e ano e falha isolada (se uma API falhar, as demais respondem):
  - **Animes:** AniList GraphQL e Jikan API v4 (MyAnimeList), sem necessidade de chave.
  - **Séries:** TVmaze API com temporadas, episódios e duração média, sem necessidade de chave.
  - **Filmes & Séries:** TMDB API (quando `VITE_TMDB_API_KEY` está configurada no `.env` ou nas Configurações), IMDb Suggestion API e Wikidata / Internet Archive.
  - Badge discreto de origem em cada resultado (`AniList`, `MAL`, `TVmaze`, `TMDB`, `IMDb`, `Wikidata`, `Archive`).
- **Controle Tátil de Progresso por Tipo de Obra:**
  - **Filmes:** Minutagem atual (`HH:MM:SS / HH:MM:SS`) com atalhos `+15 min`, `+30 min` e `Concluir Sessão`, contador `Rewatch #N` e formato/áudio (*Legendado*, *Dublado*, *Original*, *IMAX/4K*).
  - **Séries & Animes:** Painel `Temp. X / Y · Ep. Z / W (%)` com atalhos `+1 Ep`, `+3 Eps`, `+1 Temp` e grade clicável por temporada com marcação individual de assistidos, fillers e arcos (com opção de ignorar fillers no percentual).
  - **Status:** `Quero Ver`, `Assistindo`, `Concluído`, `Em Pausa`, `Reassistindo` e `Abandonado`.
- **Estante Direta & Pôster Determinístico:** Alternância imediata entre **Grade** (`2:3` com borda de 2px e fita de progresso), **Lista** compacta e **Estante** vertical de fitas/Blu-ray. Obras sem imagem recebem pôster tipográfico editorial determinístico sem IA (`src/graphics/posterGenerator.js`).
- **Radar de Franquias & Ordem Cronológica (`src/services/franchiseEngine.js`):** Agrupa sequências, prequels, OVAs e filmes canônicos na ficha da obra e no carrossel *Sagas & Universos em Andamento* com botão `+ Catalogar` em 1 toque para títulos faltantes.
- **DNA do Espectador (8 Dimensões) & Roleta:** Sliders táteis de 0 a 100 para calcular nota ponderada determinística, **Roleta "O que assistir hoje?"** com filtro de tempo disponível (`25 min`, `50 min`, `2h+`), cartões **Bilhete de Cinema (PNG)** e **Cine Wrapped (PNG `1080×1350`)**.
- **Qualidade de Vida:** Check-in de Sessão na Home (`+1 Ep` ou `+20 min`), Mapa de Calor Anual, Command Palette (`Ctrl+K`), Seleção em Lote com Desfazer (8s), Coleções Personalizadas, Importador CSV (**Letterboxd**, **IMDb**, **MyAnimeList**) com detector de duplicados e Exportador JSON/CSV/Markdown (`.md`).
- **Design System v2 (6 Temas Reais):** `pastel-glass`, `windows-xp`, `windows-7`, `frutiger-aero`, `manga-ink` e `focus-dim`, com verificação WCAG AA e zero emojis em código de interface.
- **Blindagem Tripla Anti-Perda:**
  1. Solicitação de armazenamento persistente (`navigator.storage.persist()`).
  2. Espelho comprimido LZW no `localStorage` sob a chave `cine_codice_emergency_mirror_v1` sem imagens `data:image/` Base64.
  3. Lembrete automático de backup com exportação `.json` assinada com checksum `SHA-256`.
- **Compartilhamento sem Servidor & Sincronização Opcional:** Cartão público compacto em URL (`?card=...` + QR Code SVG nativo) e backend opcional via Supabase (`@handle#XXXX`).

## Variáveis de Ambiente Opcionais

Crie um arquivo `.env` na raiz a partir do [`.env.example`](.env.example) caso deseje ativar fontes ou sincronização extras (todas as demais fontes gratuitas funcionam sem configuração):

```bash
cp .env.example .env
```

- `VITE_TMDB_API_KEY`: chave opcional da API v3 do TMDB (pode também ser inserida dentro do app na aba **Configurações**).
- `VITE_SUPABASE_URL`: URL opcional do projeto Supabase para sincronização e perfis sociais (`@handle#XXXX`).
- `VITE_SUPABASE_ANON_KEY`: chave pública anônima (`anon key`) do Supabase.

## Comandos Locais

```bash
npm install
npm run dev
npm test
npm run validate:contrast
node scripts/validate-design.mjs
npm run build
```

## Deploy no Cloudflare Pages

O repositório já inclui [`public/_headers`](public/_headers) com política de segurança CSP ajustada para as APIs audiovisuais e o workflow [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml).

### Deploy manual com Wrangler

```bash
npm install
npm run build
npx wrangler pages deploy dist --project-name=cine-codice
```

### Deploy automático via GitHub Actions

Nos segredos (*Settings → Secrets and variables → Actions*) do repositório no GitHub, cadastre:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

A cada push na branch `main`, o build é gerado e publicado automaticamente no projeto `cine-codice` do Cloudflare Pages.

## Licença

Distribuído sob a licença MIT — veja [LICENSE](LICENSE).
