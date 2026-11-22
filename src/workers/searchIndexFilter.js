const HYPE_WEIGHT_MAP = {
  urgent: 4,
  'very-high': 3,
  high: 2,
  medium: 1,
  low: 0,
};

export function filterAndSortItemsSync(items = [], params = {}) {
  const {
    selectedStatus = 'all',
    selectedWorkType = 'all',
    selectedCollectionId = 'all',
    selectedGenre = 'all',
    selectedFormat = 'all',
    selectedAudioFormat = 'all',
    query = '',
    sortBy = 'recent',
    creatorField = 'director',
    ratingField = 'rating',
  } = params;

  const q = String(query || '').trim().toLowerCase();

  const filtered = (Array.isArray(items) ? items : []).filter((item) => {
    if (!item || item.inBacklog === false) return false;
    if (selectedStatus !== 'all' && item.status !== selectedStatus) return false;
    if (selectedWorkType !== 'all' && (item.workType || 'movie') !== selectedWorkType) {
      return false;
    }
    if (selectedCollectionId !== 'all') {
      const cols = Array.isArray(item.collectionIds) ? item.collectionIds.map(String) : [];
      if (!cols.includes(String(selectedCollectionId))) return false;
    }
    if (selectedGenre !== 'all') {
      const genres = Array.isArray(item.genres) ? item.genres : [];
      if (!genres.some((g) => String(g || '').trim() === selectedGenre)) return false;
    }
    if (selectedFormat !== 'all' && String(item.format || '').trim() !== selectedFormat) {
      return false;
    }
    if (
      selectedAudioFormat !== 'all' &&
      String(item.audioFormat || '').trim() !== selectedAudioFormat
    ) {
      return false;
    }
    if (!q) return true;

    const inTitle = String(item.title || '').toLowerCase().includes(q);
    const inOrig = String(item.originalTitle || '').toLowerCase().includes(q);
    const inCreator = String(item[creatorField] || item.director || item.author || '')
      .toLowerCase()
      .includes(q);
    const inStudio = String(item.studio || '').toLowerCase().includes(q);
    const inImdb = String(item.imdbId || '').toLowerCase().includes(q);
    const inFranchise = String(item.franchise || '').toLowerCase().includes(q);
    const inGenres = Array.isArray(item.genres)
      ? item.genres.some((g) => String(g).toLowerCase().includes(q))
      : false;
    const inTags = Array.isArray(item.tags)
      ? item.tags.some((t) => String(t).toLowerCase().includes(q))
      : false;
    return (
      inTitle ||
      inOrig ||
      inCreator ||
      inStudio ||
      inImdb ||
      inFranchise ||
      inGenres ||
      inTags
    );
  });

  return [...filtered].sort((a, b) => {
    if (sortBy === 'rating') {
      const rA = typeof a[ratingField] === 'number' ? a[ratingField] : -1;
      const rB = typeof b[ratingField] === 'number' ? b[ratingField] : -1;
      return rB - rA;
    }
    if (sortBy === 'hype') {
      return (HYPE_WEIGHT_MAP[b.hype] ?? 0) - (HYPE_WEIGHT_MAP[a.hype] ?? 0);
    }
    if (sortBy === 'runtime' || sortBy === 'pages') {
      const mA =
        Number(a.durationMinutes) ||
        Math.round((Number(a.totalSeconds) || 0) / 60) ||
        Number(a.totalEpisodes) * 24 ||
        0;
      const mB =
        Number(b.durationMinutes) ||
        Math.round((Number(b.totalSeconds) || 0) / 60) ||
        Number(b.totalEpisodes) * 24 ||
        0;
      return mB - mA;
    }
    if (sortBy === 'title') {
      return String(a.title || '').localeCompare(String(b.title || ''), 'pt-BR');
    }
    const timeA = Date.parse(a.updatedAt || a.createdAt || '') || 0;
    const timeB = Date.parse(b.updatedAt || b.createdAt || '') || 0;
    return timeB - timeA;
  });
}
