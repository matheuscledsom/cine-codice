/**
 * Sistema de Versionamento Nominal e Semântico do Cine Códice.
 *
 * Regras oficiais:
 * - Pequenas atualizações / correções (patch / minor): incrementam apenas os números
 *   (ex.: 1.0.1, 1.1.0), mantendo o codinome atual.
 * - Grandes atualizações (major): recebem um novo codinome oficial
 *   (ex.: Lumière 1.0.0, Méliès 2.0.0).
 */

export const VERSIONING_RULES = {
  patchMinor:
    'Pequenas atualizações e correções (patch/minor) incrementam apenas o número (1.0.1, 1.1.0), mantendo o codinome atual.',
  major:
    'Grandes atualizações (major) recebem um novo codinome oficial (ex.: Lumière 1.0.0, Méliès 2.0.0).',
};

export const CODICE_RELEASE = {
  version: '1.1.0',
  codename: 'Lumière',
  label: 'v1.1.0 · Lumière',
  releaseType: 'minor',
  date: '2026-11',
  summary:
    'Cine Códice v1.1.0 Lumière: modo pessoal e privado (SOCIAL_ENABLED = false), fila de APIs com cache IndexedDB e ponte de IDs, OMDb (IMDb, Rotten Tomatoes e Metacritic), avaliação individual de episódios (0–100), radar de franquias com grafo automático AniList/Jikan/TMDB, Home em 4 estados com backfill de cenários e migração atômica sem nota 80 automática.',
};

export const RELEASE_HISTORY = [
  {
    version: '1.1.0',
    codename: 'Lumière',
    label: 'v1.1.0 · Lumière',
    releaseType: 'minor',
    date: '2026-11',
    summary: CODICE_RELEASE.summary,
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
  return `Cine Códice ${release.label || `v${release.version} · ${release.codename}`}`;
}
