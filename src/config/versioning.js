/**
 * Sistema de Versionamento Nominal e Semântico do Cine Códice.
 *
 * Regras oficiais:
 * - Pequenas atualizações / correções (patch / minor): incrementam apenas os números
 *   (ex.: 1.0.1, 1.1.0, 1.2.0), mantendo o codinome atual.
 * - Grandes atualizações (major): recebem um novo codinome oficial
 *   (ex.: Lumière 1.0.0, Méliès 2.0.0).
 */

export const VERSIONING_RULES = {
  patchMinor:
    'Pequenas atualizações e correções (patch/minor) incrementam apenas o número (1.0.1, 1.1.0, 1.2.0), mantendo o codinome atual.',
  major:
    'Grandes atualizações (major) recebem um novo codinome oficial (ex.: Lumière 1.0.0, Méliès 2.0.0).',
};

import { OMNIPRISM_VERSION, OMNIPRISM_VERSION_LABEL } from './appVersion.js';

export const APP_BUILD_VERSION = OMNIPRISM_VERSION;
export const APP_BUILD_LABEL = OMNIPRISM_VERSION_LABEL;

export const CODICE_RELEASE = {
  version: OMNIPRISM_VERSION,
  codename: '',
  label: OMNIPRISM_VERSION_LABEL,
  releaseType: 'patch',
  date: '2026-11',
  summary:
    'OmniPrism v2.7.2: libera explicitamente todos os hosts de capa interceptados pelo Service Worker em connect-src (CSP), restringe o CacheFirst do Supabase no Workbox apenas ao bucket público covers (impedindo cache indevido de /rest/v1 e /auth/v1), preserva URLs protocol-relative no sync e exibe o rótulo correto do domínio nos cartazes editoriais de fallback.',
};

export const RELEASE_HISTORY = [
  {
    version: OMNIPRISM_VERSION,
    codename: '',
    label: OMNIPRISM_VERSION_LABEL,
    releaseType: 'patch',
    date: '2026-11',
    summary: CODICE_RELEASE.summary,
    highlights: [
      'Service Worker e CSP alinhados: todos os hosts de capa interceptados pelo Workbox (IGDB, RAWG, Steam, TMDB, AniList, MAL, OpenLibrary, Google Books, Wikimedia, iTunes/mzstatic) foram liberados explicitamente em connect-src sem curingas amplos.',
      'Sync protegido contra cache obsoleto: o Workbox não intercepta mais /rest/v1/* nem /auth/v1/* do Supabase, cacheando apenas objetos públicos em /storage/v1/object/public/covers/*.',
      'Preservação de URLs de capa protocol-relative (//...) durante o sync e restauração de coverSources quando o array vier vazio.',
      'Cartazes editoriais de fallback agora exibem o tipo real da obra (JOGO, LIVRO, MANGÁ, ÁLBUM, FILME etc.).',
    ],
  },
  {
    version: '2.7.1',
    codename: '',
    label: 'v2.7.1',
    releaseType: 'patch',
    date: '2026-11',
    summary:
      'OmniPrism v2.7.1 ("Conexão Confiável"): auto-configuração do Supabase via /api/config sem digitar chaves nos aparelhos, sessão persistente com renovação silenciosa e avisos claros, sincronização bidirecional entre PC e celular com fila offline, retry exponencial, tombstones (deleted_at) com modo compatível pré-SQL, resumo e snapshot automático na 1ª conexão, capas resilientes com cache segmentado por autenticação + retry no CoverImage e versão unificada em fonte única.',
    highlights: [
      'Auto-configuração pública do Supabase via /api/config (apenas { supabaseUrl, supabaseAnonKey }, nunca chaves privilegiadas), salva localmente para uso offline, com entrada manual recolhida em Avançado.',
      'Sessão persistente com reinscrição automática de onAuthStateChange, tolerância offline, renovação silenciosa ao voltar ao foco e avisos claros em português se a sessão expirar.',
      'Sincronização bidirecional confiável (independente do Realtime) com fila offline persistente, retry exponencial, tombstones via deleted_at com fallback automático pré-SQL, proteção de obras sem updated_at (contam como mais antigas) e resumo + snapshot automático na 1ª conexão de um segundo aparelho.',
      'Capas confiáveis: estado de autenticação na chave de cache da busca, aviso "Entre para carregar capas" quando deslogado, correção do coverUrl duplicado em useBacklog.js preservando capa manual, retry automático no CoverImage e hosts de capa explícitos no CSP img-src e no Workbox.',
      'Versão unificada em fonte única (src/config/appVersion.js) refletida em package.json, version.json, backup, Início, Perfil e Diagnóstico.',
    ],
  },
  {
    version: '2.4.0',
    codename: '',
    label: 'v2.4.0',
    releaseType: 'minor',
    date: '2026-11',
    summary:
      'OmniPrism v2.4.0 ("Refino & Profundidade"): modelo único de avaliação 5 estrelas (0.5 a 5.0) + marca Obra da vida + 5 critérios opcionais por domínio, migrações aditivas com snapshot automático no IndexedDB, busca progressiva 250 ms com streaming por fonte, direção de arte limpa (capas protagonistas, 2 raios, alvos >= 44 px), catalogação enxuta com alerta de duplicatas, escopos de franquia (Linha Principal vs Universo Completo), hierarquia musical SOUND (Banda -> Discografia -> Álbuns/EPs/Singles -> Faixas), Página de Entidade clicável, Curador por domínio e Diagnóstico local.',
    highlights: [
      'Avaliação unificada 5 estrelas com meia estrela (0.5 a 5.0, escala interna 0–100), marca opcional "Obra da vida" (compatível com o antigo 11 de Games) e avaliação inteligente opcional por 5 critérios específicos por domínio (20% / 1 estrela cada) com sobrescrita manual livre.',
      'IndexedDB com migrações aditivas versionadas e snapshot automático antes de migrar e antes de restaurar backup no modo Mesclar, Error Boundary global com exportação de backup de emergência, auditoria de segurança (docs/SEGURANCA.md) e rascunhos SQL locais de RLS para revisão.',
      'Busca progressiva (debounce 250 ms, AbortController, catálogo local primeiro, streaming por fonte sem travar em MusicBrainz/Wikidata e histórico local), imagens lazy/async em proporção fixa (2:3 e 1:1), paginação incremental >200 itens com IntersectionObserver, code-splitting e banner discreto de atualização PWA.',
      'Direção de arte editorial (docs/DESIGN.md): capas limpas sem pílulas poluentes, 2 valores de raio, alvos de toque >= 44 px, serifa apenas em títulos de obra/tela, números tabulares e fim de caixas vazias pesadas e card dentro de card.',
      'Catalogação search-first com folha rápida enxuta e alerta de duplicatas; escopos de franquia (Linha Principal vs Universo Completo) para Cinema, Livros e Games; hierarquia musical SOUND (Banda -> Discografia -> Lançamentos -> Faixas); Página de Entidade clicável (Autor, Diretor, Elenco, Estúdio, Banda); Acervo com folha única "Filtrar" e Desfazer em lote.',
      'Home com faixa "Em andamento" cross-domain + Curador (OracleWidget) adaptado ao domínio ativo, e Perfil com acesso rápido à Central de Backup, Novidades da versão e Configurações > Diagnóstico (versão, catálogo, storage, status das fontes e log local copiável dos últimos 50 erros sem envio externo).',
    ],
  },
  {
    version: '2.3.3',
    codename: '',
    label: 'v2.3.3',
    releaseType: 'patch',
    date: '2026-11',
    summary:
      'OmniPrism v2.3.3: CSP completa para os 4 domínios (Cinema, Leitura, Games e Música), proxy autenticado Cloudflare Pages Functions (/api/tmdb/*, /api/omdb e /api/status) com cache de borda e fallback transparente para chave local, painel Status das APIs em Configurações e suíte de testes de segurança dos dados.',
    highlights: [
      'CSP (public/_headers) atualizada apenas com os hosts ausentes de Leitura, Games, Música e Google Drive (itunes.apple.com, musicbrainz.org, openlibrary.org, www.googleapis.com, www.cheapshark.com, www.freetogame.com e coverartarchive.org), protegida por teste automatizado contra regressões.',
      'Proxy autenticado em Cloudflare Pages Functions (functions/api/) para TMDB (/api/tmdb/* com allowlist estrita), OMDb (/api/omdb) e diagnóstico (/api/status), validando Bearer token do Supabase, injetando chaves apenas no servidor e aplicando cache em caches.default (10 min busca / 24h detalhes).',
      'Fallback resiliente no cliente: com sessão Supabase ativa usa /api/... automaticamente; em 401/404/5xx, sem sessão ou em desenvolvimento, mantém chave local/VITE_ sem quebrar o app.',
      'Novo painel "Status das APIs" em Configurações (Dados & APIs) com indicador por fonte, latência em ms, botão Testar e estado "Configurado no servidor" para TMDB e OMDb, sem exibir chaves nem emojis.',
      'Testes dedicados de segurança dos dados garantindo que sync com nuvem vazia ou erro de rede nunca apaga obras locais e que backup/restauração preserva os 4 domínios, progress_data e track_ratings.',
    ],
  },
  {
    version: '1.3.0',
    codename: 'Lumière',
    label: 'v1.3.0 · Lumière',
    releaseType: 'minor',
    date: '2026-11',
    summary:
      'Cine Códice v1.3.0 Lumière: Cinema Moderno, Motor Visual OKLCH (Dark, White, Sepia + Harmonização de Cor de Fundo sem presets antigos), PWA Instalável com Cache LRU de 80 MB, Criptografia AES-GCM (.ccodex), Backup Google Drive, Paleta Adaptativa por Obra, Episódios Paginados de Anime Longo (One Piece), Radar de Franquias vs. Universos com Progresso Determinístico, Streaming no Brasil, Métricas Zero-Scroll e Perfil Editorial Letterboxd/Serializd com Histograma de Notas.',
    highlights: [
      'Motor de Temas OKLCH ("Cinema Moderno") com 3 modos base (Dark, White, Sepia) e harmonização matemática da cor de fundo (bgTintColor) gerando 5 variáveis derivadas (--bg-canvas 10%, --bg-surface 14%, --bg-elevated 18%, --border-hairline 14% e acento com contraste WCAG 2.2 AA >= 4.5:1), eliminando os 21 presets antigos e padronizando o vocabulário para "Catálogo".',
      'PWA Nativo Instalável para PC e Android (manifest standalone, atalhos rápidos e ícones maskable) com cache de pôsteres limitado a 80 MB (LRU com descarte automático de excessos) e banner não-intrusivo de instalação.',
      'Sistema de Backup Criptografado (.ccodex) com compressão GZIP nativa, criptografia PBKDF2 (150.000 iterações SHA-256) + AES-GCM 256-bit, exclusão de Base64 em pôsteres e integração com Google Drive (drive.appdata), mantendo compatibilidade 100% com backups .json.',
      'Página da Obra Imersiva com Paleta Adaptativa extraída do pôster/backdrop (--work-accent, --work-glow e fundo atmosférico com blur 32px), episódios reais paginados em blocos de 100 da Jikan com títulos, datas e selos de Filler (One Piece) com salto rápido "Ir para o ep. #", e selos de crítica comparativos (Sintonia Total, Obra-Prima Consensual, Você Amou Mais que o Público, Mais Exigente que a Crítica).',
      'Franquias de Filmes vs. Universos de Séries/Animes com cálculo exato de progresso (X/Y obras · Z% concluído), provedores de Streaming no Brasil (Netflix, Prime, Max, Disney+, Crunchyroll, etc.) e distinção visual imediata nos cards do catálogo por formato e minutagem.',
      'Dashboard de Métricas Compactas Zero-Scroll em 2 dobras máximas, Início refinada com resumo de catálogo vivo e título do próximo episódio no Hero, e Perfil Editorial estilo Letterboxd/Serializd com avatar quadrado arredondado (rounded-2xl), vitrine Top 4 limpa, grade de Atividade Recente e Histograma de Notas (0–100).',
    ],
  },
  {
    version: '1.2.0',
    codename: 'Lumière',
    label: 'v1.2.0 · Lumière',
    releaseType: 'minor',
    date: '2026-11',
    summary:
      'Cine Códice v1.2.0 Lumière: Design Editorial Cinematográfico, Página Completa da Obra (WorkDetailPage sem formulários abertos no modo leitura), IndexedDB Relacional Estruturado (5 stores com snapshot prévio), isolamento total de rascunhos sem vazamento de sinopse, busca automática de temporadas para séries/animes destravando T1..TN, pôsteres 2:3 reais nas sugestões, Home sem duplicação, Métricas acumuladas em horas/episódios/décadas e Perfil com vitrine Top 4 Favoritos, avatar customizável e remoção física do código social legado.',
    highlights: [
      'Banco relacional local em IndexedDB (cine_codice_relational_v2) com 5 stores estruturadas (works, season_progress, episode_reviews, sessions_log, api_cache) e migração idempotente com snapshot prévio obrigatório.',
      'Isolamento completo entre rascunhos de catalogação (fim do vazamento de sinopse), busca automática de temporadas via TMDB/TVmaze/AniList destravando T1→T2→T3+ e auto-mapeamento de gêneros para Atmosfera & Tags.',
      'Página Completa da Obra (WorkDetailPage.jsx) em design editorial cinematográfico com Hero widescreen, pôster 2:3, 3 abas limpas (Visão Geral, Temporadas & Episódios, Cenas & Diário) e zero inputs abertos no modo leitura.',
      'Pôsteres 2:3 reais nas sugestões curadas com cache no IndexedDB e skeleton shimmer, Home sem duplicação entre Hero e trilho Continuar Assistindo e progresso honesto sem 0% falso.',
      'Painel de Métricas redesenhado em Bento Grid Editorial com foco em Horas Assistidas, Dias Equivalentes de Cinema, Episódios Assistidos, Distribuição por Formato e Linha do Tempo por Década.',
      'Perfil Editorial com Vitrine Favoritos da Vida (Top 4), Avatar Customizável (foto 256×256 ou 8 emblemas cinematográficos), feed dinâmico de Últimas Cenas & Avaliações e remoção física definitiva do código social morto.',
    ],
  },
  {
    version: '1.1.0',
    codename: 'Lumière',
    label: 'v1.1.0 · Lumière',
    releaseType: 'minor',
    date: '2026-11',
    summary:
      'Cine Códice v1.1.0 Lumière: modo pessoal e privado (SOCIAL_ENABLED = false), fila de APIs com cache IndexedDB e ponte de IDs, OMDb (IMDb, Rotten Tomatoes e Metacritic), avaliação individual de episódios (0–100), radar de franquias com grafo automático AniList/Jikan/TMDB, Home em 4 estados com backfill de cenários e migração atômica sem nota 80 automática.',
    highlights: [
      'Infraestrutura de APIs com fila por provedor, controle de cota/429 (Retry-After), timeout, lote AniList com aliases, ponte canônica de IDs (tmdb/imdb/tvmaze/anilist/mal) e cache offline no IndexedDB.',
      'Integração OMDb (IMDb, Rotten Tomatoes e Metacritic) com contador diário, normalização 0–100 sem valores inventados, backdrops em segundo plano e painel "Sua Nota vs. Público".',
      'Avaliação por episódio (0–10 com passos de 0,5 internos em 0–100), tags/reações, gráfico e tabela acessíveis, alertas de falha de gravação (R11) e grafo automático de franquias para filmes, séries e animes.',
      'Home redesenhada com renderização local imediata, Hero nos 4 estados, pílulas de obras ativas, trilhos sob demanda e Cena Favorita (até 200 caracteres).',
      'Perfil renovado com banner dinâmico da obra ativa, métricas reais do acervo (Obras, Episódios/Horas sem durações inventadas e Média Geral), ocultação reversível das telas sociais e eliminação de termos residuais de livro.',
      'Migração atômica v1.0.0 → v1.1.0 com snapshot prévio verificado e fim da criação automática da nota padrão 80.',
    ],
  },
  {
    version: '1.0.0',
    codename: 'Lumière',
    label: 'v1.0.0 · Lumière',
    releaseType: 'major',
    date: '2026-11',
    summary:
      'Cine Códice v1.0.0 Lumière: Cinemateca física curada para filmes, séries e animes com agregador multi-fonte (AniList, MAL, TVmaze, TMDB, IMDb, Wikidata, Internet Archive), controle tátil de minutagem e episódios/fillers, radar cronológico de sagas, DNA do Espectador em 8 dimensões, bilhetes PNG e Blindagem Tripla.',
    highlights: [
      'Agregador multi-fonte gratuito com cache IndexedDB de 7 dias, timeout de 8s, deduplificação e falha isolada.',
      'Controle tátil para filmes (01:14:20 / 02:28:00, +15/+30 min, Rewatch #N, Legendado/Dublado/Original/IMAX/4K) e séries/animes (Temp. X/Y · Ep. Z/W, +1 Ep, +3 Eps, +1 Temp, grade de episódios com arcos e fillers).',
      'Radar de Franquias, Sagas & Ordem Cronológica com + Catalogar em 1 toque.',
      'DNA do Espectador em 8 dimensões com nota ponderada determinística, Roleta com filtro de tempo (25 min / 50 min / 2h+), Bilhete de Cinema PNG e Cine Wrapped PNG.',
      'Blindagem Tripla (storage.persist, espelho LZW sem Base64 e backup SHA-256) + Importador Letterboxd/IMDb/MyAnimeList.',
    ],
  },
];

export function formatReleaseBadge(release = CODICE_RELEASE) {
  const baseLabel =
    release.label ||
    (release.codename ? `v${release.version} · ${release.codename}` : `v${release.version}`);
  return `OmniPrism ${baseLabel}`;
}
