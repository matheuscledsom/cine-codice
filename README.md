# Cine Códice — v1.2.0 · Lumière

Cinemateca pessoal, privada e offline-first construída em **React + Vite + Tailwind CSS v4** para catalogar, avaliar e acompanhar **filmes, séries e animes** com direção de arte editorial cinematográfica e banco relacional local em IndexedDB.

## Principais Recursos

- **Agregador Multi-Fonte & Fila Inteligente (`src/services/cinemaApi.js`, `src/api/httpClient.js`):** Consulta com controle de limites por provedor, tratamento de `429 / Retry-After`, deduplicação em voo, lote AniList com aliases, ponte canônica de IDs (`tmdb`, `imdb`, `tvmaze`, `anilist`, `mal`) e cache offline no IndexedDB:
  - **Animes:** AniList GraphQL e Jikan API v4 (MyAnimeList), sem necessidade de chave.
  - **Séries:** TVmaze API com temporadas, episódios, duração média e próximo episódio, sem necessidade de chave.
  - **Filmes, Séries & Notas Públicas:** TMDB API e OMDb API (IMDb, Rotten Tomatoes e Metacritic), além de IMDb Suggestion, Wikidata e Internet Archive.
  - Selo discreto de origem em cada resultado (`AniList`, `MAL`, `TVmaze`, `TMDB`, `IMDb`, `RT`, `Metacritic`, `Wikidata`, `Archive`).
- **Avaliação por Episódio, Obra e Franquia:**
  - **Episódios (0–10 em passos de 0,5 / 0–100 interna):** Nota por episódio com tags, reação rápida, atalhos `"Assistir"`, `"Até aqui"` e `"Temporada inteira"` com **Desfazer**, gráfico + tabela acessível, sugestões de filler (Jikan) e arcos (TMDB), além de persistência segura com aviso explícito caso o armazenamento falhe.
  - **Obra & Notas Públicas:** Ficha com notas externas normalizadas (sem inventar valores ausentes), comparativo `"Sua Nota vs. Público"` exclusivo para notas confirmadas (fim da nota 80 automática) e campo opcional de **Cena Favorita**.
  - **Radar de Franquias (`src/services/franchiseEngine.js`):** Liga coleções do TMDB, relações automáticas da AniList/Jikan e vínculos manuais em grafo seguro (máx. profundidade `3` e `60` nós) com progresso separado por formato (Filmes, OVAs, Especiais, Spin-offs).
- **Home & Perfil Pessoal (`SOCIAL_ENABLED = false`):**
  - **Início:** Renderização local imediata, Hero em 4 estados com `backdropUrl` (preenchido em segundo plano sem OMDb), ações `+1 Ep` / `+20 min` com **Desfazer**, pílulas das obras ativas e trilhos sob demanda.
  - **Perfil:** Banner com cena da obra em andamento (ou gradiente do tema), métricas reais do acervo (**Obras**, **Episódios / Horas** sem durações inventadas e **Média Geral**), e ocultação não destrutiva de recursos sociais (`Mural`, `Comunidade`, `Chat`, `@handle`, `Login`).
- **Controle Tátil, DNA do Espectador & Design System:**
  - **Filmes & Séries:** Minutagem (`HH:MM:SS`), `+15/+30 min`, `Rewatch #N`, legendado/dublado/IMAX, **DNA do Espectador** em 8 dimensões, Roleta por tempo disponível, **Bilhete de Cinema PNG**, **Cine Wrapped PNG**, Importador CSV e Blindagem Tripla anti-perda (storage persistente, espelho LZW sem Base64 e backup JSON com assinatura `SHA-256`).
  - **Design & Acessibilidade:** Temas verificados WCAG AA, zero emojis em interface (`\p{Extended_Pictographic}`), alvos táteis `>= 44×44 px` e suporte a `prefers-reduced-motion`.

## Chaves de API Opcionais

Todas as fontes abertas (**AniList**, **Jikan/MAL**, **TVmaze**, **Wikidata**, **Internet Archive**) funcionam sem nenhuma chave. Caso queira habilitar **TMDB**, **OMDb** ou **Google Gemini**, você pode colar suas chaves diretamente dentro do app em **Perfil → Configurações (engrenagem) → Dados & APIs** (armazenadas localmente apenas no seu navegador), ou usar um `.env` local em desenvolvimento a partir do [`.env.example`](.env.example):

```bash
cp .env.example .env
```

- `VITE_TMDB_API_KEY`: chave opcional da API v3 do TMDB (somente desenvolvimento local; em produção use a aba **Dados & APIs**).
- `VITE_OMDB_API_KEY`: chave opcional da OMDb API (plano gratuito de 1.000 req/dia, também configurável na aba **Dados & APIs**).
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`: opcionais e inativos enquanto `SOCIAL_ENABLED = false`.

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
