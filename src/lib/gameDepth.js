/**
 * Profundidade Real de Games (v2.5.0 Fase C + v2.6.0 Fase 1).
 *
 * Regras:
 * - Os campos detalhados ficam SOMENTE na ficha da obra (folha rápida de catalogar segue enxuta).
 * - "Tempo médio" sempre exibe a fonte real (`IGDB (tempo médio para zerar)` ou `RAWG (média dos usuários do RAWG)`).
 * - "Tempo 100%" só exibe valor automático se houver fonte explícita (ex.: IGDB `completely`);
 *   no RAWG permanece editável pelo usuário e nunca é inventado.
 * - Modelo `achievements`: `{ source, unlocked, total, updated_at }` com marcação manual para consoles offline.
 */

import {
  GAME_EDITION_TYPES,
  inferDomainFromWork,
  normalizeGameEditionType,
} from '../config/domainConfig.js';

export const RAWG_CAMPAIGN_TIME_SOURCE_LABEL = 'RAWG (média dos usuários do RAWG)';
export const IGDB_CAMPAIGN_TIME_SOURCE_LABEL = 'IGDB (tempo médio para zerar)';
export const IGDB_COMPLETION_100_SOURCE_LABEL = 'IGDB';
export const GAME_ATTRIBUTION_LINKS = {
  igdb: { label: 'IGDB.com', url: 'https://www.igdb.com' },
  rawg: { label: 'RAWG', url: 'https://rawg.io' },
  steam: { label: 'Steam Store', url: 'https://store.steampowered.com' },
  retroachievements: { label: 'RetroAchievements', url: 'https://retroachievements.org' },
};

export const ACHIEVEMENT_SOURCE_OPTIONS = Object.freeze([
  Object.freeze({ id: 'manual', label: 'Manual · Offline', shortLabel: 'Manual / Offline' }),
  Object.freeze({ id: 'steam', label: 'Steam', shortLabel: 'Steam' }),
  Object.freeze({
    id: 'retroachievements',
    label: 'RetroAchievements',
    shortLabel: 'RetroAchievements',
  }),
]);

export function normalizeAchievementSource(raw) {
  const clean = String(raw || '')
    .trim()
    .toLowerCase();
  if (!clean || clean === 'manual' || clean === 'offline') return 'manual';
  if (clean === 'steam' || clean === 'steam_web_api' || clean === 'steamachievements') {
    return 'steam';
  }
  if (clean === 'retroachievements' || clean === 'retro_achievements' || clean === 'ra') {
    return 'retroachievements';
  }
  return clean;
}

export function formatAchievementsSourceLabel(source) {
  const norm = normalizeAchievementSource(source);
  if (norm === 'steam') return 'Steam';
  if (norm === 'retroachievements') return 'RetroAchievements';
  if (norm === 'manual') return 'Manual · Offline';
  return String(source || 'Manual · Offline').trim() || 'Manual · Offline';
}

const EDITION_SUFFIX_RE =
  /\b(remake|remastered|definitive\s+edition|goty|game\s+of\s+the\s+year|complete\s+edition|director'?s\s+cut|hd|anniversary\s+edition|ultimate\s+edition|royal|golden|expanded)\b/gi;

const TRAILING_NUMERAL_RE =
  /\s+(?:(?:\d{1,2})|(?:ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|xvi))$/i;

function normalizeGameKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizePlatformName(raw) {
  const clean = String(raw || '').trim();
  if (!clean) return '';
  const low = clean.toLowerCase();
  if (/playstation\s*5|\bps5\b/.test(low)) return 'PS5';
  if (/playstation\s*4|\bps4\b/.test(low)) return 'PS4';
  if (/playstation\s*3|\bps3\b/.test(low)) return 'PS3';
  if (/playstation\s*2|\bps2\b/.test(low)) return 'PS2';
  if (/playstation\s*portable|\bpsp\b/.test(low)) return 'PSP';
  if (/playstation\s*vita|\bps\s*vita\b|\bvita\b/.test(low)) return 'PS Vita';
  if (/playstation(\s*1)?|\bps1\b|\bpsx\b/.test(low)) return 'PS1';
  if (/nintendo\s*switch|\bswitch\b/.test(low)) return 'Switch';
  if (/super\s*nintendo|super\s*famicom|\bsnes\b/.test(low)) return 'SNES';
  if (/game\s*boy\s*advance|\bgba\b/.test(low)) return 'GBA';
  if (/nintendo\s*3ds|\b3ds\b/.test(low)) return '3DS';
  if (/nintendo\s*ds|\bnds\b|\bds\b/.test(low)) return 'DS';
  if (
    /\b(microsoft\s*windows|windows|pc|mac\s?os|macintosh|os\s?x|linux|steam\s?os|web\s*browser|browser)\b/.test(
      low
    )
  ) {
    return 'PC';
  }
  if (/\b(android|ios|iphone|ipad|mobile)\b/.test(low)) return 'Mobile';
  if (/xbox\s*series/.test(low)) return 'Xbox Series X/S';
  if (/xbox\s*one/.test(low)) return 'Xbox One';
  if (/xbox\s*360/.test(low)) return 'Xbox 360';
  if (/\bxbox\b/.test(low)) return 'Xbox';
  if (/gamecube/.test(low)) return 'GameCube';
  if (/wii\s*u/.test(low)) return 'Wii U';
  if (/\bwii\b/.test(low)) return 'Wii';
  if (/nintendo\s*64|\bn64\b/.test(low)) return 'N64';
  if (/\bnes\b|nintendo\s*entertainment\s*system|famicom/.test(low)) return 'NES';
  if (/genesis|mega\s*drive/.test(low)) return 'Mega Drive';
  if (/dreamcast/.test(low)) return 'Dreamcast';
  return clean;
}

export function extractGameFranchiseHintFromTitle(rawTitle = '') {
  let clean = String(rawTitle || '').trim();
  if (!clean) return '';

  clean = clean.replace(/\s*\([^)]*\)\s*/g, ' ').trim();

  if (clean.includes(':')) {
    clean = clean.split(':')[0].trim();
  } else if (/\s[-–—]\s/.test(clean)) {
    clean = clean.split(/\s[-–—]\s/)[0].trim();
  }

  clean = clean.replace(EDITION_SUFFIX_RE, '').replace(/\s+/g, ' ').trim();
  clean = clean.replace(TRAILING_NUMERAL_RE, '').trim();

  return clean.length >= 3 ? clean : '';
}

/**
 * Converte tipo de jogo da IGDB (`game_type` v4: id ou string) + título conservador
 * para uma das 6 categorias canônicas: Jogo, Remake, Remaster, Port, Coletânea, DLC.
 * Desconhecido = "Jogo", sem chute.
 */
export function resolveIgdbEditionType(igdbGame = {}) {
  const gt = igdbGame?.game_type;
  const gtId =
    typeof gt === 'number'
      ? gt
      : gt && typeof gt === 'object' && Number.isFinite(Number(gt.id))
        ? Number(gt.id)
        : Number.isFinite(Number(igdbGame?.category))
          ? Number(igdbGame.category)
          : null;
  const gtLabel = String(
    typeof gt === 'string' ? gt : gt?.type || ''
  )
    .trim()
    .toLowerCase();

  if (gtId === 8 || gtLabel === 'remake') return 'Remake';
  if (gtId === 9 || gtLabel === 'remaster') return 'Remaster';
  if (gtId === 11 || gtLabel === 'port') return 'Port';
  if (gtId === 3 || gtLabel === 'bundle') return 'Coletânea';
  if (
    [1, 2, 4, 6, 7, 13].includes(gtId) ||
    ['dlc_addon', 'dlc', 'expansion', 'standalone_expansion', 'episode', 'season', 'pack'].includes(
      gtLabel
    )
  ) {
    return 'DLC';
  }

  const title = String(igdbGame?.name || '').trim();
  if (gtId === 10 || gtLabel === 'expanded_game') {
    if (/\b(collection|colet[âa]nea|trilogy|anthology|bundle)\b/i.test(title)) {
      return 'Coletânea';
    }
    if (/\b(remaster|remastered|hd)\b/i.test(title)) {
      return 'Remaster';
    }
    return 'Jogo';
  }

  if (gtId === 0 || gtLabel === 'main_game' || gtLabel === 'main game') {
    // Mesmo se main_game, respeita palavras explícitas de Remake/Remaster/Coletânea quando houver version_parent
    if (igdbGame?.version_parent) {
      if (/\bremake\b/i.test(title)) return 'Remake';
      if (/\bremaster(ed)?\b/i.test(title)) return 'Remaster';
      if (/\b(collection|colet[âa]nea|trilogy|bundle)\b/i.test(title)) return 'Coletânea';
    }
    return 'Jogo';
  }

  if (/\bremake\b/i.test(title)) return 'Remake';
  if (/\bremaster(ed)?\b/i.test(title)) return 'Remaster';
  if (/\b(collection|colet[âa]nea|trilogy|anthology|bundle)\b/i.test(title)) return 'Coletânea';
  if (/\b(dlc|expansion|expans[ãa]o|season pass)\b/i.test(title)) return 'DLC';

  return GAME_EDITION_TYPES[0];
}

function unixSecondsToYear(sec) {
  const num = Number(sec);
  if (!Number.isFinite(num) || num <= 0) return null;
  const yr = new Date(num * 1000).getUTCFullYear();
  return yr >= 1970 && yr <= 2099 ? yr : null;
}

function extractIgdbOriginalPlatforms(igdbGame = {}, allPlatforms = []) {
  const rds = Array.isArray(igdbGame?.release_dates) ? igdbGame.release_dates : [];
  const datedEntries = rds
    .map((rd) => {
      const platName = normalizePlatformName(rd?.platform?.name || rd?.platform?.abbreviation || '');
      const dateNum = Number(rd?.date);
      const yearNum = Number(rd?.y) || (Number.isFinite(dateNum) && dateNum > 0 ? unixSecondsToYear(dateNum) : null);
      if (!platName) return null;
      return {
        platName,
        dateNum: Number.isFinite(dateNum) && dateNum > 0 ? dateNum : null,
        yearNum: yearNum && yearNum >= 1970 ? yearNum : null,
      };
    })
    .filter(Boolean);

  if (datedEntries.length > 0) {
    const withExactDate = datedEntries.filter((e) => e.dateNum !== null);
    if (withExactDate.length > 0) {
      const minDate = Math.min(...withExactDate.map((e) => e.dateNum));
      // Considera plataformas lançadas na mesma janela inicial (até 7 dias do lançamento original)
      const originals = Array.from(
        new Set(
          withExactDate
            .filter((e) => Math.abs(e.dateNum - minDate) <= 7 * 86400)
            .map((e) => e.platName)
        )
      );
      if (originals.length > 0) return originals;
    }

    const withYear = datedEntries.filter((e) => e.yearNum !== null);
    if (withYear.length > 0) {
      const minYear = Math.min(...withYear.map((e) => e.yearNum));
      const originals = Array.from(
        new Set(withYear.filter((e) => e.yearNum === minYear).map((e) => e.platName))
      );
      if (originals.length > 0) return originals;
    }
  }

  if (allPlatforms.length === 1) {
    return [allPlatforms[0]];
  }
  return [];
}

/**
 * Converte resposta da IGDB API v4 para metadados estruturados e transparentes.
 */
export function parseIgdbGameMetadata(igdbGame = null) {
  if (!igdbGame || typeof igdbGame !== 'object') return null;

  const igdbId = Number(igdbGame.id) > 0 ? Math.floor(Number(igdbGame.id)) : null;
  const title = String(igdbGame.name || '').trim();
  if (!title) return null;

  const slug = String(igdbGame.slug || '').trim() || null;
  const imageId = String(igdbGame?.cover?.image_id || '').trim();
  const coverUrl = imageId
    ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`
    : null;

  const platforms = Array.from(
    new Set(
      (Array.isArray(igdbGame.platforms) ? igdbGame.platforms : [])
        .map((p) => normalizePlatformName(p?.name || p?.abbreviation || ''))
        .filter(Boolean)
    )
  );
  const originalPlatforms = extractIgdbOriginalPlatforms(igdbGame, platforms);

  const companies = Array.isArray(igdbGame.involved_companies)
    ? igdbGame.involved_companies
    : [];
  const developers = Array.from(
    new Set(
      companies
        .filter((c) => c?.developer === true && c?.company?.name)
        .map((c) => String(c.company.name).trim())
        .filter(Boolean)
    )
  );
  const publishers = Array.from(
    new Set(
      companies
        .filter((c) => c?.publisher === true && c?.company?.name)
        .map((c) => String(c.company.name).trim())
        .filter(Boolean)
    )
  );

  const releaseYear = unixSecondsToYear(igdbGame.first_release_date);
  const editionType = normalizeGameEditionType(resolveIgdbEditionType(igdbGame));

  const parentGame =
    igdbGame.parent_game && typeof igdbGame.parent_game === 'object'
      ? {
          id: Number(igdbGame.parent_game.id) || null,
          name: String(igdbGame.parent_game.name || '').trim(),
          releaseYear: unixSecondsToYear(igdbGame.parent_game.first_release_date),
        }
      : Number(igdbGame.parent_game) > 0
        ? { id: Number(igdbGame.parent_game), name: '', releaseYear: null }
        : null;

  const versionParent =
    igdbGame.version_parent && typeof igdbGame.version_parent === 'object'
      ? {
          id: Number(igdbGame.version_parent.id) || null,
          name: String(igdbGame.version_parent.name || '').trim(),
          releaseYear: unixSecondsToYear(igdbGame.version_parent.first_release_date),
        }
      : Number(igdbGame.version_parent) > 0
        ? { id: Number(igdbGame.version_parent), name: '', releaseYear: null }
        : null;

  const franchises = Array.isArray(igdbGame.franchises)
    ? igdbGame.franchises
        .filter((f) => f && f.name)
        .map((f) => ({ id: Number(f.id) || null, name: String(f.name).trim() }))
    : [];
  const collections = Array.isArray(igdbGame.collections)
    ? igdbGame.collections
        .filter((c) => c && c.name)
        .map((c) => ({ id: Number(c.id) || null, name: String(c.name).trim() }))
    : [];
  const franchiseName = franchises[0]?.name || collections[0]?.name || '';

  const ttb = igdbGame.time_to_beat || null;
  const normallySec = Number(ttb?.normally);
  const completelySec = Number(ttb?.completely);

  const campaignTimeHours =
    Number.isFinite(normallySec) && normallySec > 0
      ? Math.round((normallySec / 3600) * 10) / 10
      : null;
  const completion100Hours =
    Number.isFinite(completelySec) && completelySec > 0
      ? Math.round((completelySec / 3600) * 10) / 10
      : null;

  return {
    igdbId,
    slug,
    title,
    synopsis: String(igdbGame.summary || '').trim(),
    coverUrl,
    developers,
    publishers,
    releaseYear,
    platforms,
    originalPlatforms,
    editionType,
    parentGame,
    versionParent,
    franchises,
    collections,
    franchiseName,
    campaignTimeHours,
    campaignTimeSource: campaignTimeHours !== null ? IGDB_CAMPAIGN_TIME_SOURCE_LABEL : null,
    completion100Hours,
    completion100Source: completion100Hours !== null ? IGDB_COMPLETION_100_SOURCE_LABEL : null,
  };
}

/**
 * Converte resposta do RAWG (`/api/rawg/games/{id}`) para metadados transparentes.
 * Nunca inventa `completion100Hours` (RAWG não fornece tempo de 100%).
 */
export function parseRawgGameMetadata(rawgGame = null) {
  if (!rawgGame || typeof rawgGame !== 'object') return null;

  const rawgId = Number(rawgGame.id) > 0 ? Math.floor(Number(rawgGame.id)) : null;
  const rawgSlug = String(rawgGame.slug || '').trim() || null;
  const rawPlaytime = Number(rawgGame.playtime);
  const rawgPlaytimeHours =
    Number.isFinite(rawPlaytime) && rawPlaytime > 0
      ? Math.round(rawPlaytime * 10) / 10
      : null;

  const metacritic =
    Number.isFinite(Number(rawgGame.metacritic)) && Number(rawgGame.metacritic) > 0
      ? Math.round(Number(rawgGame.metacritic))
      : null;

  const platforms = Array.isArray(rawgGame.platforms)
    ? Array.from(
        new Set(
          rawgGame.platforms
            .map((p) => normalizePlatformName(p?.platform?.name || p?.name || ''))
            .filter(Boolean)
        )
      )
    : [];

  const developers = Array.isArray(rawgGame.developers)
    ? rawgGame.developers.map((d) => String(d?.name || '').trim()).filter(Boolean)
    : [];

  const publishers = Array.isArray(rawgGame.publishers)
    ? rawgGame.publishers.map((p) => String(p?.name || '').trim()).filter(Boolean)
    : [];

  const title = String(rawgGame.name || '').trim();

  return {
    rawgId,
    rawgSlug,
    title,
    rawgPlaytimeHours,
    rawgPlaytimeSource: rawgPlaytimeHours !== null ? RAWG_CAMPAIGN_TIME_SOURCE_LABEL : null,
    completion100Hours: null,
    completion100Source: null,
    metacritic,
    platforms,
    developers,
    publishers,
    released: String(rawgGame.released || '').trim() || null,
    franchiseSuggestionHint: extractGameFranchiseHintFromTitle(title),
  };
}

/**
 * Formata "Tempo médio de campanha" com rotulagem obrigatória da fonte (IGDB, RAWG ou manual).
 */
export function formatGameCampaignTime(work = {}) {
  if (!work || typeof work !== 'object') return null;

  const igdbOrCampaignHours = Number(
    work.campaignTimeHours ??
      work.progress_data?.campaignTimeHours ??
      work.igdbTimeToBeatHours ??
      work.progress_data?.igdbTimeToBeatHours
  );
  if (Number.isFinite(igdbOrCampaignHours) && igdbOrCampaignHours > 0) {
    const cleanHours = Math.round(igdbOrCampaignHours * 10) / 10;
    const sourceLabel =
      String(
        work.campaignTimeSource || work.progress_data?.campaignTimeSource || ''
      ).trim() || IGDB_CAMPAIGN_TIME_SOURCE_LABEL;
    return {
      hours: cleanHours,
      label: `${cleanHours} h`,
      sourceLabel,
      isFromIgdb: /igdb/i.test(sourceLabel),
      isFromRawg: /rawg/i.test(sourceLabel),
    };
  }

  const rawgHours = Number(work.rawgPlaytimeHours ?? work.progress_data?.rawgPlaytimeHours);
  if (Number.isFinite(rawgHours) && rawgHours > 0) {
    const cleanHours = Math.round(rawgHours * 10) / 10;
    const sourceLabel =
      String(work.rawgPlaytimeSource || work.progress_data?.rawgPlaytimeSource || '').trim() ||
      RAWG_CAMPAIGN_TIME_SOURCE_LABEL;
    return {
      hours: cleanHours,
      label: `${cleanHours} h`,
      sourceLabel,
      isFromIgdb: false,
      isFromRawg: true,
    };
  }

  const manualHours = Number(work.manualCampaignHours ?? work.progress_data?.manualCampaignHours);
  if (Number.isFinite(manualHours) && manualHours > 0) {
    const cleanHours = Math.round(manualHours * 10) / 10;
    return {
      hours: cleanHours,
      label: `${cleanHours} h`,
      sourceLabel: 'Informado manualmente',
      isFromIgdb: false,
      isFromRawg: false,
    };
  }

  return null;
}

/**
 * Formata "Tempo 100%": exibe fonte externa se existir (ex.: IGDB); senão informa que é editável manualmente.
 */
export function formatGameCompletion100Time(work = {}) {
  if (!work || typeof work !== 'object') {
    return {
      hours: null,
      label: 'Sem fonte automática',
      sourceLabel: 'Editável em Mais detalhes',
      hasExternalSource: false,
      editable: true,
    };
  }

  const rawHours = Number(work.completion100Hours ?? work.progress_data?.completion100Hours);
  const rawSource = String(
    work.completion100Source ?? work.progress_data?.completion100Source ?? ''
  ).trim();

  if (Number.isFinite(rawHours) && rawHours > 0) {
    const cleanHours = Math.round(rawHours * 10) / 10;
    const hasExternalSource = Boolean(rawSource && rawSource.toLowerCase() !== 'manual');
    return {
      hours: cleanHours,
      label: `${cleanHours} h`,
      sourceLabel: hasExternalSource
        ? `Fonte: ${rawSource}`
        : 'Editado manualmente',
      hasExternalSource,
      editable: true,
    };
  }

  return {
    hours: null,
    label: 'Sem fonte automática',
    sourceLabel: 'Editável manualmente',
    hasExternalSource: false,
    editable: true,
  };
}

/**
 * Normaliza o modelo de troféus/conquistas `{ source, unlocked, total, updated_at }`.
 * Mantém marcação manual para consoles offline e prepara o contrato para sincronização na v2.7.0.
 */
export function normalizeAchievementsModel(raw = null) {
  if (!raw || typeof raw !== 'object') return null;

  const hasUnlocked =
    raw.unlocked !== null &&
    raw.unlocked !== undefined &&
    raw.unlocked !== '' &&
    Number.isFinite(Number(raw.unlocked));
  const hasTotal =
    raw.total !== null &&
    raw.total !== undefined &&
    raw.total !== '' &&
    Number.isFinite(Number(raw.total));

  if (!hasUnlocked && !hasTotal) return null;

  const total = hasTotal && Number(raw.total) > 0 ? Math.floor(Number(raw.total)) : null;
  let unlocked = hasUnlocked ? Math.max(0, Math.floor(Number(raw.unlocked))) : 0;
  if (total !== null && unlocked > total) {
    unlocked = total;
  }

  return {
    source: normalizeAchievementSource(raw.source),
    unlocked,
    total,
    updated_at: raw.updated_at || new Date().toISOString(),
  };
}

export function formatGameAchievementsSummary(achievements = null) {
  const norm = normalizeAchievementsModel(achievements);
  if (!norm) return null;
  const pct =
    norm.total && norm.total > 0
      ? Math.min(100, Math.round((norm.unlocked / norm.total) * 100))
      : null;
  return {
    ...norm,
    sourceLabel: formatAchievementsSourceLabel(norm.source),
    pct,
    label:
      norm.total && norm.total > 0
        ? `${norm.unlocked} / ${norm.total}${pct !== null ? ` (${pct}%)` : ''}`
        : `${norm.unlocked} obtidos`,
  };
}

/**
 * Interpreta resposta de `ISteamUserStats/GetPlayerAchievements` da Steam Web API.
 */
export function parseSteamAchievementsResponse(
  payload = null,
  { nowIso = new Date().toISOString() } = {}
) {
  const stats = payload?.playerstats;
  if (!stats || typeof stats !== 'object') {
    return {
      ok: false,
      error: 'Resposta Steam inválida ou indisponível.',
      gameName: '',
      achievements: null,
    };
  }

  if (stats.success === false) {
    const rawErr = String(stats.error || '').toLowerCase();
    const friendly = rawErr.includes('private') || rawErr.includes('not public')
      ? 'Perfil Steam privado. Torne os detalhes de jogos públicos na Steam para sincronizar.'
      : rawErr.includes('no stats') || rawErr.includes('requested app')
        ? 'Este jogo não possui conquistas públicas registradas na Steam.'
        : 'Não foi possível ler as conquistas deste jogo na Steam.';
    return {
      ok: false,
      error: friendly,
      gameName: String(stats.gameName || '').trim(),
      achievements: null,
    };
  }

  const list = Array.isArray(stats.achievements) ? stats.achievements : [];
  if (list.length === 0) {
    return {
      ok: false,
      error: 'Este jogo não possui conquistas registradas na Steam.',
      gameName: String(stats.gameName || '').trim(),
      achievements: null,
    };
  }

  const unlocked = list.filter(
    (entry) => Number(entry?.achieved) === 1 || entry?.achieved === true
  ).length;

  return {
    ok: true,
    error: '',
    gameName: String(stats.gameName || '').trim(),
    achievements: normalizeAchievementsModel({
      source: 'steam',
      unlocked,
      total: list.length,
      updated_at: nowIso,
    }),
  };
}

/**
 * Interpreta resposta de `IPlayerService/GetOwnedGames` da Steam Web API e
 * opcionalmente encontra o `appId` correspondente ao título do jogo.
 */
export function parseSteamOwnedGamesResponse(payload = null, { titleHint = '' } = {}) {
  const rawList = Array.isArray(payload?.response?.games) ? payload.response.games : [];
  const games = rawList
    .map((g) => {
      const appId = Number(g?.appid);
      const name = String(g?.name || '').trim();
      if (!Number.isFinite(appId) || appId <= 0) return null;
      const mins = Number(g?.playtime_forever) || 0;
      return {
        appId: Math.floor(appId),
        name,
        playtimeHours: Math.round((mins / 60) * 10) / 10,
      };
    })
    .filter(Boolean);

  let matchedGame = null;
  const normHint = normalizeGameKey(titleHint);
  if (normHint && games.length > 0) {
    matchedGame =
      games.find((g) => normalizeGameKey(g.name) === normHint) ||
      games.find((g) => {
        const k = normalizeGameKey(g.name);
        return k && (k.startsWith(normHint) || normHint.startsWith(k));
      }) ||
      games.find((g) => {
        const k = normalizeGameKey(g.name);
        return k && normHint.length >= 4 && (k.includes(normHint) || normHint.includes(k));
      }) ||
      null;
  }

  return { games, matchedGame };
}

/**
 * Interpreta resposta de `API_GetGameInfoAndUserProgress.php` do RetroAchievements.
 */
export function parseRetroAchievementsResponse(
  payload = null,
  { nowIso = new Date().toISOString() } = {}
) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      ok: false,
      error: 'Resposta RetroAchievements inválida.',
      gameTitle: '',
      consoleName: '',
      achievements: null,
    };
  }

  const gameTitle = String(payload.Title || '').trim();
  const consoleName = String(payload.ConsoleName || '').trim();
  const achMapValues =
    payload.Achievements && typeof payload.Achievements === 'object'
      ? Object.values(payload.Achievements)
      : [];

  const totalRaw = Number(payload.NumAchievements);
  const total =
    Number.isFinite(totalRaw) && totalRaw > 0 ? Math.floor(totalRaw) : achMapValues.length;

  if (total <= 0) {
    const hasGameMeta = Boolean(gameTitle || Number(payload.ID) > 0);
    return {
      ok: false,
      error: hasGameMeta
        ? 'Este jogo não possui conquistas registradas no RetroAchievements.'
        : 'Jogo ou usuário não encontrado no RetroAchievements.',
      gameTitle,
      consoleName,
      achievements: null,
    };
  }

  const normalAwarded = Number(payload.NumAwardedToUser);
  const hardcoreAwarded = Number(payload.NumAwardedToUserHardcore);
  let unlocked = 0;

  if (Number.isFinite(normalAwarded) || Number.isFinite(hardcoreAwarded)) {
    unlocked = Math.max(
      0,
      Number.isFinite(normalAwarded) ? Math.floor(normalAwarded) : 0,
      Number.isFinite(hardcoreAwarded) ? Math.floor(hardcoreAwarded) : 0
    );
  } else if (achMapValues.length > 0) {
    unlocked = achMapValues.filter(
      (entry) => Boolean(entry?.DateEarned || entry?.DateEarnedHardcore)
    ).length;
  }

  return {
    ok: true,
    error: '',
    gameTitle,
    consoleName,
    achievements: normalizeAchievementsModel({
      source: 'retroachievements',
      unlocked,
      total,
      updated_at: nowIso,
    }),
  };
}

/**
 * Monta patch não-destrutivo de conquistas preservando integralmente notas, comentários,
 * avaliações, citações e demais metadados da obra.
 */
export function buildAchievementsSyncPatch(
  work = {},
  syncedAchievements = null,
  { steamAppId = '', retroachievementsGameId = '' } = {}
) {
  const normalized = normalizeAchievementsModel(syncedAchievements);
  if (!normalized) return null;

  const patch = {
    achievements: normalized,
  };

  const cleanSteamAppId = /^\d+$/.test(String(steamAppId || '').trim())
    ? Number(String(steamAppId).trim())
    : null;
  const cleanRaGameId = /^\d+$/.test(String(retroachievementsGameId || '').trim())
    ? Number(String(retroachievementsGameId).trim())
    : null;

  if (cleanSteamAppId || cleanRaGameId) {
    const existingIds =
      work?.ids && typeof work.ids === 'object' && !Array.isArray(work.ids)
        ? { ...work.ids }
        : {};
    if (cleanSteamAppId) existingIds.steam = cleanSteamAppId;
    if (cleanRaGameId) existingIds.retroachievements = cleanRaGameId;
    patch.ids = existingIds;
  }

  return patch;
}

/**
 * Sugestão de vínculo manual de franquia para Games (sem alterar nada automaticamente).
 */
export function suggestGameFranchiseLink(work = {}, allItems = []) {
  if (!work || typeof work !== 'object') {
    return {
      suggestedFranchiseName: '',
      relatedGames: [],
      isSuggestionOnly: true,
    };
  }

  const hint = extractGameFranchiseHintFromTitle(work.title || '');
  const normHint = normalizeGameKey(hint);
  const currentFranchise = String(work.franchiseName || '').trim();
  const normCurrent = normalizeGameKey(currentFranchise);

  const otherGames = (Array.isArray(allItems) ? allItems : []).filter(
    (entry) =>
      entry &&
      entry.inBacklog !== false &&
      String(entry.id) !== String(work.id) &&
      inferDomainFromWork(entry) === 'games'
  );

  let matchedExistingFranchise = '';
  const relatedGames = [];

  for (const cand of otherGames) {
    const candFranchise = String(cand.franchiseName || '').trim();
    const candFranchiseNorm = normalizeGameKey(candFranchise);
    const candHint = extractGameFranchiseHintFromTitle(cand.title || '');
    const candHintNorm = normalizeGameKey(candHint);

    const hitsByHint =
      Boolean(normHint) &&
      ((candHintNorm && candHintNorm === normHint) ||
        (candFranchiseNorm && candFranchiseNorm === normHint));

    const hitsByCurrent =
      Boolean(normCurrent) &&
      ((candFranchiseNorm && candFranchiseNorm === normCurrent) ||
        (candHintNorm && candHintNorm === normCurrent));

    if (hitsByHint || hitsByCurrent) {
      relatedGames.push(cand);
      if (!matchedExistingFranchise && candFranchise) {
        matchedExistingFranchise = candFranchise;
      }
    }
  }

  const suggestedFranchiseName =
    matchedExistingFranchise ||
    (relatedGames.length > 0 && hint ? hint : '') ||
    (!currentFranchise && hint && normalizeGameKey(work.title) !== normHint ? hint : '');

  return {
    suggestedFranchiseName,
    relatedGames,
    isSuggestionOnly: true,
  };
}

/**
 * Extrai campos de profundidade e edicao de um candidato de busca de Games para compor o rascunho.
 */
export function extractGameDepthDraftFields(candidate = {}) {
  if (!candidate || typeof candidate !== 'object') return {};
  const depth = {};
  const igdbId = Number(candidate.igdbId ?? candidate.ids?.igdb);
  if (Number.isFinite(igdbId) && igdbId > 0) depth.igdbId = Math.floor(igdbId);

  const rawgId = Number(candidate.rawgId ?? candidate.ids?.rawg);
  if (Number.isFinite(rawgId) && rawgId > 0) depth.rawgId = Math.floor(rawgId);

  if (Array.isArray(candidate.originalPlatforms) && candidate.originalPlatforms.length > 0) {
    depth.originalPlatforms = candidate.originalPlatforms;
  }
  if (candidate.editionType) {
    depth.editionType = normalizeGameEditionType(candidate.editionType);
  }
  if (Number(candidate.campaignTimeHours) > 0) {
    depth.campaignTimeHours = Math.round(Number(candidate.campaignTimeHours) * 10) / 10;
    depth.campaignTimeSource =
      String(candidate.campaignTimeSource || '').trim() || IGDB_CAMPAIGN_TIME_SOURCE_LABEL;
  }
  if (Number(candidate.rawgPlaytimeHours) > 0) {
    depth.rawgPlaytimeHours = Math.round(Number(candidate.rawgPlaytimeHours) * 10) / 10;
    depth.rawgPlaytimeSource =
      String(candidate.rawgPlaytimeSource || '').trim() || RAWG_CAMPAIGN_TIME_SOURCE_LABEL;
  }
  if (Number(candidate.completion100Hours) > 0) {
    depth.completion100Hours = Math.round(Number(candidate.completion100Hours) * 10) / 10;
    depth.completion100Source =
      String(candidate.completion100Source || '').trim() || IGDB_COMPLETION_100_SOURCE_LABEL;
  }
  if (candidate.parentGame) depth.parentGame = candidate.parentGame;
  if (candidate.versionParent) depth.versionParent = candidate.versionParent;
  if (candidate.franchiseName) depth.franchiseName = String(candidate.franchiseName).trim();
  return depth;
}
