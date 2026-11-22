export const DNA_DIMENSIONS = [
  {
    id: 'screenplayPace',
    label: 'Roteiro & Ritmo',
    description: 'Estrutura narrativa, diálogos, cadência de montagem e fluidez.',
    keywords: /drama|thriller|suspense|comedia|dialogo|ritmo|misterio|crime|roteiro/,
  },
  {
    id: 'directionVisuals',
    label: 'Direção & Fotografia/Animação',
    description: 'Enquadramento, direção de arte, sakuga, luz e linguagem visual.',
    keywords: /animacao|anime|fotografia|noir|epico|mecha|visual|sakuga|arte|cinema/,
  },
  {
    id: 'charactersActing',
    label: 'Personagens & Atuação/Dublagem',
    description: 'Carisma de elenco, arcos dramáticos, química e dublagem.',
    keywords: /drama|biografia|romance|slice of life|psicolog|josei|elenco|personagens/,
  },
  {
    id: 'soundtrackSound',
    label: 'Trilha Sonora & Som',
    description: 'Composição musical, desenho de som, abertura e silêncios.',
    keywords: /musical|musica|epico|terror|cyberpunk|anime|suspense|som/,
  },
  {
    id: 'worldbuildingAtmosphere',
    label: 'Worldbuilding & Atmosfera',
    description: 'Imersão sensorial, construção de universo, época e ambientação.',
    keywords: /fantasia|ficcao cientifica|sci-fi|distopia|isekai|cyberpunk|historico|sombrio|gotico/,
  },
  {
    id: 'tensionTwists',
    label: 'Tensão & Reviravoltas',
    description: 'Suspense, mistério investigativo, ritmo de clímax e viradas.',
    keywords: /suspense|misterio|thriller|terror|horror|policial|crime|investigacao/,
  },
  {
    id: 'originality',
    label: 'Originalidade',
    description: 'Inovação formal, subversão de clichês e proposta autoral única.',
    keywords: /experimental|vanguarda|independente|psicodel|surreal|seinen|autoral|cult/,
  },
  {
    id: 'impactRewatch',
    label: 'Impacto & Reassistibilidade',
    description: 'Ressignificação ao longo do tempo, finais marcantes e vontade de rever.',
    keywords: /classico|obra prima|epico|aventura|comedia|found family|nostalgico|shonen/,
  },
];

export const DNA_PACING_OPTIONS = [
  { id: 'equilibrado', label: 'Equilibrado' },
  { id: 'fluido', label: 'Leve & Fluido' },
  { id: 'denso', label: 'Contemplativo & Denso' },
  { id: 'frenetico', label: 'Ágil & Intenso' },
];

export const DNA_DENSITY_OPTIONS = [
  { id: 'qualquer', label: 'Qualquer duração' },
  { id: 'curta', label: 'Sessão Curta (≤ 30m / < 100m)' },
  { id: 'media', label: 'Sessão Média (45m–130m)' },
  { id: 'longa', label: 'Longas & Maratonas (130m+)' },
];

export const DNA_EXCLUSION_PRESETS = [
  'Gore explícito',
  'Terror gráfico',
  'Violência extrema',
  'Conteúdo adulto explícito',
  'Fillers longos',
];

function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createDefaultReaderDna() {
  const weights = {};
  for (const dim of DNA_DIMENSIONS) {
    weights[dim.id] = 50;
  }
  return {
    weights,
    pacingPreference: 'equilibrado',
    densityPreference: 'qualquer',
    exclusions: [],
  };
}

export function normalizeReaderDna(raw) {
  const defaults = createDefaultReaderDna();
  if (!raw || typeof raw !== 'object') return defaults;

  const sourceWeights =
    raw.weights && typeof raw.weights === 'object' ? raw.weights : raw;
  const weights = {};
  for (const dim of DNA_DIMENSIONS) {
    const val = Number(sourceWeights[dim.id]);
    weights[dim.id] = Number.isFinite(val)
      ? Math.max(0, Math.min(100, Math.round(val)))
      : defaults.weights[dim.id];
  }

  const pacingPreference = DNA_PACING_OPTIONS.some(
    (o) => o.id === raw.pacingPreference
  )
    ? raw.pacingPreference
    : defaults.pacingPreference;

  const densityPreference = DNA_DENSITY_OPTIONS.some(
    (o) => o.id === raw.densityPreference
  )
    ? raw.densityPreference
    : defaults.densityPreference;

  const exclusions = Array.isArray(raw.exclusions)
    ? Array.from(
        new Set(
          raw.exclusions
            .map((entry) => String(entry || '').trim().slice(0, 48))
            .filter(Boolean)
        )
      ).slice(0, 24)
    : [];

  return {
    weights,
    pacingPreference,
    densityPreference,
    exclusions,
  };
}

export function createDefaultCriteriaScores(baseScore = 80) {
  const score =
    typeof baseScore === 'number' && !Number.isNaN(baseScore)
      ? Math.max(0, Math.min(100, Math.round(baseScore)))
      : 80;
  const result = {};
  for (const dim of DNA_DIMENSIONS) {
    result[dim.id] = score;
  }
  return result;
}

export function normalizeCriteriaScores(rawCriteria, fallbackScore = 80) {
  const defaults = createDefaultCriteriaScores(fallbackScore);
  if (!rawCriteria || typeof rawCriteria !== 'object') return defaults;

  const normalized = {};
  for (const dim of DNA_DIMENSIONS) {
    const rawVal = rawCriteria[dim.id];
    if (rawVal !== undefined && rawVal !== null && rawVal !== '' && !Number.isNaN(Number(rawVal))) {
      normalized[dim.id] = Math.max(0, Math.min(100, Math.round(Number(rawVal))));
    } else {
      normalized[dim.id] = defaults[dim.id];
    }
  }
  return normalized;
}

export function computeWeightedDnaRating(criteriaScores, dnaInput = null) {
  if (!criteriaScores || typeof criteriaScores !== 'object') return null;
  const dna = normalizeReaderDna(dnaInput);
  const scores = normalizeCriteriaScores(criteriaScores);

  let weightedSum = 0;
  let totalWeight = 0;
  let plainSum = 0;
  let plainCount = 0;

  for (const dim of DNA_DIMENSIONS) {
    const score = scores[dim.id];
    if (typeof score !== 'number' || Number.isNaN(score)) continue;
    const weight = Math.max(0, Number(dna.weights[dim.id] ?? 50));
    plainSum += score;
    plainCount += 1;
    if (weight > 0) {
      weightedSum += score * weight;
      totalWeight += weight;
    }
  }

  if (plainCount === 0) return null;
  if (totalWeight <= 0) {
    return Math.max(0, Math.min(100, Math.round(plainSum / plainCount)));
  }
  return Math.max(0, Math.min(100, Math.round(weightedSum / totalWeight)));
}

export function evaluateCandidateExclusion(item, dnaInput) {
  if (!item) return false;
  const dna = normalizeReaderDna(dnaInput);
  if (dna.exclusions.length === 0) return false;

  const haystack = normalizeToken(
    [
      item.title,
      item.originalTitle,
      item.synopsis,
      item.notes,
      ...(Array.isArray(item.genres) ? item.genres : []),
      ...(Array.isArray(item.tropes) ? item.tropes : []),
      ...(Array.isArray(item.atmosphere) ? item.atmosphere : []),
      ...(Array.isArray(item.tags) ? item.tags : []),
      ...(Array.isArray(item.contentWarnings) ? item.contentWarnings : []),
    ]
      .filter(Boolean)
      .join(' ')
  );

  if (!haystack) return false;

  return dna.exclusions.some((term) => {
    const clean = normalizeToken(term);
    if (clean.length < 3) return false;
    if (haystack.includes(clean)) return true;
    const significantWords = clean.split(' ').filter((w) => w.length >= 4);
    return (
      significantWords.length >= 2 &&
      significantWords.every((word) => haystack.includes(word))
    );
  });
}

export function getEstimatedSessionMinutes(item) {
  if (!item) return 0;
  const workType = item.workType || 'movie';
  if (workType === 'movie') {
    const totSec = Number(item.totalSeconds) || 0;
    if (totSec > 0) return Math.round(totSec / 60);
    const dur = Number(item.durationMinutes) || 0;
    return dur > 0 ? dur : 115;
  }
  const epDur = Number(item.episodeDurationMinutes) || Number(item.durationMinutes) || 0;
  if (epDur > 0) return epDur;
  return workType === 'anime' ? 24 : 48;
}

export function computeDnaWeightedScore(item, dnaInput) {
  const dna = normalizeReaderDna(dnaInput);
  if (!item) {
    return { excluded: false, bonus: 0, matchedDimensions: [], topDimensionLabel: '' };
  }

  if (evaluateCandidateExclusion(item, dna)) {
    return { excluded: true, bonus: -999, matchedDimensions: [], topDimensionLabel: '' };
  }

  const totalWeight = DNA_DIMENSIONS.reduce(
    (sum, dim) => sum + (dna.weights[dim.id] ?? 0),
    0
  );

  if (totalWeight <= 0) {
    return { excluded: false, bonus: 0, matchedDimensions: [], topDimensionLabel: '' };
  }

  const fullText = normalizeToken(
    [
      item.title,
      item.originalTitle,
      item.workType,
      item.format,
      item.audioFormat,
      item.synopsis,
      ...(Array.isArray(item.genres) ? item.genres : []),
      ...(Array.isArray(item.tropes) ? item.tropes : []),
      ...(Array.isArray(item.atmosphere) ? item.atmosphere : []),
    ]
      .filter(Boolean)
      .join(' ')
  );

  let weightedMatch = 0;
  let topDimensionLabel = '';
  let topDimScore = 0;
  const matchedDimensions = [];

  for (const dim of DNA_DIMENSIONS) {
    const weight = dna.weights[dim.id] ?? 50;
    if (weight <= 0) continue;

    let match = dim.keywords.test(fullText) ? 1 : 0;
    if (!match && dim.id === 'directionVisuals' && item.workType === 'anime') {
      match = 1;
    }

    if (match > 0) {
      weightedMatch += weight;
      matchedDimensions.push(dim.id);
      if (weight > topDimScore) {
        topDimScore = weight;
        topDimensionLabel = dim.label;
      }
    }
  }

  let bonus = Math.round((weightedMatch / totalWeight) * 28);

  const sessionMins = getEstimatedSessionMinutes(item);
  if (sessionMins > 0) {
    if (dna.densityPreference === 'curta' && sessionMins <= 35) bonus += 6;
    else if (dna.densityPreference === 'media' && sessionMins > 35 && sessionMins <= 130) bonus += 6;
    else if (dna.densityPreference === 'longa' && sessionMins > 130) bonus += 6;
    else if (dna.densityPreference === 'curta' && sessionMins > 140) bonus -= 4;
  }

  if (dna.pacingPreference === 'fluido' && /leve|comedia|slice of life|animacao|romance/.test(fullText)) {
    bonus += 5;
  } else if (dna.pacingPreference === 'frenetico' && /acao|suspense|thriller|aventura|shonen/.test(fullText)) {
    bonus += 5;
  } else if (dna.pacingPreference === 'denso' && /drama|noir|contemplativo|documentario|psicolog/.test(fullText)) {
    bonus += 5;
  }

  return {
    excluded: false,
    bonus,
    matchedDimensions,
    topDimensionLabel: topDimScore >= 60 ? topDimensionLabel : '',
  };
}
