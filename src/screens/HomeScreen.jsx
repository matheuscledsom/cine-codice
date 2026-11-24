import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Play,
  Plus,
  Search,
  Sparkles,
  Star,
} from 'lucide-react';
import { Suspense, lazy, useMemo, useRef, useState } from 'react';
import { BackupReminderBanner } from '../components/BackupReminderBanner';
import { CoverArt } from '../components/CoverArt';
import { DomainSwitcherBar } from '../components/DomainSwitcherBar';
import { InstallAppBanner } from '../components/InstallAppBanner';

const OfflineBookPickerModal = lazy(() =>
  import('../components/OfflineBookPickerModal').then((m) => ({
    default: m.OfflineBookPickerModal,
  }))
);
const ReleaseHistoryModal = lazy(() =>
  import('../components/ReleaseHistoryModal').then((m) => ({
    default: m.ReleaseHistoryModal,
  }))
);
import { StarRatingDisplay } from '../components/StarRatingPicker';
import {
  domainConfig,
  getDomainVocabulary,
  inferDomainFromWork,
} from '../config/domainConfig';
import { CODICE_RELEASE } from '../config/versioning';
import { useToast } from '../context/ToastContext';
import {
  buildHomeInProgressStrip,
  buildHomeNextInQueue,
  buildHomeRecentlyCompleted,
  computeHeroAdvancePlan,
  resolveHeroNextEpisodeTitle,
} from '../lib/homeEngine';
import { getDisplayTitles } from '../utils/backlogHelpers';

export function HomeScreen({
  items = [],
  activeDomain = 'cinema',
  onSelectDomain,
  profile = null,
  loading = false,
  themeMode = 'dark',
  backupReminder = null,
  onSaveBackupNow,
  onDismissBackupReminder,
  onQuickAdvanceWork,
  onStartPickedWork,
  onSelectItem,
  onNavigateList,
  onNavigateAdd,
}) {
  const { showToast } = useToast();

  // Por padrão a Home exibe o painel cross-domain ("all"); tocar numa aba filtra e aplica a paleta OKLCH.
  const [homeFilterDomain, setHomeFilterDomain] = useState('all');
  const [emptySearchQuery, setEmptySearchQuery] = useState('');
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [rouletteOpen, setRouletteOpen] = useState(false);
  const [advancingWorkId, setAdvancingWorkId] = useState(null);
  const [completionPrompt, setCompletionPrompt] = useState(null);

  const advanceLockRef = useRef(new Map());

  const handleSelectHomeDomain = (nextDomain) => {
    if (nextDomain === 'all') {
      setHomeFilterDomain('all');
      return;
    }
    if (homeFilterDomain === nextDomain) {
      setHomeFilterDomain('all');
      return;
    }
    setHomeFilterDomain(nextDomain);
    onSelectDomain?.(nextDomain);
  };

  const activeVocab = useMemo(
    () => getDomainVocabulary(homeFilterDomain),
    [homeFilterDomain]
  );

  const filteredBacklog = useMemo(() => {
    return (Array.isArray(items) ? items : []).filter((item) => {
      if (!item || item.inBacklog === false) return false;
      if (homeFilterDomain !== 'all') {
        return inferDomainFromWork(item) === homeFilterDomain;
      }
      return true;
    });
  }, [items, homeFilterDomain]);

  const inProgressEntries = useMemo(
    () => buildHomeInProgressStrip(items, { domainFilter: homeFilterDomain }),
    [items, homeFilterDomain]
  );

  const nextInQueueEntries = useMemo(
    () => buildHomeNextInQueue(items, { domainFilter: homeFilterDomain }),
    [items, homeFilterDomain]
  );

  const recentlyCompletedEntries = useMemo(
    () =>
      buildHomeRecentlyCompleted(items, {
        domainFilter: homeFilterDomain,
        limit: 5,
      }),
    [items, homeFilterDomain]
  );

  const lastActiveWork =
    inProgressEntries[0]?.work ||
    nextInQueueEntries[0]?.work ||
    recentlyCompletedEntries[0]?.work ||
    null;

  const runProtectedAdvance = (work, actionType = null, { allowCompletion = true } = {}) => {
    if (!work?.id || !onQuickAdvanceWork) return;
    const now = Date.now();
    const lockedUntil = advanceLockRef.current.get(work.id) || 0;
    if (now < lockedUntil) return;

    const workDomain = inferDomainFromWork(work);

    if (workDomain === 'cinema') {
      const plan = computeHeroAdvancePlan(work);
      if (!plan) return;

      if (plan.kind === 'episode' && plan.requiresCompletionConfirm && allowCompletion === true) {
        setCompletionPrompt({ work, plan });
        return;
      }

      if (plan.kind === 'minutes' && plan.addMinutes <= 0) {
        showToast({
          message: 'Esta obra já atingiu a duração total conhecida.',
          type: 'info',
        });
        return;
      }
    }

    advanceLockRef.current.set(work.id, now + 500);
    setAdvancingWorkId(work.id);
    onQuickAdvanceWork(work, { allowCompletion, actionType });
    setTimeout(() => {
      setAdvancingWorkId((curr) => (curr === work.id ? null : curr));
    }, 400);
  };

  const confirmEpisodeAdvance = (markCompleted) => {
    if (!completionPrompt?.work) return;
    const { work } = completionPrompt;
    setCompletionPrompt(null);

    const now = Date.now();
    advanceLockRef.current.set(work.id, now + 500);
    setAdvancingWorkId(work.id);
    onQuickAdvanceWork?.(work, {
      allowCompletion: markCompleted,
      actionType: 'cinema_episode',
    });
    setTimeout(() => {
      setAdvancingWorkId((curr) => (curr === work.id ? null : curr));
    }, 400);
  };

  const handleEmptySearchSubmit = (e) => {
    e.preventDefault();
    const targetDomain = homeFilterDomain === 'all' ? activeDomain : homeFilterDomain;
    onNavigateAdd?.(emptySearchQuery.trim(), targetDomain);
  };

  return (
    <div className="space-y-5 pb-8">
      {/* Abas curtas de domínio (Cinema, Livros, Games, Música) que filtram o painel abaixo */}
      <DomainSwitcherBar
        includeAll
        activeDomain={homeFilterDomain}
        onSelectDomain={handleSelectHomeDomain}
        items={items}
        themeMode={themeMode}
      />

      <InstallAppBanner variant="home" />

      {backupReminder?.shouldRemind && (
        <BackupReminderBanner
          daysWithoutBackup={backupReminder.daysWithoutBackup}
          onSaveBackupNow={onSaveBackupNow}
          onDismiss={onDismissBackupReminder}
        />
      )}

      {loading ? (
        <section
          aria-label="Carregando painel"
          aria-busy="true"
          className="h-44 w-full animate-pulse rounded-[6px] border border-line bg-card"
        />
      ) : filteredBacklog.length === 0 ? (
        /* Estado vazio de domínio: campo de busca direto sem cartão de ícone/título/botão */
        <form
          onSubmit={handleEmptySearchSubmit}
          aria-label={activeVocab.homeEmptySearchPlaceholder}
          className="flex items-center gap-2 rounded-[6px] border border-line bg-card p-2"
        >
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
              strokeWidth={1.5}
            />
            <input
              type="search"
              value={emptySearchQuery}
              onChange={(e) => setEmptySearchQuery(e.target.value)}
              placeholder={activeVocab.homeEmptySearchPlaceholder}
              aria-label={activeVocab.homeEmptySearchPlaceholder}
              className="min-h-[44px] w-full rounded-[4px] bg-app pl-9 pr-3 text-sm text-ink placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <button
            type="submit"
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[4px] bg-accent px-4 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            <span>Buscar</span>
          </button>
        </form>
      ) : (
        <>
          {/* Faixa única "Em andamento" reunindo itens ativos dos 4 domínios com toque rápido */}
          <section aria-label="Em andamento" className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h1 className="font-editorial text-xl font-semibold tracking-tight text-ink">
                  Em andamento
                </h1>
                <span className="text-xs font-medium tabular-nums text-muted">
                  ({inProgressEntries.length})
                </span>
              </div>
              {onNavigateList && (
                <button
                  type="button"
                  onClick={onNavigateList}
                  className="inline-flex min-h-[44px] items-center gap-1 px-2 text-xs font-medium text-muted hover:text-ink"
                >
                  <span>Catálogo</span>
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              )}
            </div>

            {inProgressEntries.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-y border-line py-4 text-xs text-muted">
                <span>
                  {activeVocab.emptyDescription || 'Nada em andamento agora.'}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onNavigateAdd?.(
                      '',
                      homeFilterDomain === 'all' ? activeDomain : homeFilterDomain
                    )
                  }
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] bg-accent px-4 text-xs font-semibold text-accent-ink hover:opacity-90"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span>{activeVocab.emptyCta || 'Catalogar'}</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {inProgressEntries.map((entry) => {
                  const {
                    work,
                    domain,
                    domainMeta,
                    metricLabel,
                    statusLabel,
                    progressPct,
                    hasKnownTotal,
                    quickActions,
                  } = entry;
                  const titles = getDisplayTitles(work, 'bilingual');
                  const nextEpTitle =
                    domain === 'cinema' ? resolveHeroNextEpisodeTitle(work) : '';
                  const isBusy = advancingWorkId === work.id;
                  const isMusic = domain === 'music';

                  return (
                    <article
                      key={entry.id}
                      className="flex flex-col justify-between gap-3 rounded-[6px] border border-line bg-card p-3.5"
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => onSelectItem?.(work)}
                          aria-label={`Abrir ficha de ${work.title}`}
                          className={`${isMusic ? 'w-16' : 'w-16'} shrink-0 overflow-hidden rounded-[6px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
                        >
                          <CoverArt
                            item={work}
                            compact
                            className={`${isMusic ? 'aspect-square' : 'aspect-[2/3]'} w-full rounded-[6px] object-cover`}
                          />
                        </button>

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                            <span>{domainMeta.tabLabel || domainMeta.shortLabel}</span>
                            <span aria-hidden="true">·</span>
                            <span>{statusLabel}</span>
                          </div>

                          <button
                            type="button"
                            onClick={() => onSelectItem?.(work)}
                            className="block w-full text-left"
                          >
                            <h2 className="font-editorial line-clamp-2 text-base font-semibold leading-snug text-ink hover:text-accent">
                              {titles.primary}
                            </h2>
                          </button>

                          {(work.creator || work.director || work.author) && (
                            <p className="truncate text-xs text-muted">
                              {work.creator || work.director || work.author}
                            </p>
                          )}

                          <div className="flex items-center justify-between gap-2 pt-0.5 text-xs tabular-nums text-muted">
                            <span className="truncate">
                              {metricLabel}
                              {nextEpTitle ? ` · ${nextEpTitle}` : ''}
                            </span>
                            {hasKnownTotal && typeof progressPct === 'number' && (
                              <span className="shrink-0 font-semibold text-ink">
                                {progressPct}%
                              </span>
                            )}
                          </div>

                          {hasKnownTotal && typeof progressPct === 'number' && (
                            <div className="h-1 w-full overflow-hidden rounded-full bg-line">
                              <div
                                className="h-full bg-accent transition-all duration-150"
                                style={{
                                  width: `${Math.min(100, progressPct)}%`,
                                }}
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
                        {quickActions.map((act, idx) => (
                          <button
                            key={act.actionType}
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              runProtectedAdvance(work, act.actionType, {
                                allowCompletion: true,
                              })
                            }
                            className={`inline-flex min-h-[44px] items-center justify-center gap-1 rounded-[6px] px-3 text-xs font-semibold tabular-nums transition-opacity disabled:opacity-60 ${
                              idx === 0
                                ? 'bg-accent text-accent-ink hover:opacity-90'
                                : 'border border-line bg-app text-ink hover:border-muted'
                            }`}
                          >
                            <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                            <span>{act.label.replace(/^\+/, '')}</span>
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => onSelectItem?.(work)}
                          className="ml-auto inline-flex min-h-[44px] items-center rounded-[6px] px-3 text-xs font-medium text-muted hover:text-ink"
                        >
                          Ficha
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* Confirmação ao avançar +1 Ep alcançando/passando o total conhecido */}
          {completionPrompt?.work && (
            <div
              role="dialog"
              aria-modal="false"
              aria-label="Confirmar conclusão da série"
              className="rounded-[6px] border border-accent bg-card p-3.5 text-xs text-ink space-y-2.5"
            >
              <p className="font-semibold">
                {completionPrompt.plan?.passesTotal
                  ? `Você já passou do total conhecido de episódios de "${completionPrompt.work.title}".`
                  : `Você chegou ao último episódio conhecido de "${completionPrompt.work.title}".`}
              </p>
              <p className="text-[11px] text-muted">
                Deseja marcar esta obra como Concluída ou apenas avançar o episódio?
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => confirmEpisodeAdvance(true)}
                  className="inline-flex min-h-[44px] items-center rounded-[4px] bg-accent px-3.5 text-xs font-semibold text-accent-ink"
                >
                  Concluir obra
                </button>
                <button
                  type="button"
                  onClick={() => confirmEpisodeAdvance(false)}
                  className="inline-flex min-h-[44px] items-center rounded-[4px] border border-line bg-app px-3.5 text-xs font-medium text-ink hover:border-accent"
                >
                  Só avançar (+1 Ep)
                </button>
                <button
                  type="button"
                  onClick={() => setCompletionPrompt(null)}
                  className="inline-flex min-h-[44px] items-center rounded-[4px] border border-line bg-card px-3 text-xs text-muted hover:text-ink"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Barra única de atalhos rápidos com vocabulário do domínio ativo */}
          <div
            aria-label="Atalhos rápidos"
            className="flex flex-wrap items-center gap-2"
          >
            <button
              type="button"
              onClick={() => setRouletteOpen(true)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-line bg-card px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
            >
              <Sparkles className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              <span>{activeVocab.rouletteButtonLabel}</span>
            </button>
            {lastActiveWork && (
              <button
                type="button"
                onClick={() => onSelectItem?.(lastActiveWork)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-line bg-card px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
              >
                <Play className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                <span>{activeVocab.continueLastLabel}</span>
              </button>
            )}
          </div>

          {/* Próximos da fila (1 sugestão por domínio em modo geral) */}
          {nextInQueueEntries.length > 0 && (
            <section aria-label="Próximos da fila" className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-accent" strokeWidth={1.5} />
                  <h2 className="text-sm font-semibold tracking-tight text-ink">
                    Próximos da fila
                  </h2>
                </div>
                <span className="text-[11px] text-subtle">
                  {homeFilterDomain === 'all' ? '1 sugestão por domínio' : activeVocab.statuses.queued}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {nextInQueueEntries.map((entry) => {
                  const { work, domain, domainMeta, queueLabel } = entry;
                  const titles = getDisplayTitles(work, 'bilingual');
                  const isMusic = domain === 'music';
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 rounded-[6px] border border-line bg-card p-2.5"
                    >
                      <button
                        type="button"
                        onClick={() => onSelectItem?.(work)}
                        aria-label={`Abrir ficha de ${work.title}`}
                        className="w-12 shrink-0 overflow-hidden rounded-[6px]"
                      >
                        <CoverArt
                          item={work}
                          compact
                          className={`${isMusic ? 'aspect-square' : 'aspect-[2/3]'} w-full rounded-[6px] object-cover`}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => onSelectItem?.(work)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="text-[11px] text-subtle">
                          {domainMeta.tabLabel || domainMeta.shortLabel} · {queueLabel}
                        </p>
                        <p className="font-editorial mt-0.5 truncate text-sm font-semibold text-ink hover:text-accent">
                          {titles.primary}
                        </p>
                        {(work.creator || work.director || work.author || work.releaseYear) && (
                          <p className="truncate text-[11px] tabular-nums text-muted">
                            {[work.creator || work.director || work.author, work.releaseYear]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        )}
                      </button>

                      {onStartPickedWork && (
                        <button
                          type="button"
                          onClick={() => onStartPickedWork(work)}
                          className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-[6px] border border-line bg-app px-3 text-xs font-semibold text-ink hover:border-muted"
                        >
                          <Play className="h-3.5 w-3.5" strokeWidth={1.5} />
                          <span>Começar</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Concluídos recentemente (últimos 5 de qualquer domínio) */}
          {recentlyCompletedEntries.length > 0 && (
            <section aria-label="Concluídos recentemente" className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-muted" strokeWidth={1.5} />
                  <h2 className="text-sm font-semibold tracking-tight text-ink">
                    Concluídos recentemente
                  </h2>
                </div>
                <span className="text-[11px] tabular-nums text-subtle">
                  Últimos {recentlyCompletedEntries.length}
                </span>
              </div>

              <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
                {recentlyCompletedEntries.map((entry) => {
                  const {
                    work,
                    domain,
                    domainMeta,
                    completedLabel,
                    completedDate,
                  } = entry;
                  const titles = getDisplayTitles(work, 'bilingual');
                  const isMusic = domain === 'music';
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => onSelectItem?.(work)}
                      className="group flex w-36 shrink-0 flex-col justify-between text-left"
                    >
                      <div className="relative w-full overflow-hidden rounded-[6px]">
                        <CoverArt
                          item={work}
                          compact
                          className={`${isMusic ? 'aspect-square' : 'aspect-[2/3]'} w-full rounded-[6px] object-cover`}
                        />
                      </div>
                      <div className="mt-2 space-y-0.5">
                        <span className="text-[10px] text-subtle">
                          {domainMeta.tabLabel || domainMeta.shortLabel} · {completedLabel}
                        </span>
                        <p className="font-editorial truncate text-sm font-semibold text-ink group-hover:text-accent">
                          {titles.primary}
                        </p>
                        <StarRatingDisplay work={work} size="sm" showNumeric />
                        {completedDate && (
                          <p className="text-[10px] tabular-nums text-subtle">
                            {completedDate}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      <footer className="pt-2 text-center">
        <button
          type="button"
          onClick={() => setReleaseModalOpen(true)}
          className="inline-flex min-h-[44px] items-center justify-center px-3 text-[11px] tabular-nums underline-offset-2 hover:underline"
          style={{ color: 'var(--text-secondary)' }}
        >
          {domainConfig.appName} · {CODICE_RELEASE.label}
        </button>
      </footer>

      <Suspense fallback={null}>
        {releaseModalOpen && (
          <ReleaseHistoryModal
            isOpen={releaseModalOpen}
            onClose={() => setReleaseModalOpen(false)}
          />
        )}

        {rouletteOpen && (
          <OfflineBookPickerModal
            isOpen={rouletteOpen}
            onClose={() => setRouletteOpen(false)}
            items={items}
            domain={homeFilterDomain}
            readerDna={profile?.readerDna || null}
            onStartReading={onStartPickedWork}
            onSelectItem={onSelectItem}
          />
        )}
      </Suspense>
    </div>
  );
}
