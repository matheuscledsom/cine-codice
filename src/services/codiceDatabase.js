import {
  buildPublicProfileLink,
  domainConfig,
  inferDomainFromWork,
  normalizeCinemaStatus,
  normalizeGameEditionType,
  normalizeWorkTypeForDomain,
} from '../config/domainConfig.js';
import { normalizeAchievementsModel } from '../lib/gameDepth.js';
import { migrateFavoriteGenresToObjects } from '../lib/genreCatalog.js';
import { isCompressedManualCoverDataUrl } from '../lib/manualCovers.js';
import { applyCanonicalIdsToWork } from '../lib/idBridge.js';
import { classifyLegacyRatingSource, normalizeViewerFocusList } from '../lib/migrations.js';
import { createEmptyExternalRatings, normalizeExternalRatings } from '../lib/ratings.js';
import { safeSetLocalStorageJson } from '../lib/storagePersistence.js';
import {
  calculateSmartRating,
  calculateWorkProgress,
  getTodayLocalISO,
  getVerdictForScore,
  syncCinemaEpisodeFields,
} from '../utils/backlogHelpers.js';
import {
  normalizePreferredCriteria,
} from '../utils/readerPreferences.js';
import { normalizeReaderDna } from './dnaScoring.js';

export const CODICE_SCHEMA_VERSION = '1.1-cine-codice';
export const CODICE_DB_STORAGE_KEY = 'cine_codice_relational_db_v1';

export function createUuid() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function deterministicUuid(seedText) {
  const input = String(seedText || 'cine-codice');
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let h3 = 0x85ebca6b;
  let h4 = 0xc2b2ae35;

  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (code + i), 0x85ebca6b) >>> 0;
    h3 = Math.imul(h3 ^ (code * 31), 0xc2b2ae35) >>> 0;
    h4 = Math.imul(h4 ^ (code + 17), 0x27d4eb2f) >>> 0;
  }

  const hex = [h1, h2, h3, h4].map((n) => n.toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function normalizePersonName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function splitPeopleNames(rawValue) {
  const clean = String(rawValue || '').trim();
  if (!clean) return [];
  if (clean.includes(';')) {
    return clean.split(';').map((s) => s.trim()).filter(Boolean);
  }
  return clean.split(',').map((s) => s.trim()).filter(Boolean);
}

function normalizePrivacyLevel(value) {
  if (value === 'followers' || value === 'private' || value === 'public') {
    return value;
  }
  return 'private';
}

function buildDefaultUserProfile(profileData) {
  const { profile } = domainConfig.ui;
  const baseHandle = profileData?.handle || profile.handle;
  const publicLink = buildPublicProfileLink(baseHandle);
  const nowIso = profileData?.updatedAt || profileData?.createdAt || new Date().toISOString();

  const preferredCriteria = normalizePreferredCriteria(
    profileData?.preferredCriteria ?? profileData?.preferred_criteria,
    profileData?.preferredCriterion ?? profileData?.preferred_criterion
  );
  const viewerFocus = normalizeViewerFocusList(
    profileData?.viewerFocus ?? profileData?.viewer_focus,
    profileData?.readerFocus ?? profileData?.reader_focus
  );
  const favoriteGenres = migrateFavoriteGenresToObjects(
    profileData?.favoriteGenres ?? profileData?.favorite_genres
  );

  return {
    id: profileData?.id || deterministicUuid('user_profile:primary'),
    displayName: profileData?.displayName ?? profileData?.display_name ?? profile.displayName,
    handle: baseHandle,
    avatarInitials:
      profileData?.avatarInitials ?? profileData?.avatar_initials ?? profile.avatarInitials,
    avatarUrl: profileData?.avatarUrl ?? profileData?.avatar_url ?? '',
    coverUrl: profileData?.coverUrl ?? profileData?.banner_url ?? '',
    bio: profileData?.bio !== undefined ? profileData.bio : profile.bio,
    linkLabel: profileData?.linkLabel || publicLink.label,
    linkUrl: profileData?.linkUrl || publicLink.url,
    age: profileData?.age || '',
    viewerFocus,
    readerFocus: viewerFocus[0] || 'Cinéfilo Curador',
    annualGoal: Math.max(
      1,
      Number(profileData?.annualGoal ?? profileData?.annual_goal) || 24
    ),
    preferredFormat: profileData?.preferredFormat || 'Streaming',
    preferredCriteria,
    preferredCriterion: preferredCriteria.join(', '),
    preferredAtmosphere: profileData?.preferredAtmosphere || 'Tinta OLED',
    favoriteGenres,
    profileSchemaVersion: 3,
    readerDna: normalizeReaderDna(profileData?.readerDna ?? profileData?.reader_dna),
    privacyLevel: normalizePrivacyLevel(profileData?.privacyLevel ?? profileData?.privacy_level),
    allowWallPosts:
      (profileData?.allowWallPosts ?? profileData?.allow_wall_posts) !== undefined
        ? Boolean(profileData.allowWallPosts ?? profileData.allow_wall_posts)
        : true,
    allowComments:
      (profileData?.allowComments ?? profileData?.allow_comments) !== undefined
        ? Boolean(profileData.allowComments ?? profileData.allow_comments)
        : true,
    allowDms:
      (profileData?.allowDms ?? profileData?.allow_dms) !== undefined
        ? Boolean(profileData.allowDms ?? profileData.allow_dms)
        : true,
    gamificationEnabled:
      (profileData?.gamificationEnabled ?? profileData?.gamification_enabled) !== undefined
        ? Boolean(profileData.gamificationEnabled ?? profileData.gamification_enabled)
        : true,
    calmMode:
      profileData?.calmMode !== undefined
        ? Boolean(profileData.calmMode)
        : Boolean(profileData?.calm_mode),
    activeTitleBadge:
      typeof (profileData?.activeTitleBadge ?? profileData?.active_title_badge) === 'string'
        ? profileData.activeTitleBadge ?? profileData.active_title_badge
        : '',
    onboardingCompleted:
      profileData?.onboardingCompleted !== undefined
        ? Boolean(profileData.onboardingCompleted)
        : false,
    createdAt: profileData?.createdAt || nowIso,
    updatedAt: profileData?.updatedAt || nowIso,
  };
}

export function detectSchemaVersion(rawData) {
  if (!rawData) return 1;
  if (
    typeof rawData === 'object' &&
    !Array.isArray(rawData) &&
    rawData.tables &&
    typeof rawData.tables === 'object'
  ) {
    return 4;
  }
  if (
    typeof rawData === 'object' &&
    !Array.isArray(rawData) &&
    Array.isArray(rawData.items)
  ) {
    return 2;
  }
  return 1;
}

export function buildCodiceDatabase({
  items = [],
  profile = null,
  posts = [],
  streak = null,
  readingSessions = [],
  collections = [],
  episodeEvaluations = [],
  follows = [],
  wallPosts = [],
  directMessages = [],
} = {}) {
  const safeItems = Array.isArray(items) ? items : [];
  const safePosts = Array.isArray(posts) ? posts : [];
  const safeSessions = Array.isArray(readingSessions) ? readingSessions : [];
  const safeEpisodeEvaluations = (Array.isArray(episodeEvaluations) ? episodeEvaluations : [])
    .filter((e) => e && e.workId)
    .map((e) => ({
      evalKey: String(e.evalKey || `${e.workId}:${Math.max(1, Number(e.season) || 1)}:${Math.max(1, Number(e.episode) || 1)}`),
      workId: String(e.workId),
      source: e.source || null,
      season: Math.max(1, Math.round(Number(e.season) || 1)),
      episode: Math.max(1, Math.round(Number(e.episode) || 1)),
      rating:
        e.rating !== null && e.rating !== undefined && e.rating !== ''
          ? Math.max(0, Math.min(100, Math.round(Number(e.rating))))
          : null,
      tag: e.tag || null,
      reaction: String(e.reaction || '').slice(0, 280),
      updatedAt: e.updatedAt || Date.now(),
    }));
  const fallbackNow = new Date().toISOString();

  const authorsByNorm = new Map();
  const authors = [];
  const work_authors = [];
  const works = [];
  const reviews = [];
  const quotes_notes = [];
  const reading_sessions = [];

  const ensureCreator = (rawName, timestamp) => {
    const clean = String(rawName || '').trim();
    if (!clean) return null;
    const norm = normalizePersonName(clean);
    if (!norm) return null;
    if (authorsByNorm.has(norm)) return authorsByNorm.get(norm);
    const row = {
      id: deterministicUuid(`creator:${norm}`),
      name: clean,
      normalizedName: norm,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    authorsByNorm.set(norm, row);
    authors.push(row);
    return row;
  };

  safeItems.forEach((rawItem, idx) => {
    if (!rawItem || typeof rawItem !== 'object') return;
    const workId = String(
      rawItem.id || deterministicUuid(`work:${idx}:${rawItem.title || ''}`)
    );
    const createdAt = rawItem.createdAt || fallbackNow;
    const explicitUpdatedAt =
      rawItem._missingUpdatedAt === true
        ? null
        : rawItem.updatedAt || rawItem.updated_at || null;
    const updatedAt = explicitUpdatedAt || createdAt;
    const missingSourceUpdatedAt = !explicitUpdatedAt;
    const domain = inferDomainFromWork(rawItem);
    const workType = normalizeWorkTypeForDomain(rawItem.workType || rawItem.mediaType, domain);
    const status = normalizeCinemaStatus(rawItem.status);
    const isCompleted = status === 'completed';

    const durationMinutes =
      Number(rawItem.durationMinutes) > 0 ? Math.round(Number(rawItem.durationMinutes)) : null;
    const totalSeconds =
      Number(rawItem.totalSeconds) > 0
        ? Math.round(Number(rawItem.totalSeconds))
        : durationMinutes
          ? durationMinutes * 60
          : null;
    const currentSeconds =
      isCompleted && totalSeconds
        ? totalSeconds
        : Math.max(0, Math.round(Number(rawItem.currentSeconds) || 0));

    const epFields = syncCinemaEpisodeFields(rawItem, isCompleted);

    const resolvedRatingSource = classifyLegacyRatingSource(rawItem);
    const workWithIds = applyCanonicalIdsToWork(rawItem);
    const externalRatings = rawItem.externalRatings
      ? normalizeExternalRatings(rawItem.externalRatings)
      : createEmptyExternalRatings();

    const workRow = {
      id: workId,
      domain,
      title: String(rawItem.title || 'Obra sem título'),
      originalTitle: String(rawItem.originalTitle || '').trim(),
      workType,
      mediaType: workType,
      status,
      creator: String(rawItem.creator || rawItem.director || rawItem.studio || rawItem.author || '').trim(),
      director: String(rawItem.director || rawItem.creator || rawItem.studio || rawItem.author || '').trim(),
      // Leitura & Acadêmico
      pagesRead: Math.max(0, Math.round(Number(rawItem.pagesRead) || 0)),
      totalPages: Number(rawItem.totalPages) > 0 ? Math.round(Number(rawItem.totalPages)) : null,
      chaptersRead: Math.max(0, Math.round(Number(rawItem.chaptersRead) || 0)),
      isbnOrDoi: String(rawItem.isbnOrDoi || rawItem.isbn || rawItem.doi || '').trim(),
      bookFormat: String(rawItem.bookFormat || '').trim(),
      seriesVolume: String(rawItem.seriesVolume || '').trim(),
      workUrl: /^https?:\/\//i.test(String(rawItem.workUrl || '').trim())
        ? String(rawItem.workUrl).trim()
        : '',
      isManual: Boolean(rawItem.isManual || rawItem.ids?.source === 'manual'),
      manualCoverDataUrl: isCompressedManualCoverDataUrl(rawItem.manualCoverDataUrl)
        ? rawItem.manualCoverDataUrl
        : isCompressedManualCoverDataUrl(rawItem.coverUrl) &&
            (rawItem.isManual || rawItem.ids?.source === 'manual')
          ? rawItem.coverUrl
          : '',
      // Games
      platform: String(rawItem.platform || '').trim(),
      platforms: Array.isArray(rawItem.platforms)
        ? Array.from(new Set(rawItem.platforms.map((p) => String(p || '').trim()).filter(Boolean)))
        : [],
      originalPlatforms: Array.isArray(rawItem.originalPlatforms)
        ? Array.from(
            new Set(rawItem.originalPlatforms.map((p) => String(p || '').trim()).filter(Boolean))
          )
        : [],
      editionType:
        domain === 'games'
          ? normalizeGameEditionType(rawItem.editionType)
          : String(rawItem.editionType || '').trim(),
      gameRating11:
        rawItem.gameRating11 !== null &&
        rawItem.gameRating11 !== undefined &&
        rawItem.gameRating11 !== '' &&
        Number.isFinite(Number(rawItem.gameRating11))
          ? Math.max(0, Math.min(11, Math.round(Number(rawItem.gameRating11) * 10) / 10))
          : null,
      lifeWork: Boolean(rawItem.lifeWork || Number(rawItem.gameRating11) >= 11),
      ratingManualOverride: Boolean(rawItem.ratingManualOverride),
      reviewCriteria5:
        rawItem.reviewCriteria5 && typeof rawItem.reviewCriteria5 === 'object'
          ? rawItem.reviewCriteria5
          : null,
      franchiseTier: ['mainline', 'spinoff', 'companion', 'unclassified'].includes(
        String(rawItem.franchiseTier || '').trim().toLowerCase()
      )
        ? String(rawItem.franchiseTier).trim().toLowerCase()
        : '',
      editionOf: (() => {
        const clean = String(rawItem.editionOf ?? rawItem.progress_data?.editionOf ?? '').trim();
        return clean && clean !== String(rawItem.id || '') ? clean : null;
      })(),
      releasedEpisodesCount:
        Number(rawItem.releasedEpisodesCount) > 0
          ? Math.floor(Number(rawItem.releasedEpisodesCount))
          : null,
      releasedEpisodesSource: String(rawItem.releasedEpisodesSource || '').trim() || null,
      releasedEpisodesFetchedAt: rawItem.releasedEpisodesFetchedAt || null,
      masterpieceJustification: String(rawItem.masterpieceJustification || '').trim().slice(0, 400),
      hoursPlayed: Math.max(0, Number(rawItem.hoursPlayed) || 0),
      completionType: String(rawItem.completionType || '').trim(),
      storeOrLauncher: String(rawItem.storeOrLauncher || '').trim(),
      buildOrCharacter: String(rawItem.buildOrCharacter || '').trim(),
      igdbId:
        Number(rawItem.igdbId ?? rawItem.ids?.igdb) > 0
          ? Math.floor(Number(rawItem.igdbId ?? rawItem.ids?.igdb))
          : null,
      rawgId:
        Number(rawItem.rawgId ?? rawItem.ids?.rawg) > 0
          ? Math.floor(Number(rawItem.rawgId ?? rawItem.ids?.rawg))
          : null,
      campaignTimeHours:
        Number(rawItem.campaignTimeHours) > 0
          ? Math.round(Number(rawItem.campaignTimeHours) * 10) / 10
          : null,
      campaignTimeSource: String(rawItem.campaignTimeSource || '').trim() || null,
      rawgPlaytimeHours:
        Number(rawItem.rawgPlaytimeHours) > 0
          ? Math.round(Number(rawItem.rawgPlaytimeHours) * 10) / 10
          : null,
      rawgPlaytimeSource: String(rawItem.rawgPlaytimeSource || '').trim() || null,
      manualCampaignHours:
        Number(rawItem.manualCampaignHours) > 0
          ? Math.round(Number(rawItem.manualCampaignHours) * 10) / 10
          : null,
      completion100Hours:
        Number(rawItem.completion100Hours) > 0
          ? Math.round(Number(rawItem.completion100Hours) * 10) / 10
          : null,
      completion100Source: String(rawItem.completion100Source || '').trim() || null,
      parentGame: rawItem.parentGame ?? null,
      versionParent: rawItem.versionParent ?? null,
      achievements: normalizeAchievementsModel(rawItem.achievements),
      // Música
      albumName: String(rawItem.albumName || '').trim(),
      excludeFromDiscography: Boolean(
        rawItem.excludeFromDiscography ?? rawItem.progress_data?.excludeFromDiscography
      ),
      subgenres: Array.isArray(rawItem.subgenres)
        ? rawItem.subgenres.map((s) => String(s || '').trim()).filter(Boolean)
        : [],
      durationMs: Number(rawItem.durationMs) > 0 ? Math.round(Number(rawItem.durationMs)) : null,
      trackRating10:
        rawItem.trackRating10 !== null &&
        rawItem.trackRating10 !== undefined &&
        rawItem.trackRating10 !== '' &&
        Number.isFinite(Number(rawItem.trackRating10))
          ? Math.max(0, Math.min(10, Math.round(Number(rawItem.trackRating10) * 10) / 10))
          : null,
      favoriteTrack: String(rawItem.favoriteTrack || '').trim(),
      subgenre: String(rawItem.subgenre || '').trim(),
      releaseFormat: String(rawItem.releaseFormat || '').trim(),
      listenCount: Math.max(0, Math.round(Number(rawItem.listenCount) || 0)),
      tracks: Array.isArray(rawItem.tracks) ? rawItem.tracks : [],
      trackRatings:
        rawItem.trackRatings &&
        typeof rawItem.trackRatings === 'object' &&
        !Array.isArray(rawItem.trackRatings)
          ? rawItem.trackRatings
          : {},
      trackCount: Number(rawItem.trackCount) || null,
      studio: String(rawItem.studio || '').trim(),
      cast: String(rawItem.cast || '').trim(),
      releaseYear: rawItem.releaseYear ?? rawItem.publicationYear ?? null,
      language: String(rawItem.language || '').trim(),
      format: rawItem.format || domainConfig.mediaFormats[0],
      audioFormat: rawItem.audioFormat || domainConfig.audioFormatTags[0],
      animeFormat: rawItem.animeFormat || '',
      durationMinutes,
      totalSeconds,
      currentSeconds,
      episodeDurationMinutes:
        Number(rawItem.episodeDurationMinutes) > 0
          ? Math.round(Number(rawItem.episodeDurationMinutes))
          : workType === 'anime'
            ? 24
            : workType === 'series'
              ? 45
              : null,
      ...epFields,
      rewatchCount: Math.max(0, Math.round(Number(rawItem.rewatchCount) || 0)),
      franchiseName: String(rawItem.franchiseName || rawItem.seriesName || '').trim(),
      franchiseRelations: Array.isArray(rawItem.franchiseRelations)
        ? rawItem.franchiseRelations
        : [],
      franchiseLinks: Array.isArray(rawItem.franchiseLinks)
        ? rawItem.franchiseLinks
        : [],
      chronologicalOrder: Number(rawItem.chronologicalOrder) || null,
      ids: workWithIds.ids,
      anilistId: workWithIds.anilistId || null,
      malId: workWithIds.malId || null,
      tvmazeId: workWithIds.tvmazeId || null,
      tmdbId: workWithIds.tmdbId || null,
      tmdbMediaType: rawItem.tmdbMediaType || null,
      imdbId: workWithIds.imdbId || '',
      belongsToCollection: rawItem.belongsToCollection || null,
      tmdbStatus: rawItem.tmdbStatus || null,
      backdropUrl: rawItem.backdropUrl || null,
      backdropCheckedAt: Number(rawItem.backdropCheckedAt) || null,
      favoriteScene: String(rawItem.favoriteScene || '').trim().slice(0, 200),
      favoriteRank:
        Number.isInteger(Number(rawItem.favoriteRank)) &&
        Number(rawItem.favoriteRank) >= 1 &&
        Number(rawItem.favoriteRank) <= 4
          ? Number(rawItem.favoriteRank)
          : null,
      externalRatings,
      ratingSource: resolvedRatingSource,
      sourceBadge: String(rawItem.sourceBadge || '').trim(),
      mergedSources: Array.isArray(rawItem.mergedSources) ? rawItem.mergedSources : [],
      openAccessUrl: String(rawItem.openAccessUrl || '').trim(),
      synopsis: String(rawItem.synopsis ?? rawItem.overview ?? '').trim(),
      overview: String(rawItem.overview ?? rawItem.synopsis ?? '').trim(),
      genres: Array.isArray(rawItem.genres) ? rawItem.genres : [],
      primaryGenre: String(rawItem.primaryGenre || '').trim(),
      subgenres: Array.isArray(rawItem.subgenres) ? rawItem.subgenres : [],
      atmosphere: Array.isArray(rawItem.atmosphere)
        ? rawItem.atmosphere
        : Array.isArray(rawItem.moods)
          ? rawItem.moods
          : [],
      moods: Array.isArray(rawItem.moods)
        ? rawItem.moods
        : Array.isArray(rawItem.atmosphere)
          ? rawItem.atmosphere
          : [],
      tropes: Array.isArray(rawItem.tropes) ? rawItem.tropes : [],
      progress: calculateWorkProgress({
        ...rawItem,
        workType,
        status,
        totalSeconds,
        currentSeconds,
        ...epFields,
      }),
      hype: rawItem.hype || null,
      checkpoint: String(rawItem.checkpoint || '').trim(),
      isPlatinum: Boolean(rawItem.isPlatinum),
      isFavorite: Boolean(rawItem.isFavorite),
      isWishlist: Boolean(rawItem.isWishlist),
      inBacklog: rawItem.inBacklog !== undefined ? Boolean(rawItem.inBacklog) : true,
      dropReason: rawItem.dropReason || null,
      startDate: rawItem.startDate || null,
      completedDate: rawItem.completedDate || null,
      completedYear:
        status === 'completed'
          ? Number(rawItem.completedDate?.slice(0, 4)) ||
            rawItem.completedYear ||
            domainConfig.currentYear
          : null,
      dropDate: rawItem.dropDate || null,
      coverUrl: rawItem.coverUrl || null,
      backdropUrl: rawItem.backdropUrl || null,
      coverSources: Array.isArray(rawItem.coverSources)
        ? rawItem.coverSources.filter(Boolean)
        : rawItem.coverUrl
          ? [rawItem.coverUrl]
          : [],
      monogram: rawItem.monogram || '',
      tags: Array.isArray(rawItem.tags) ? rawItem.tags.map(String).filter(Boolean) : [],
      collectionIds: Array.isArray(rawItem.collectionIds)
        ? Array.from(new Set(rawItem.collectionIds.map(String).filter(Boolean)))
        : [],
      createdAt,
      updatedAt,
      updated_at: explicitUpdatedAt || null,
      ...(missingSourceUpdatedAt ? { _missingUpdatedAt: true } : {}),
    };

    works.push(workRow);

    splitPeopleNames(workRow.director).forEach((personName, position) => {
      const creatorRow = ensureCreator(personName, createdAt);
      if (!creatorRow) return;
      work_authors.push({
        id: deterministicUuid(`wc:${workId}:${creatorRow.id}:diretor`),
        workId,
        authorId: creatorRow.id,
        role: 'diretor',
        position,
        createdAt,
        updatedAt,
      });
    });

    const hasReviewData =
      (rawItem.rating !== null && rawItem.rating !== undefined) ||
      Boolean(rawItem.reviewCriteria) ||
      Boolean(rawItem.verdict) ||
      Boolean(rawItem.notes) ||
      rawItem.recommended !== undefined;

    if (hasReviewData) {
      const computedRating =
        rawItem.reviewCriteria && (rawItem.rating === null || rawItem.rating === undefined)
          ? calculateSmartRating(rawItem.reviewCriteria)
          : rawItem.rating !== null && rawItem.rating !== undefined
            ? Number(rawItem.rating)
            : null;
      const cleanRating =
        computedRating !== null && !Number.isNaN(computedRating)
          ? Math.max(0, Math.min(100, Math.round(computedRating)))
          : null;

      reviews.push({
        id: deterministicUuid(`review:${workId}`),
        workId,
        rating: cleanRating,
        ratingSource: resolvedRatingSource,
        verdict: rawItem.verdict || getVerdictForScore(cleanRating),
        recommended:
          rawItem.recommended !== undefined
            ? Boolean(rawItem.recommended)
            : Boolean(
                rawItem.isPlatinum ||
                  (cleanRating !== null &&
                    resolvedRatingSource !== 'legacy-default' &&
                    cleanRating >= 80)
              ),
        reviewCriteria: rawItem.reviewCriteria || null,
        notes: String(rawItem.notes || ''),
        createdAt,
        updatedAt,
      });
    }

    if (Array.isArray(rawItem.quotes)) {
      rawItem.quotes.forEach((quote, qIdx) => {
        if (!quote || typeof quote !== 'object' || !quote.text) return;
        const qCreated = quote.createdAt || createdAt;
        quotes_notes.push({
          id: String(quote.id || deterministicUuid(`quote:${workId}:${qIdx}:${quote.text}`)),
          workId,
          text: String(quote.text),
          location: String(quote.location || ''),
          note: String(quote.note || ''),
          createdAt: qCreated,
          updatedAt: quote.updatedAt || qCreated,
        });
      });
    }
  });

  safeSessions.forEach((session, sIdx) => {
    if (!session || typeof session !== 'object') return;
    reading_sessions.push({
      id: String(session.id || deterministicUuid(`session:${sIdx}:${session.workId || ''}`)),
      workId: String(session.workId || ''),
      startedAt: session.startedAt || fallbackNow,
      endedAt: session.endedAt || fallbackNow,
      durationSeconds: Math.max(0, Number(session.durationSeconds) || 0),
      minutesWatched: Math.max(
        0,
        Number(session.minutesWatched) || Math.round((Number(session.durationSeconds) || 0) / 60)
      ),
      episodesWatched: Math.max(0, Number(session.episodesWatched) || 0),
      notes: String(session.notes || ''),
      createdAt: session.createdAt || session.startedAt || fallbackNow,
      updatedAt: session.updatedAt || session.endedAt || fallbackNow,
    });
  });

  const journal_entries = safePosts
    .filter((post) => post && typeof post === 'object')
    .map((post, pIdx) => {
      const createdAt = post.createdAt || fallbackNow;
      return {
        id: String(post.id || deterministicUuid(`post:${pIdx}:${post.title || ''}`)),
        workId: post.workId ?? post.itemId ?? null,
        itemTitle: String(post.itemTitle || ''),
        itemSnapshot: post.itemSnapshot || null,
        progressMarker: String(post.progressMarker || ''),
        title: String(post.title || ''),
        caption: String(post.caption || ''),
        media: Array.isArray(post.media) ? post.media : [],
        comments: Array.isArray(post.comments) ? post.comments : [],
        visibility: post.visibility || 'inherit',
        createdAt,
        updatedAt: post.updatedAt || createdAt,
      };
    });

  return {
    schemaVersion: CODICE_SCHEMA_VERSION,
    schemaNumericVersion: 4,
    domain: domainConfig.domainKey,
    exportedAt: fallbackNow,
    tables: {
      works,
      authors,
      work_authors,
      reading_sessions,
      reviews,
      quotes_notes,
      journal_entries,
      episode_evaluations: safeEpisodeEvaluations,
      user_profile: buildDefaultUserProfile(profile),
      follows: Array.isArray(follows) ? follows : [],
      wall_posts: Array.isArray(wallPosts) ? wallPosts : [],
      direct_messages: Array.isArray(directMessages) ? directMessages : [],
    },
    metadata: {
      streak: streak || { count: 0, lastDate: null, history: [], dailyLogs: {} },
      collections: Array.isArray(collections) ? collections : [],
    },
  };
}

export function migrateDatabase(rawData) {
  if (!rawData || typeof rawData !== 'object') {
    return buildCodiceDatabase({});
  }

  if (rawData.tables && typeof rawData.tables === 'object') {
    const t = rawData.tables;
    const rawWorks = Array.isArray(t.works) ? t.works : [];
    const authorMap = new Map(
      (Array.isArray(t.authors) ? t.authors : []).map((a) => [a.id, a.name])
    );
    const linksByWork = new Map();
    (Array.isArray(t.work_authors) ? t.work_authors : []).forEach((link) => {
      if (!linksByWork.has(link.workId)) linksByWork.set(link.workId, []);
      linksByWork.get(link.workId).push(link);
    });
    const reviewByWork = new Map(
      (Array.isArray(t.reviews) ? t.reviews : []).map((r) => [r.workId, r])
    );
    const quotesByWork = new Map();
    (Array.isArray(t.quotes_notes) ? t.quotes_notes : []).forEach((q) => {
      if (!quotesByWork.has(q.workId)) quotesByWork.set(q.workId, []);
      quotesByWork.get(q.workId).push(q);
    });

    const reconstructedItems = rawWorks.map((w) => {
      const review = reviewByWork.get(w.id) || null;
      const linkedCreators = (linksByWork.get(w.id) || [])
        .map((l) => authorMap.get(l.authorId))
        .filter(Boolean)
        .join(', ');
      return applyCanonicalIdsToWork({
        ...w,
        director: w.director || linkedCreators || '',
        rating: review ? review.rating : w.rating ?? null,
        ratingSource:
          (review && review.ratingSource) ||
          w.ratingSource ||
          classifyLegacyRatingSource({
            ...w,
            rating: review ? review.rating : w.rating ?? null,
            reviewCriteria: review ? review.reviewCriteria : w.reviewCriteria ?? null,
            notes: review ? review.notes : w.notes || '',
          }),
        verdict: review ? review.verdict : w.verdict ?? null,
        recommended: review ? Boolean(review.recommended) : Boolean(w.recommended),
        reviewCriteria: review ? review.reviewCriteria : w.reviewCriteria ?? null,
        notes: review ? review.notes : w.notes || '',
        quotes: quotesByWork.get(w.id) || w.quotes || [],
      });
    });

    const resolvedProfile = Array.isArray(t.user_profile)
      ? t.user_profile[0] || null
      : t.user_profile || null;

    return buildCodiceDatabase({
      items: reconstructedItems,
      profile: resolvedProfile,
      posts: Array.isArray(t.journal_entries) ? t.journal_entries : [],
      streak: rawData.metadata?.streak || null,
      readingSessions: Array.isArray(t.reading_sessions) ? t.reading_sessions : [],
      collections: Array.isArray(rawData.metadata?.collections)
        ? rawData.metadata.collections
        : [],
      episodeEvaluations: Array.isArray(t.episode_evaluations)
        ? t.episode_evaluations
        : [],
      follows: Array.isArray(t.follows) ? t.follows : [],
      wallPosts: Array.isArray(t.wall_posts) ? t.wall_posts : [],
      directMessages: Array.isArray(t.direct_messages) ? t.direct_messages : [],
    });
  }

  const rawItems = Array.isArray(rawData)
    ? rawData
    : Array.isArray(rawData.items)
      ? rawData.items
      : [];

  return buildCodiceDatabase({
    items: rawItems,
    profile: rawData.profile || null,
    posts: Array.isArray(rawData.posts) ? rawData.posts : [],
    streak: rawData.streak || null,
    readingSessions: Array.isArray(rawData.readingSessions) ? rawData.readingSessions : [],
    collections: Array.isArray(rawData.collections) ? rawData.collections : [],
    episodeEvaluations: Array.isArray(rawData.episodeEvaluations)
      ? rawData.episodeEvaluations
      : [],
  });
}

export function validateReferentialIntegrity(db) {
  const tables = db?.tables || {};
  const workIds = new Set((tables.works || []).map((w) => w.id));
  const authorIds = new Set((tables.authors || []).map((a) => a.id));
  const orphans = [];

  (tables.work_authors || []).forEach((link) => {
    if (!workIds.has(link.workId)) {
      orphans.push({ table: 'work_authors', recordId: link.id, foreignKey: 'workId', missingId: link.workId });
    }
    if (!authorIds.has(link.authorId)) {
      orphans.push({ table: 'work_authors', recordId: link.id, foreignKey: 'authorId', missingId: link.authorId });
    }
  });

  ['reading_sessions', 'reviews', 'quotes_notes'].forEach((tbl) => {
    (tables[tbl] || []).forEach((rec) => {
      if (rec.workId && !workIds.has(rec.workId)) {
        orphans.push({ table: tbl, recordId: rec.id, foreignKey: 'workId', missingId: rec.workId });
      }
    });
  });

  return { valid: orphans.length === 0, orphanCount: orphans.length, orphans };
}

export function hydrateAppSnapshotFromDatabase(db) {
  const normalized = migrateDatabase(db);
  const {
    works,
    authors,
    work_authors,
    reading_sessions,
    reviews,
    quotes_notes,
    journal_entries,
    episode_evaluations,
    user_profile,
    follows,
    wall_posts,
    direct_messages,
  } = normalized.tables;

  const authorMap = new Map(authors.map((a) => [a.id, a]));
  const linksByWork = new Map();
  work_authors.forEach((link) => {
    if (!linksByWork.has(link.workId)) linksByWork.set(link.workId, []);
    linksByWork.get(link.workId).push(link);
  });
  const reviewByWork = new Map(reviews.map((r) => [r.workId, r]));
  const quotesByWork = new Map();
  quotes_notes.forEach((q) => {
    if (!quotesByWork.has(q.workId)) quotesByWork.set(q.workId, []);
    quotesByWork.get(q.workId).push(q);
  });

  const items = works.map((work) => {
    const links = (linksByWork.get(work.id) || []).slice().sort((a, b) => a.position - b.position);
    const directorNames = links
      .map((l) => authorMap.get(l.authorId)?.name)
      .filter(Boolean)
      .join(', ');
    const review = reviewByWork.get(work.id) || null;
    const workQuotes = quotesByWork.get(work.id) || [];

    const rating = review ? review.rating : null;
    const ratingSource =
      (review && review.ratingSource) ||
      work.ratingSource ||
      classifyLegacyRatingSource({
        ...work,
        rating,
        reviewCriteria: review ? review.reviewCriteria : null,
        notes: review ? review.notes : '',
      });

    const manualCover = isCompressedManualCoverDataUrl(work.manualCoverDataUrl)
      ? work.manualCoverDataUrl
      : '';

    return applyCanonicalIdsToWork({
      ...work,
      updated_at: work._missingUpdatedAt ? null : work.updated_at || work.updatedAt || null,
      ...(work._missingUpdatedAt ? { _missingUpdatedAt: true } : {}),
      coverUrl: work.coverUrl || manualCover || null,
      manualCoverDataUrl: manualCover,
      director: work.director || directorNames || '',
      rating,
      ratingSource,
      verdict: review ? review.verdict : null,
      recommended: review ? Boolean(review.recommended) : false,
      reviewCriteria: review ? review.reviewCriteria : null,
      notes: review ? review.notes : '',
      quotes: workQuotes,
    });
  });

  const posts = journal_entries.map((entry) => ({
    ...entry,
    itemId: entry.workId || null,
  }));

  return {
    items,
    profile: user_profile,
    posts,
    streak: normalized.metadata?.streak || { count: 0, lastDate: null, history: [], dailyLogs: {} },
    collections: Array.isArray(normalized.metadata?.collections)
      ? normalized.metadata.collections
      : [],
    readingSessions: reading_sessions,
    episodeEvaluations: Array.isArray(episode_evaluations) ? episode_evaluations : [],
    follows: follows || [],
    wallPosts: wall_posts || [],
    directMessages: direct_messages || [],
  };
}

export function persistCodiceDatabase(db) {
  return safeSetLocalStorageJson(CODICE_DB_STORAGE_KEY, db, {
    label: 'banco relacional',
  });
}

export function loadStoredCodiceDatabase() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CODICE_DB_STORAGE_KEY);
    if (!raw) return null;
    return migrateDatabase(JSON.parse(raw));
  } catch {
    return null;
  }
}

function escapeCsvCell(value) {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateCatalogCsv(db) {
  const { items } = hydrateAppSnapshotFromDatabase(db);
  const headers = [
    'ID',
    'Título',
    'Título Original',
    'Tipo',
    'Status',
    'Direção / Estúdio',
    'Ano',
    'Mídia',
    'Áudio / Legenda',
    'Duração (min)',
    'Minutagem Atual (s)',
    'Duração Total (s)',
    'Temporada Atual',
    'Total Temporadas',
    'Episódio Atual',
    'Total Episódios',
    'Rewatches',
    'Progresso (%)',
    'Nota',
    'Veredito',
    'Franquia / Saga',
    'Gêneros',
    'Tags',
    'Fonte',
  ];

  const rows = items.map((item) => [
    item.id,
    item.title,
    item.originalTitle || '',
    item.workType,
    item.status,
    item.director || item.studio || '',
    item.releaseYear ?? '',
    item.format || '',
    item.audioFormat || '',
    item.durationMinutes ?? '',
    item.currentSeconds ?? 0,
    item.totalSeconds ?? '',
    item.currentSeason ?? 1,
    item.totalSeasons ?? 1,
    item.currentEpisode ?? 0,
    item.totalEpisodes ?? '',
    item.rewatchCount ?? 0,
    item.progress ?? 0,
    item.rating ?? '',
    item.verdict ?? '',
    item.franchiseName || '',
    Array.isArray(item.genres) ? item.genres.join('; ') : '',
    Array.isArray(item.tags) ? item.tags.join('; ') : '',
    item.sourceBadge || '',
  ]);

  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ];

  return `\uFEFF${lines.join('\r\n')}`;
}

export function generateCatalogMarkdown(db) {
  const { items } = hydrateAppSnapshotFromDatabase(db);
  const lines = ['# OmniPrism — Catálogo Pessoal', ''];
  items.forEach((item) => {
    const itemDomain = inferDomainFromWork(item);
    const typeLabel =
      itemDomain === 'games'
        ? normalizeGameEditionType(item.editionType)
        : itemDomain === 'reading'
          ? item.workType === 'manga'
            ? 'Mangá'
            : item.workType === 'academic'
              ? 'Artigo'
              : 'Livro'
          : itemDomain === 'music'
            ? item.workType === 'track'
              ? 'Faixa'
              : 'Álbum'
            : item.workType === 'anime'
              ? 'Anime'
              : item.workType === 'series'
                ? 'Série'
                : 'Filme';
    const meta = [
      typeLabel,
      item.releaseYear || null,
      item.director || item.studio || null,
      typeof item.rating === 'number' ? `Nota ${item.rating}/100` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push(`- **${item.title}** (${meta}) — *${item.status}* (${item.progress || 0}%)`);
  });
  lines.push('');
  return lines.join('\n');
}

export function triggerFileDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function parseAndValidateBackupText(rawText) {
  try {
    const parsed = JSON.parse(rawText);
    const detected = detectSchemaVersion(parsed);
    if (
      detected === 1 &&
      !Array.isArray(parsed) &&
      !Array.isArray(parsed?.items)
    ) {
      return { ok: false, error: domainConfig.ui.profile.backup.importError };
    }

    const db = migrateDatabase(parsed);
    const integrity = validateReferentialIntegrity(db);
    const snapshot = hydrateAppSnapshotFromDatabase(db);

    return {
      ok: true,
      detectedSchemaVersion: detected,
      db,
      integrity,
      count: snapshot.items.length,
      ...snapshot,
    };
  } catch {
    return { ok: false, error: domainConfig.ui.profile.backup.importError };
  }
}

export function exportDatabaseDownloads(db) {
  const stamp = getTodayLocalISO();
  return {
    json: () =>
      triggerFileDownload(
        JSON.stringify(db, null, 2),
        `cine-codice-backup-${stamp}.json`,
        'application/json;charset=utf-8'
      ),
    csv: () =>
      triggerFileDownload(
        generateCatalogCsv(db),
        `cine-codice-catalogo-${stamp}.csv`,
        'text/csv;charset=utf-8'
      ),
    md: () =>
      triggerFileDownload(
        generateCatalogMarkdown(db),
        `cine-codice-catalogo-${stamp}.md`,
        'text/markdown;charset=utf-8'
      ),
  };
}
