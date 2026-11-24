import {
  Activity,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  AI_MODELS,
  AI_PROVIDER_IDS,
  AI_PROVIDER_META,
  maskApiKey,
  normalizeProviderOrder,
  testProviderConnection,
} from '../services/aiProvider';
import { testOmdbConnection, testTmdbConnection, getOmdbDailyUsage } from '../services/cinemaApi';

const SEARCH_KEY_ENTRY = {
  id: 'tmdb',
  label: 'TMDB (Filmes & Séries opcional)',
  host: 'api.themoviedb.org',
  placeholder: 'Chave v3 (32 caracteres)...',
  hint: 'Opcional: amplia pôsteres HD, coleções e backdrops. Sem chave, AniList, Jikan e TVmaze continuam funcionando.',
  docsUrl: 'https://www.themoviedb.org/settings/api',
  docsLabel: 'themoviedb.org',
};

const OMDB_KEY_ENTRY = {
  id: 'omdb',
  label: 'OMDb API (Notas IMDb / Rotten Tomatoes / Metacritic)',
  host: 'www.omdbapi.com',
  placeholder: 'Chave OMDb gratuita (8 caracteres)...',
  hint: 'Opcional: exibe notas públicas agregadas com cota de 1.000/dia e proteção automática aos 90%.',
  docsUrl: 'https://www.omdbapi.com/apikey.aspx',
  docsLabel: 'omdbapi.com',
};

function ApiKeyRow({
  entry,
  savedKey = '',
  modelNote = '',
  onSave,
  onClear,
  onTest,
}) {
  const [draft, setDraft] = useState(savedKey || '');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    setDraft(savedKey || '');
  }, [savedKey]);

  const hasSaved = Boolean(savedKey);
  const maskedSaved = hasSaved ? maskApiKey(savedKey) : '';
  const isDirty = draft.trim() !== savedKey;

  const handleTest = async () => {
    const targetKey = draft.trim() || savedKey;
    if (draft.trim() && isDirty) {
      onSave?.(draft.trim());
    }
    setTesting(true);
    setTestResult(null);
    const res = await onTest(targetKey);
    setTestResult(res);
    setTesting(false);
  };

  return (
    <div className="space-y-2 rounded-[4px] border border-line bg-app p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink">{entry.label}</span>
            <span className="text-[10px] text-subtle">{entry.host}</span>
          </div>
          {modelNote && (
            <p className="text-[10px] text-muted">{modelNote}</p>
          )}
          {entry.hint && (
            <p className="text-[10px] text-muted">{entry.hint}</p>
          )}
        </div>

        <span
          className={`inline-flex items-center gap-1 rounded-[4px] border px-2 py-0.5 text-[10px] font-medium tabular-nums ${
            hasSaved
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-line text-subtle'
          }`}
        >
          {hasSaved && <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />}
          {hasSaved ? maskedSaved : 'Sem chave'}
        </span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex flex-1 items-center">
          <input
            type={showKey ? 'text' : 'password'}
            autoComplete="off"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setTestResult(null);
            }}
            placeholder={hasSaved ? maskedSaved : entry.placeholder}
            aria-label={`Chave de API ${entry.label}`}
            className="min-h-[44px] w-full rounded-[4px] border border-line bg-card py-2 pl-3 pr-11 font-mono text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setShowKey((prev) => !prev)}
            aria-label={showKey ? `Ocultar chave ${entry.label}` : `Mostrar chave ${entry.label}`}
            className="absolute right-1 flex min-h-[40px] min-w-[40px] items-center justify-center rounded-[4px] text-subtle hover:text-ink"
          >
            {showKey ? (
              <EyeOff className="h-4 w-4" strokeWidth={1.5} />
            ) : (
              <Eye className="h-4 w-4" strokeWidth={1.5} />
            )}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {isDirty && (
            <button
              type="button"
              onClick={() => {
                const saved = onSave?.(draft);
                setDraft(saved || '');
              }}
              className="min-h-[44px] rounded-[4px] bg-accent px-3 py-2 text-xs font-semibold text-accent-ink hover:opacity-90"
            >
              Salvar
            </button>
          )}
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[4px] border border-line bg-card px-3 py-2 text-xs font-medium text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-55"
          >
            <Activity className="h-4 w-4 text-accent" strokeWidth={1.5} />
            <span>{testing ? 'Testando...' : 'Testar'}</span>
          </button>
          {hasSaved && (
            <button
              type="button"
              onClick={() => {
                onClear?.();
                setDraft('');
                setTestResult(null);
              }}
              aria-label={`Remover chave ${entry.label}`}
              className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-[4px] border border-line bg-card px-3 py-2 text-xs font-medium text-ink hover:border-accent"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.5} />
              <span>Remover</span>
            </button>
          )}
        </div>
      </div>

      {entry.docsUrl && (
        <a
          href={entry.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
        >
          <span>Obter chave em {entry.docsLabel}</span>
          <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
        </a>
      )}

      {testResult && (
        <div
          role="status"
          className={`rounded-[4px] border px-3 py-2 text-xs ${
            testResult.ok
              ? 'border-accent/40 bg-accent/10 text-ink'
              : 'border-line bg-card text-muted'
          }`}
        >
          {testResult.ok ? (
            <div className="flex flex-wrap items-center justify-between gap-2 tabular-nums">
              <span className="font-medium text-accent">
                Conectado{testResult.model ? `: ${testResult.model}` : ''}
              </span>
              <span className="text-[11px] text-muted">{testResult.latencyMs} ms</span>
            </div>
          ) : (
            <p>{testResult.errorMessage}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function AiProvidersPanel({
  keys = {},
  preferences = { preferredProvider: 'gemini', fallbackOrder: AI_PROVIDER_IDS },
  onSaveKey,
  onClearKey,
  onUpdatePreferences,
  compact = false,
}) {
  const [omdbUsage, setOmdbUsage] = useState(() => getOmdbDailyUsage());
  const ordered = normalizeProviderOrder(
    preferences?.preferredProvider,
    preferences?.fallbackOrder
  );

  const refreshOmdbUsage = () => {
    setOmdbUsage(getOmdbDailyUsage());
  };

  const handleMoveFallback = (index, direction) => {
    const nextIdx = index + direction;
    if (nextIdx < 0 || nextIdx >= ordered.length) return;
    const copy = [...ordered];
    const [moved] = copy.splice(index, 1);
    copy.splice(nextIdx, 0, moved);
    onUpdatePreferences?.({
      preferredProvider: copy[0],
      fallbackOrder: copy,
    });
  };

  return (
    <div className="space-y-3">
      <div className="rounded-[4px] border border-line bg-app p-3 text-[11px] leading-relaxed text-muted">
        <div className="mb-1 flex items-center gap-1.5 font-semibold text-ink">
          <KeyRound className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
          <span>Chaves locais neste dispositivo</span>
        </div>
        <p>
          As chaves ficam apenas no armazenamento local (<code className="text-ink">localStorage</code>).
          Nunca vão para backups JSON, URL ou nuvem; cada chave só é enviada ao host do seu próprio provedor.
        </p>
      </div>

      {/* Chaves de Catálogo Audiovisual (TMDB & OMDb) */}
      <div className="space-y-2.5 rounded-[4px] border border-line bg-app p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <Search className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
            <span>Busca &amp; Notas Audiovisuais (TMDB / OMDb)</span>
          </div>
          <span
            className={`rounded-[4px] border px-2 py-0.5 text-[10px] tabular-nums ${
              omdbUsage.autoStopped
                ? 'border-accent/60 bg-accent/15 font-semibold text-accent'
                : 'border-line text-muted'
            }`}
          >
            Uso OMDb hoje: {omdbUsage.count}/{omdbUsage.limit}
          </span>
        </div>

        <p className="text-[11px] leading-relaxed text-muted">
          Fontes abertas (AniList, MyAnimeList/Jikan, TVmaze, Wikidata e Archive) funcionam sem chave.
          TMDB e OMDb são opcionais; se não preenchidas, o catálogo segue completo.
        </p>

        <ApiKeyRow
          entry={SEARCH_KEY_ENTRY}
          savedKey={keys.tmdb || ''}
          onSave={(val) => onSaveKey?.('tmdb', val)}
          onClear={() => onClearKey?.('tmdb')}
          onTest={(val) => testTmdbConnection(val)}
        />

        <ApiKeyRow
          entry={OMDB_KEY_ENTRY}
          savedKey={keys.omdb || ''}
          modelNote={
            omdbUsage.autoStopped
              ? `Pausa preventiva ativada (${omdbUsage.count}/${omdbUsage.limit} requisições hoje; reinicia amanhã).`
              : `Cota diária gratuita: ${omdbUsage.count} de ${omdbUsage.limit} utilizadas hoje.`
          }
          onSave={(val) => onSaveKey?.('omdb', val)}
          onClear={() => onClearKey?.('omdb')}
          onTest={async (val) => {
            const res = await testOmdbConnection(val);
            refreshOmdbUsage();
            return res;
          }}
        />
      </div>

      {/* Seleção do provedor preferido e ordem de fallback */}
      <div className="space-y-2 rounded-[4px] border border-line bg-app p-3">
        <p className="text-xs font-medium text-ink">
          Provedor preferido &amp; ordem de fallback
        </p>

        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Provedor de IA preferido">
          {AI_PROVIDER_IDS.map((id) => {
            const meta = AI_PROVIDER_META[id];
            const isPref = (preferences?.preferredProvider || 'gemini') === id;
            const hasKey = Boolean(keys?.[id]);
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={isPref}
                onClick={() =>
                  onUpdatePreferences?.({
                    preferredProvider: id,
                    fallbackOrder: normalizeProviderOrder(id, ordered),
                  })
                }
                className={`min-h-[44px] rounded-[4px] border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                  isPref
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-line bg-card text-muted hover:text-ink'
                }`}
              >
                <span className="block truncate">{meta.label}</span>
                <span className="block text-[9px] tabular-nums text-subtle">
                  {hasKey ? maskApiKey(keys[id]) : 'sem chave'}
                </span>
              </button>
            );
          })}
        </div>

        <div className="space-y-1 pt-1">
          <span className="block text-[10px] uppercase tracking-wider text-subtle">
            Ordem de tentativa (em 429, 503 ou timeout)
          </span>
          <div className="space-y-1">
            {ordered.map((id, idx) => {
              const meta = AI_PROVIDER_META[id];
              return (
                <div
                  key={id}
                  className="flex min-h-[44px] items-center justify-between gap-2 rounded-[4px] border border-line bg-card px-2.5 py-1 text-xs"
                >
                  <span className="flex items-center gap-2 tabular-nums text-ink">
                    <span className="text-[11px] text-subtle">{idx + 1}.</span>
                    <span className="font-medium">{meta.label}</span>
                    {idx === 0 && (
                      <span className="rounded-[2px] border border-accent/40 px-1.5 py-0.5 text-[10px] text-accent">
                        Principal
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleMoveFallback(idx, -1)}
                      disabled={idx === 0}
                      aria-label={`Subir prioridade de ${meta.label}`}
                      className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-[4px] border border-line text-muted hover:border-accent hover:text-accent disabled:opacity-35"
                    >
                      <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveFallback(idx, 1)}
                      disabled={idx === ordered.length - 1}
                      aria-label={`Descer prioridade de ${meta.label}`}
                      className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-[4px] border border-line text-muted hover:border-accent hover:text-accent disabled:opacity-35"
                    >
                      <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Chaves individuais */}
      <div className="space-y-2.5">
        <ApiKeyRow
          entry={AI_PROVIDER_META.gemini}
          savedKey={keys.gemini || ''}
          modelNote={`Modelos ativos: ${AI_MODELS.gemini.primary} / ${AI_MODELS.gemini.fallback} (2.0-flash-lite descontinuado)`}
          onSave={(val) => onSaveKey?.('gemini', val)}
          onClear={() => onClearKey?.('gemini')}
          onTest={(val) => testProviderConnection('gemini', val)}
        />

        <ApiKeyRow
          entry={AI_PROVIDER_META.groq}
          savedKey={keys.groq || ''}
          modelNote={`Modelo: ${AI_MODELS.groq.primary}`}
          onSave={(val) => onSaveKey?.('groq', val)}
          onClear={() => onClearKey?.('groq')}
          onTest={(val) => testProviderConnection('groq', val)}
        />

        <ApiKeyRow
          entry={AI_PROVIDER_META.openrouter}
          savedKey={keys.openrouter || ''}
          modelNote={`Modelo gratuito: ${AI_MODELS.openrouter.primary}`}
          onSave={(val) => onSaveKey?.('openrouter', val)}
          onClear={() => onClearKey?.('openrouter')}
          onTest={(val) => testProviderConnection('openrouter', val)}
        />
      </div>
    </div>
  );
}
