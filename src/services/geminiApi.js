import { domainConfig } from '../config/domainConfig.js';
import { formatSecondsToHms, isEpisodicWork } from '../utils/backlogHelpers.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/';
const MODEL_CACHE_KEY = 'codice_gemini_resolved_model_v1';
const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_MODEL_FALLBACK_ATTEMPTS = 3;
const RATE_LIMIT_DELAYS_MS = [650];

export const PREFERRED_GEMINI_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
];

const EXCLUDED_MODEL_PATTERNS = [
  /embedding/i,
  /\baqa\b/i,
  /imagen/i,
  /\bveo\b/i,
  /\btts\b/i,
  /audio/i,
  /image/i,
  /robotics/i,
  /computer-use/i,
  /\blive\b/i,
  /gemma/i,
];

export function sanitizeGeminiKey(apiKey) {
  return String(apiKey || '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[\r\n\t]+/g, '')
    .trim();
}

export class GeminiError extends Error {
  constructor(code, userMessage, cause, status = 0) {
    super(userMessage);
    this.name = 'GeminiError';
    this.code = code;
    this.userMessage = userMessage;
    this.status = Number(status) || 0;
    if (cause) {
      this.cause = cause;
    }
  }
}

function getCacheStorage() {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

function readCachedModels() {
  const storage = getCacheStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(MODEL_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed.model !== 'string' ||
      !Array.isArray(parsed.candidates) ||
      Date.now() - Number(parsed.timestamp || 0) >= MODEL_CACHE_TTL_MS
    ) {
      storage.removeItem(MODEL_CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedModels(model, candidates) {
  const storage = getCacheStorage();
  if (!storage) return;
  try {
    storage.setItem(
      MODEL_CACHE_KEY,
      JSON.stringify({
        model,
        candidates,
        timestamp: Date.now(),
      })
    );
  } catch {
    // Ignora falha de quota
  }
}

export function invalidateGeminiModelCache() {
  const storage = getCacheStorage();
  if (!storage) return;
  try {
    storage.removeItem(MODEL_CACHE_KEY);
  } catch {
    // Ignora erro de storage
  }
}

function extractModelId(rawName) {
  return String(rawName || '').replace(/^models\//i, '').trim();
}

function scoreModelCandidate(modelEntry) {
  const id = extractModelId(modelEntry?.name);
  if (!id || !/^gemini/i.test(id)) return -1;
  if (EXCLUDED_MODEL_PATTERNS.some((pattern) => pattern.test(id))) {
    return -1;
  }

  let familyScore = 0;
  if (/flash-lite/i.test(id) || /flash-8b/i.test(id)) {
    familyScore = 2000;
  } else if (/flash/i.test(id)) {
    familyScore = 3000;
  } else if (/pro/i.test(id)) {
    familyScore = 1000;
  }

  const versionMatch = id.match(/gemini-(\d+)(?:\.(\d+))?/i);
  const major = versionMatch ? Number(versionMatch[1] || 0) : 0;
  const minor = versionMatch ? Number(versionMatch[2] || 0) : 0;
  const versionScore = major * 100 + minor * 10;

  const isPreviewOrExp = /-(preview|exp|experimental)/i.test(id);
  const stabilityScore = isPreviewOrExp ? 0 : 50;
  const isLatestAlias = /-latest$/i.test(id) ? 5 : 0;
  const compactBonus = Math.max(0, 30 - id.length) * 0.1;

  return familyScore + versionScore + stabilityScore + isLatestAlias + compactBonus;
}

export function selectBestGeminiModels(modelsList = []) {
  return modelsList
    .filter(
      (entry) =>
        Array.isArray(entry?.supportedGenerationMethods) &&
        entry.supportedGenerationMethods.includes('generateContent')
    )
    .map((entry) => ({
      id: extractModelId(entry.name),
      score: scoreModelCandidate(entry),
    }))
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((candidate) => candidate.id);
}

function buildModelsListUrl(apiKey) {
  const url = new URL('models', GEMINI_API_BASE);
  const params = new URLSearchParams({ key: apiKey });
  url.search = params.toString();
  return url.toString();
}

function buildGenerateContentUrl(modelId) {
  const cleanId = extractModelId(modelId);
  const url = new URL(
    `models/${encodeURIComponent(cleanId)}:generateContent`,
    GEMINI_API_BASE
  );
  return url.toString();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const { signal: parentSignal, ...fetchOptions } = options;
  const controller = new AbortController();
  let timedOut = false;

  const onParentAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) {
      const abortErr = new Error('Aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError' && !timedOut && parentSignal?.aborted) {
      throw err;
    }
    throw new GeminiError(
      timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
      'Verifique sua conexão com a internet e tente novamente.',
      err
    );
  } finally {
    clearTimeout(timer);
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  }
}

function waitWithSignal(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
      return;
    }

    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function readResponseErrorPayload(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isApiKeyFailurePayload(status, payload) {
  if (status === 401) return true;
  if (status !== 400) return false;
  if (!payload || typeof payload !== 'object') return false;
  const serialized = JSON.stringify(payload).toLowerCase();
  return (
    serialized.includes('api_key_invalid') ||
    serialized.includes('api key not valid') ||
    serialized.includes('invalid api key')
  );
}

function mapHttpStatusToGeminiError(status, detail = '', payload = null) {
  if (isApiKeyFailurePayload(status, payload)) {
    return new GeminiError(
      'AUTH_INVALID',
      'Chave da API inválida. Verifique se copiou a chave completa no Google AI Studio.',
      detail,
      status
    );
  }
  if (status === 403) {
    return new GeminiError(
      'AUTH_INVALID',
      'Acesso bloqueado pela chave (verifique restrições de domínio/HTTP Referrer no Google AI Studio).',
      detail,
      status
    );
  }
  if (status === 400) {
    return new GeminiError(
      'BAD_REQUEST',
      'Chave da API inválida ou parâmetro recusado pelo modelo Gemini. Verifique sua chave no Google AI Studio.',
      detail,
      status
    );
  }
  if (status === 404) {
    return new GeminiError(
      'MODEL_NOT_FOUND',
      'Modelo Gemini indisponível no momento; já tentamos os modelos alternativos automaticamente.',
      detail,
      status
    );
  }
  if (status === 429) {
    return new GeminiError(
      'RATE_LIMIT',
      'Limite gratuito temporário atingido. Aguarde alguns segundos e tente novamente.',
      detail,
      status
    );
  }
  if (status === 503) {
    return new GeminiError(
      'SERVICE_UNAVAILABLE',
      'Serviço Gemini temporariamente sobrecarregado (503).',
      detail,
      status
    );
  }
  return new GeminiError(
    `HTTP_${status}`,
    `Não foi possível concluir a chamada ao Gemini (código ${status}).`,
    detail,
    status
  );
}

async function discoverCandidateModels(
  cleanKey,
  { signal, forceRefresh = false, excludeModels = [] } = {}
) {
  const excludedSet = new Set(excludeModels.map(extractModelId));

  if (!forceRefresh) {
    const cached = readCachedModels();
    if (cached) {
      const remaining = [cached.model, ...cached.candidates].filter(
        (m, idx, arr) => m && !excludedSet.has(m) && arr.indexOf(m) === idx
      );
      if (remaining.length > 0) {
        return { chosen: remaining[0], candidates: remaining };
      }
    }
  }

  const modelsUrl = buildModelsListUrl(cleanKey);
  const response = await fetchWithTimeout(modelsUrl, {
    method: 'GET',
    signal,
  });

  if (!response.ok) {
    const errPayload = await readResponseErrorPayload(response);
    throw mapHttpStatusToGeminiError(response.status, '', errPayload);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new GeminiError(
      'INVALID_RESPONSE',
      'Resposta inesperada ao listar modelos do Google Gemini.',
      err
    );
  }

  const rankedModels = selectBestGeminiModels(data?.models || []);
  const availableModels = rankedModels.filter((m) => !excludedSet.has(m));
  const chosen = availableModels[0] || null;

  if (!chosen && rankedModels.length === 0) {
    throw new GeminiError(
      'NO_MODEL_AVAILABLE',
      'Nenhum modelo compatível com geração de texto está disponível para esta chave.'
    );
  }

  if (chosen) {
    writeCachedModels(chosen, rankedModels);
  }

  return { chosen, candidates: availableModels };
}

export async function resolveModel(
  apiKey,
  { signal, forceRefresh = false, excludeModels = [] } = {}
) {
  const cleanKey = sanitizeGeminiKey(apiKey);
  if (!cleanKey) {
    throw new GeminiError(
      'MISSING_KEY',
      'Chave do Google Gemini não configurada. Adicione sua chave gratuita nas configurações do Perfil.'
    );
  }

  const { chosen } = await discoverCandidateModels(cleanKey, {
    signal,
    forceRefresh,
    excludeModels,
  });

  if (!chosen) {
    throw new GeminiError(
      'NO_MODEL_AVAILABLE',
      'Nenhum modelo compatível com geração de texto está disponível para esta chave.'
    );
  }

  return chosen;
}

function extractBalancedJsonSlice(text) {
  const str = String(text || '');
  const firstObj = str.indexOf('{');
  const firstArr = str.indexOf('[');
  let start = -1;
  if (firstObj >= 0 && firstArr >= 0) start = Math.min(firstObj, firstArr);
  else start = Math.max(firstObj, firstArr);
  if (start < 0) return null;

  const openChar = str[start];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < str.length; i += 1) {
    const ch = str[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === openChar) depth += 1;
      else if (ch === closeChar) {
        depth -= 1;
        if (depth === 0) {
          return str.slice(start, i + 1);
        }
      }
    }
  }
  return null;
}

export function parseJsonResponse(rawText) {
  const stripped = String(rawText || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(stripped);
  } catch {
    const extracted = extractBalancedJsonSlice(rawText);
    if (extracted) {
      try {
        return JSON.parse(extracted);
      } catch (err) {
        throw new GeminiError(
          'PARSE_ERROR',
          'A resposta da IA veio em formato inesperado. Tente novamente.',
          err
        );
      }
    }
    throw new GeminiError(
      'PARSE_ERROR',
      'A resposta da IA veio em formato inesperado. Tente novamente.'
    );
  }
}

export async function callGeminiDetailed({
  apiKey,
  systemInstruction = '',
  prompt,
  temperature = 0.4,
  maxOutputTokens,
  signal,
  preferredModel = '',
  fallbackModel = '',
}) {
  const cleanKey = sanitizeGeminiKey(apiKey);
  if (!cleanKey) {
    throw new GeminiError(
      'MISSING_KEY',
      'Chave do Google Gemini não configurada. Adicione sua chave gratuita nas configurações do Perfil.'
    );
  }

  // Nao enviamos responseMimeType: 'application/json' para evitar HTTP 400 em modelos preview;
  // parseJsonResponse faz extracao resiliente de {...} ou [...] quando JSON for solicitado no prompt.
  const body = {
    ...(systemInstruction
      ? {
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
        }
      : {}),
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature,
      ...(typeof maxOutputTokens === 'number' ? { maxOutputTokens } : {}),
    },
  };

  const triedModels = [];
  let modelId =
    preferredModel || (await resolveModel(cleanKey, { signal }));
  let lastHttpError = null;

  for (let attempt = 0; attempt < MAX_MODEL_FALLBACK_ATTEMPTS; attempt += 1) {
    let response = await fetchWithTimeout(buildGenerateContentUrl(modelId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': cleanKey,
      },
      body: JSON.stringify(body),
      signal,
    });

    let errPayload = response.ok ? null : await readResponseErrorPayload(response);

    if (!response.ok && isApiKeyFailurePayload(response.status, errPayload)) {
      throw mapHttpStatusToGeminiError(response.status, '', errPayload);
    }
    if (!response.ok && response.status === 403) {
      throw mapHttpStatusToGeminiError(403, '', errPayload);
    }

    const isRecoverableModelHttp =
      response.status === 404 ||
      response.status === 400 ||
      response.status === 429 ||
      response.status === 503;

    if (!response.ok && isRecoverableModelHttp) {
      lastHttpError = mapHttpStatusToGeminiError(response.status, '', errPayload);
      triedModels.push(modelId);
      invalidateGeminiModelCache();

      if (
        (response.status === 503 || response.status === 429) &&
        fallbackModel &&
        !triedModels.includes(fallbackModel) &&
        attempt + 1 < MAX_MODEL_FALLBACK_ATTEMPTS
      ) {
        modelId = fallbackModel;
        continue;
      }

      const nextDiscovery = await discoverCandidateModels(cleanKey, {
        signal,
        forceRefresh: true,
        excludeModels: triedModels,
      }).catch(() => null);

      if (nextDiscovery?.chosen && attempt + 1 < MAX_MODEL_FALLBACK_ATTEMPTS) {
        modelId = nextDiscovery.chosen;
        continue;
      }

      if (response.status === 429) {
        await waitWithSignal(RATE_LIMIT_DELAYS_MS[0], signal);
        response = await fetchWithTimeout(buildGenerateContentUrl(modelId), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': cleanKey,
          },
          body: JSON.stringify(body),
          signal,
        });
        if (!response.ok) {
          errPayload = await readResponseErrorPayload(response);
          throw mapHttpStatusToGeminiError(response.status, '', errPayload);
        }
      } else {
        throw lastHttpError;
      }
    }

    if (!response.ok) {
      throw mapHttpStatusToGeminiError(response.status, '', errPayload);
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      throw new GeminiError(
        'INVALID_RESPONSE',
        'Não foi possível ler a resposta do Google Gemini.',
        err
      );
    }

    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((part) => part?.text || '')
      .join('')
      .trim();

    if (!text) {
      throw new GeminiError(
        'EMPTY_RESPONSE',
        'A API Gemini retornou uma resposta vazia. Tente reformular ou tentar novamente.'
      );
    }

    return { text, model: modelId };
  }

  throw (
    lastHttpError ||
    new GeminiError(
      'NO_MODEL_AVAILABLE',
      'Nenhum modelo Gemini disponível respondeu com sucesso.'
    )
  );
}

export async function callGemini(options) {
  const result = await callGeminiDetailed(options);
  return result.text;
}

export async function testGeminiConnection(apiKey, { signal } = {}) {
  const cleanKey = sanitizeGeminiKey(apiKey);
  if (!cleanKey) {
    return {
      ok: false,
      model: null,
      latencyMs: 0,
      errorMessage: 'Informe uma chave da API do Google AI Studio para testar.',
    };
  }

  const startedAt = Date.now();
  try {
    const res = await callGeminiDetailed({
      apiKey: cleanKey,
      prompt: 'Responda apenas: OK',
      temperature: 0,
      maxOutputTokens: 16,
      signal,
    });
    return {
      ok: true,
      model: res.model,
      latencyMs: Math.max(1, Date.now() - startedAt),
      errorMessage: '',
    };
  } catch (err) {
    return {
      ok: false,
      model: null,
      latencyMs: Math.max(1, Date.now() - startedAt),
      errorMessage:
        err?.userMessage || err?.message || 'Não foi possível conectar ao Gemini.',
    };
  }
}

export async function runSmartCataloging(apiKey, item, { signal } = {}) {
  const allowedAtmospheres = domainConfig.atmosphereOptions.map((a) => a.id);
  const workType = item?.workType || 'movie';

  const systemInstruction =
    'Você é um catalogador especialista em cinema, séries e animes. Responda sempre em português do Brasil, em JSON estrito, sem inventar dados que contradigam o usuário e sem spoilers.';

  const prompt = `Analise a obra audiovisual abaixo e complete a catalogação em JSON estrito com estas chaves:
{
  "synopsis": "Sinopse envolvente em 2 a 3 frases, estritamente SEM SPOILERS",
  "genres": ["até 3 gêneros em português"],
  "atmosphere": ["selecione 1 a 3 dentre exatamente: ${allowedAtmospheres.join(', ')}"],
  "franchiseName": "nome da franquia ou saga se aplicável, ou string vazia",
  "studio": "estúdio ou produtora provável se ausente e conhecida, ou string vazia",
  "director": "direção ou criador principal se conhecido, ou string vazia"
}

Dados atuais da obra:
- Título: ${item?.title || ''}
- Direção / Estúdio: ${item?.director || item?.studio || 'Não informado'}
- Formato (workType): ${workType}
- Ano: ${item?.releaseYear || 'Não informado'}
- Gêneros atuais: ${(item?.genres || []).join(', ') || 'Nenhum'}`;

  const raw = await callGemini({
    apiKey,
    systemInstruction,
    prompt,
    jsonMode: true,
    temperature: 0.3,
    signal,
  });

  const parsed = parseJsonResponse(raw);
  const validAtmospheres = Array.isArray(parsed.atmosphere)
    ? parsed.atmosphere.filter((a) => allowedAtmospheres.includes(a))
    : [];

  return {
    synopsis: typeof parsed.synopsis === 'string' ? parsed.synopsis.trim() : '',
    genres: Array.isArray(parsed.genres)
      ? parsed.genres.map((g) => String(g).trim()).filter(Boolean).slice(0, 4)
      : [],
    atmosphere: validAtmospheres,
    franchiseName:
      typeof parsed.franchiseName === 'string' ? parsed.franchiseName.trim() : '',
    studio: typeof parsed.studio === 'string' ? parsed.studio.trim() : '',
    director: typeof parsed.director === 'string' ? parsed.director.trim() : '',
  };
}

export async function runCollectionOracle(
  apiKey,
  {
    mood,
    queuedItems = [],
    completedItems = [],
    favoriteGenres = [],
    viewerFocus = [],
    readerFocus = '',
    preferredCriterion = '',
  },
  { signal } = {}
) {
  const shelfSummary = queuedItems.slice(0, 40).map((item) => ({
    id: item.id,
    title: item.title,
    director: item.director || item.studio || 'Desconhecido',
    workType: item.workType || 'movie',
    durationMinutes: item.durationMinutes || null,
    episodes: item.totalEpisodes || null,
    hype: item.hype || null,
    genres: item.genres || [],
    atmosphere: item.atmosphere || [],
    tropes: item.tropes || [],
  }));

  const tasteHistory = completedItems
    .slice()
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, 15)
    .map((item) => ({
      title: item.title,
      director: item.director || item.studio || '',
      rating: item.rating,
      verdict: item.verdict || '',
      fiveStars: Boolean(item.isPlatinum),
      genres: item.genres || [],
      atmosphere: item.atmosphere || [],
    }));

  const focusLabels = (Array.isArray(viewerFocus) ? viewerFocus : [])
    .map((f) => String(f || '').trim())
    .filter(Boolean);
  const focusSummary =
    focusLabels.length > 0 ? focusLabels.join(', ') : readerFocus || 'Geral';

  const systemInstruction =
    'Você é o Curador de Sessões da Cinemateca. Recomende exclusivamente obras presentes na lista "Quero Ver" fornecida pelo usuário. Não invente títulos fora do acervo. Responda em JSON estrito e em português do Brasil.';

  const prompt = `Cruze o humor/objetivo atual do espectador com as obras em "Quero Ver", suas preferências do perfil e o histórico de notas das obras "Concluídas" para indicar a próxima sessão ideal.

Humor / Objetivo atual do espectador: ${mood || 'Surpreenda-me com a melhor escolha do meu acervo'}
Perfil do espectador: ${focusSummary} | Critério valorizado: ${preferredCriterion || 'Equilibrado'}
Gêneros favoritos do perfil: ${
        Array.isArray(favoriteGenres) && favoriteGenres.length
          ? favoriteGenres.map((g) => (typeof g === 'string' ? g : g?.label || '')).filter(Boolean).join(', ')
          : 'Diversos'
      }

Obras em Quero Ver (escolha SOMENTE dentre estes IDs):
${JSON.stringify(shelfSummary)}

Histórico de gosto (Obras Concluídas e notas):
${JSON.stringify(tasteHistory)}

Retorne JSON estrito neste formato:
{
  "primaryId": "id exato da obra principal recomendada da lista Quero Ver",
  "headline": "Frase curta de chamada editorial (máx 10 palavras)",
  "reason": "Explicação concisa (2-3 frases) conectando o humor/objetivo e o histórico de gostos do espectador sem spoilers",
  "alternatives": [
    { "id": "id exato de outra obra da fila", "why": "motivo curto em 1 frase" }
  ]
}`;

  const raw = await callGemini({
    apiKey,
    systemInstruction,
    prompt,
    jsonMode: true,
    temperature: 0.5,
    signal,
  });

  const parsed = parseJsonResponse(raw);
  const validIds = new Set(queuedItems.map((i) => i.id));
  const primaryId = validIds.has(parsed.primaryId)
    ? parsed.primaryId
    : queuedItems[0]?.id || null;

  const alternatives = Array.isArray(parsed.alternatives)
    ? parsed.alternatives
        .filter((alt) => alt && validIds.has(alt.id) && alt.id !== primaryId)
        .slice(0, 2)
    : [];

  return {
    primaryId,
    headline: String(parsed.headline || 'Sessão recomendada para hoje').trim(),
    reason: String(parsed.reason || '').trim(),
    alternatives,
  };
}

export async function runSpoilerFreeRecap(
  apiKey,
  { item, linkedPosts = [] },
  { signal } = {}
) {
  const positionLabel = isEpisodicWork(item)
    ? `Temp. ${item.currentSeason || 1}, Ep. ${item.currentEpisode || 0}${item.totalEpisodes ? ` de ${item.totalEpisodes}` : ''}`
    : `Minutagem ${formatSecondsToHms(item?.currentSeconds || 0)}${item?.totalSeconds ? ` / ${formatSecondsToHms(item.totalSeconds)}` : ''}`;

  const records = linkedPosts.map((post) => ({
    date: post.createdAt,
    marker: post.progressMarker || '',
    title: post.title,
    caption: post.caption,
    updates: (post.comments || []).map((c) => c.text),
  }));

  const quotes = (item.quotes || []).map((q) => ({
    location: q.location,
    text: q.text,
    note: q.note,
  }));

  const systemInstruction =
    'Você é um assistente de memória de sessões audiovisuais. Sua regra ABSOLUTA é ZERO SPOILERS: nunca revele, antecipe ou insinue acontecimentos posteriores ao episódio ou minutagem atual informada pelo espectador. Baseie-se prioritariamente nos registros, falas e anotações fornecidas pelo próprio usuário.';

  const prompt = `Gere uma recapitulação estruturada e concisa de onde o espectador parou, estritamente SEM SPOILERS além do marcador atual.

Obra: ${item.title} (${item.director || item.studio || 'Direção não informada'})
Formato: ${item.workType || 'movie'}
Posição atual exata: ${positionLabel}
Ponto de parada: ${item.checkpoint || 'Não informado'}
Sinopse base (sem spoilers): ${item.synopsis || 'Não informada'}
Anotações pessoais: ${item.notes || 'Nenhuma'}

Registros no Diário de Sessões:
${JSON.stringify(records)}

Falas e cenas salvas:
${JSON.stringify(quotes)}

Estruture em texto limpo (sem markdown excessivo e SEM EMOJIS) com:
1. Ponto de Parada (onde você está)
2. Síntese até aqui (baseada nos registros e contexto seguro até a posição atual)
3. Ganchos / Pontos para retomar a sessão`;

  return callGemini({
    apiKey,
    systemInstruction,
    prompt,
    jsonMode: false,
    temperature: 0.35,
    signal,
  });
}

export async function runReviewOrAbstractSynthesis(
  apiKey,
  { item, linkedPosts = [] },
  { signal } = {}
) {
  const quotes = (item.quotes || []).map((q) => ({
    location: q.location,
    text: q.text,
    note: q.note,
  }));

  const records = linkedPosts.map((post) => ({
    marker: post.progressMarker || '',
    title: post.title,
    caption: post.caption,
    updates: (post.comments || []).map((c) => c.text),
  }));

  const systemInstruction =
    'Você é um crítico de cinema e séries. Escreva uma crítica audiovisual estruturada, elegante e sem emojis em português do Brasil, integrando as falas salvas e impressões do espectador.';

  const taskInstruction = `Transforme as anotações, falas e nota abaixo em uma CRÍTICA AUDIOVISUAL ESTRUTURADA, contendo:
- Apresentação da Obra (sem spoilers pesados)
- Análise de Direção, Ritmo, Fotografia e Montagem
- Destaques das Falas & Cenas Marcantes
- Impressão Final & Veredito (${item.rating !== null && item.rating !== undefined ? `${item.rating}/100` : 'sem nota'}${item.verdict ? ` — ${item.verdict}` : ''})`;

  const prompt = `${taskInstruction}

Obra: ${item.title}
Direção / Estúdio: ${item.director || item.studio || 'Não informado'}
Ano: ${item.releaseYear || 'Não informado'}
Nota: ${item.rating ?? 'sem nota'}/100 | Veredito: ${item.verdict || 'sem veredito'} | Obra-Prima 5 Estrelas: ${item.isPlatinum ? 'Sim' : 'Não'}
Anotações pessoais: ${item.notes || 'Nenhuma'}

Falas e cenas salvas:
${JSON.stringify(quotes)}

Registros no Diário de Sessões:
${JSON.stringify(records)}`;

  return callGemini({
    apiKey,
    systemInstruction,
    prompt,
    jsonMode: false,
    temperature: 0.45,
    signal,
  });
}
