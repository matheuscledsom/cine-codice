import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Film,
  Flame,
  GitBranch,
  Palette,
  PauseCircle,
  Play,
  Plus,
  Sparkles,
  Star,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackupReminderBanner } from '../components/BackupReminderBanner';
import { CoverArt } from '../components/CoverArt';
import { HomeRail } from '../components/HomeRail';
import { InstallAppBanner } from '../components/InstallAppBanner';
import { OfflineBookPickerModal } from '../components/OfflineBookPickerModal';
import { RecommendationsSection } from '../components/RecommendationsSection';
import { ReleaseHistoryModal } from '../components/ReleaseHistoryModal';
import { VectorIcon } from '../components/VectorIcon';
import { domainConfig, getWorkTypeConfig } from '../config/domainConfig';
import { CODICE_RELEASE } from '../config/versioning';
import { useToast } from '../context/ToastContext';
import {
  buildCompactStreakChip,
  buildHomeLocalRails,
  buildHomeSessionPills,
  computeHeroAdvancePlan,
  resolveHeroVisual,
  selectHeroPresentation,
  shouldBackfillHeroBackdrop,
} from '../lib/homeEngine';
import { backfillWorkHeroBackdrop } from '../services/cinemaApi';
import { buildMissingFranchiseEntryDraft } from '../services/franchiseEngine';
import { getDisplayTitles } from '../utils/backlogHelpers';

function SessionCircularPill({
  pill,
  disabled = false,
  onTrigger,
}) {
  const { work, progressPct, nextActionLabel } = pill;
  const radius = 25;
  const circumference = 2 * Math.PI * radius;
  const safePct = Math.max(0, Math.min(100, Number(progressPct) || 0));
  const strokeDashoffset = circumference - (safePct / 100) * circumference;

  const cleanCover =
    typeof work?.coverUrl === 'string' && /^(https?:\/\/|data:image\/)/i.test(work.coverUrl.trim())
      ? work.coverUrl.trim().replace(/^http:\/\//i, 'https://')
      : null;

  return (
    <button
      type="button"
      onClick={() => onTrigger(work)}
      disabled={disabled}
      aria-label={`${work.title}: ${nextActionLabel}`}
      title={`${work.title} (${nextActionLabel})`}
      className="group flex w-16 shrink-0 flex-col items-center gap-1 text-center focus:outline-none disabled:opacity-60"
    >
      <div className="relative flex h-14 w-14 items-center justify-center rounded-full">
        <svg
          width="56"
          height="56"
          viewBox="0 0 56 56"
          aria-hidden="true"
          className="absolute inset-0 -rotate-90"
        >
          <circle
            cx="28"
            cy="28"
            r={radius}
            fill="none"
            stroke="var(--border-color)"
            strokeWidth="2.5"
          />
          <circle
            cx="28"
            cy="28"
            r={radius}
            fill="none"
            stroke="var(--accent-color)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
          />
        </svg>
        <div className="h-11 w-11 overflow-hidden rounded-full border border-line bg-card flex items-center justify-center">
          {cleanCover ? (
            <img
              src={cleanCover}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-150 group-hover:scale-105"
            />
          ) : (
            <span className="text-xs font-semibold uppercase text-ink">
              {String(work.title || '?').slice(0, 2)}
            </span>
          )}
        </div>
        <span className="absolute -bottom-1 rounded-full border border-line bg-app px-1.5 py-0.2 text-[9px] font-semibold tabular-nums text-accent">
          {nextActionLabel}
        </span>
      </div>
      <span className="w-full truncate text-[10px] font-medium text-muted group-hover:text-ink">
        {work.title}
      </span>
    </button>
  );
}

export function HomeScreen({
  items = [],
  profile = null,
  streakProps = null,
  readingSessions = [],
  dailyLogs = {},
  resolvedBadgeName = '',
  loading = false,
  tmdbKey = '',
  geminiKey = '',
  backupReminder = null,
  onSaveBackupNow,
  onDismissBackupReminder,
  onQuickAdvanceWork,
  onUpdateItem,
  onStartPickedWork,
  onSelectItem,
  onAddToWishlist,
  onCatalogFranchiseEntry,
  onNavigateList,
  onNavigateAdd,
  onOpenGeminiSettings,
  onOpenThemeStudio,
}) {
  const { showToast } = useToast();
  const { ui, cardFields } = domainConfig;
  const calmMode = Boolean(profile?.calmMode);

  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [rouletteOpen, setRouletteOpen] = useState(false);
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [advancingWorkId, setAdvancingWorkId] = useState(null);
  const [completionPrompt, setCompletionPrompt] = useState(null);

  const backfillAttemptedRef = useRef(new Set());
  const advanceLockRef = useRef(new Map());

  const backlogItems = useMemo(
    () => items.filter((item) => item && item.inBacklog !== false),
    [items]
  );

  const hero = useMemo(
    () => selectHeroPresentation(items, { loading }),
    [items, loading]
  );

  const heroVisual = useMemo(() => {
    if (!hero.work || heroImgFailed) {
      if (heroImgFailed && hero.work) {
        const coverOnly = resolveHeroVisual({ ...hero.work, backdropUrl: null });
        return coverOnly;
      }
      return resolveHeroVisual(hero.work);
    }
    return resolveHeroVisual(hero.work);
  }, [hero.work, heroImgFailed]);

  useEffect(() => {
    setHeroImgFailed(false);
  }, [hero.work?.id, hero.work?.backdropUrl]);

  // Backfill único em segundo plano de backdropUrl (Regra Extra 2: máx 2, sem OMDb, cooldown 30 dias)
  useEffect(() => {
    const candidate = hero.work;
    if (!candidate?.id || !onUpdateItem) return undefined;
    if (backfillAttemptedRef.current.has(candidate.id)) return undefined;
    if (!shouldBackfillHeroBackdrop(candidate)) return undefined;

    backfillAttemptedRef.current.add(candidate.id);
    const controller = new AbortController();

    backfillWorkHeroBackdrop(candidate, {
      tmdbApiKey: tmdbKey,
      signal: controller.signal,
    })
      .then((res) => {
        if (controller.signal.aborted || !res?.attempted) return;
        const patch = {
          backdropCheckedAt: res.checkedAt,
          preserveUpdatedAt: true,
        };
        if (res.backdropUrl) {
          patch.backdropUrl = res.backdropUrl;
        }
        onUpdateItem(candidate.id, patch);
      })
      .catch(() => {
        // Silencioso no fundo — cooldown evita loop
      });

    return () => controller.abort();
  }, [hero.work, tmdbKey, onUpdateItem]);

  const sessionPills = useMemo(
    () => buildHomeSessionPills(items, { maxCount: 12 }),
    [items]
  );

  const localRails = useMemo(
    () =>
      buildHomeLocalRails({
        items,
        readingSessions,
        dailyLogs,
        excludeHeroWorkId: hero.state === 'active' ? hero.work?.id : null,
      }),
    [items, readingSessions, dailyLogs, hero.state, hero.work?.id]
  );

  const streakChip = useMemo(
    () =>
      profile?.gamificationEnabled !== false && !calmMode
        ? buildCompactStreakChip(streakProps)
        : null,
    [profile?.gamificationEnabled, calmMode, streakProps]
  );

  const runProtectedAdvance = (work, { allowCompletion = true } = {}) => {
    if (!work?.id || !onQuickAdvanceWork) return;
    const now = Date.now();
    const lockedUntil = advanceLockRef.current.get(work.id) || 0;
    if (now < lockedUntil) return;

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

    advanceLockRef.current.set(work.id, now + 600);
    setAdvancingWorkId(work.id);
    onQuickAdvanceWork(work, { allowCompletion });
    setTimeout(() => {
      setAdvancingWorkId((curr) => (curr === work.id ? null : curr));
    }, 450);
  };

  const confirmEpisodeAdvance = (markCompleted) => {
    if (!completionPrompt?.work) return;
    const { work } = completionPrompt;
    setCompletionPrompt(null);

    const now = Date.now();
    advanceLockRef.current.set(work.id, now + 600);
    setAdvancingWorkId(work.id);
    onQuickAdvanceWork?.(work, { allowCompletion: markCompleted });
    setTimeout(() => {
      setAdvancingWorkId((curr) => (curr === work.id ? null : curr));
    }, 450);
  };

  const heroAdvancePlan = useMemo(
    () => (hero.work ? computeHeroAdvancePlan(hero.work) : null),
    [hero.work]
  );

  const heroTitles = useMemo(
    () => (hero.work ? getDisplayTitles(hero.work, 'bilingual') : { primary: '', secondary: '' }),
    [hero.work]
  );

  return (
    <div className="space-y-6 pb-8">
      {/* Cabeçalho + Chip compacto de constância */}
      <header className="flex flex-wrap items-start justify-between gap-3 pt-1">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-subtle">
            {ui.home.greetingPrefix}{' '}
            {profile?.displayName || profile?.handle || ui.profile.displayName}
            {profile?.gamificationEnabled !== false &&
              !calmMode &&
              (() => {
                const badgeText =
                  resolvedBadgeName ||
                  (profile?.activeTitleBadge && profile.activeTitleBadge !== 'auto'
                    ? profile.activeTitleBadge
                    : '');
                return badgeText ? (
                  <span className="ml-1.5 inline-flex items-center rounded-[4px] border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                    {badgeText}
                  </span>
                ) : null;
              })()}
          </p>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
              {domainConfig.appName}
            </h1>
            <span className="text-xs font-medium text-muted">
              {domainConfig.appSubtitle}
            </span>
          </div>
          {streakChip && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={streakProps?.onRegisterToday}
                disabled={streakChip.loggedToday}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors ${
                  streakChip.loggedToday
                    ? 'border-accent/40 bg-accent/15 text-accent cursor-default'
                    : 'border-line bg-card text-ink hover:border-accent'
                }`}
              >
                {streakChip.isPaused ? (
                  <PauseCircle className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                ) : streakChip.loggedToday ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                ) : (
                  <Flame className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                )}
                <span>{streakChip.daysLabel}</span>
                {!streakChip.loggedToday && (
                  <span className="text-[11px] font-medium text-accent">
                    · {streakChip.ctaLabel}
                  </span>
                )}
              </button>

              {!streakChip.loggedToday &&
                !streakChip.isRestDayToday &&
                streakChip.count > 0 &&
                streakChip.restDaysRemaining > 0 &&
                streakProps?.onUseRestDay && (
                  <button
                    type="button"
                    onClick={streakProps.onUseRestDay}
                    title="Usar dia de descanso mensal sem perder a sequência"
                    className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-card px-3 text-[11px] font-medium text-muted hover:border-accent hover:text-ink"
                  >
                    Descansar ({streakChip.restDaysRemaining}/2)
                  </button>
                )}
            </div>
          )}
        </div>

        {onOpenThemeStudio && (
          <button
            type="button"
            onClick={onOpenThemeStudio}
            aria-label="Temas e Aparência"
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[4px] border border-line bg-card px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:border-accent hover:text-accent"
          >
            <Palette className="h-4 w-4 text-accent" strokeWidth={1.5} />
            <span className="hidden sm:inline">Temas &amp; Aparência</span>
          </button>
        )}
      </header>

      <InstallAppBanner variant="home" />

      {backupReminder?.shouldRemind && (
        <BackupReminderBanner
          daysWithoutBackup={backupReminder.daysWithoutBackup}
          onSaveBackupNow={onSaveBackupNow}
          onDismiss={onDismissBackupReminder}
        />
      )}

      {/* HERO EM 4 ESTADOS: carregando | ativo | fila Quero Ver | catálogo vazio */}
      {hero.state === 'loading' ? (
        <section
          aria-label="Carregando destaque do catálogo"
          aria-busy="true"
          className="h-56 w-full animate-pulse rounded-[6px] border border-line bg-card"
        />
      ) : hero.state === 'empty' ? (
        <section
          aria-label="Boas-vindas ao catálogo"
          className="rounded-[6px] border border-line bg-card px-5 py-9 text-center"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[4px] border border-line bg-app text-accent">
            <Film className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <h2 className="mt-4 text-base font-semibold tracking-tight text-ink">
            {ui.home.emptyBacklogTitle}
          </h2>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted">
            {ui.home.emptyBacklogDescription}
          </p>
          <button
            type="button"
            onClick={onNavigateAdd}
            className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-[4px] bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            <span>Catalogar Primeira Obra</span>
          </button>
        </section>
      ) : (
        <section
          aria-label="Obra em destaque"
          className="relative overflow-hidden rounded-[6px] border border-line bg-card"
        >
          {/* Fundo visual do Hero: backdropUrl > capa borrada > gradiente do tema */}
          {heroVisual.mode === 'backdrop' && heroVisual.imageUrl ? (
            <img
              src={heroVisual.imageUrl}
              alt=""
              onError={() => setHeroImgFailed(true)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : heroVisual.mode === 'blurred-cover' && heroVisual.imageUrl ? (
            <img
              src={heroVisual.imageUrl}
              alt=""
              onError={() => setHeroImgFailed(true)}
              className="absolute inset-0 h-full w-full scale-110 object-cover blur-md opacity-70"
            />
          ) : (
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(135deg, var(--accent-color) 0%, var(--bg-app) 100%)',
                opacity: 0.35,
              }}
            />
          )}

          {/* Scrim escuro >= 70% para garantir contraste WCAG AA sobre qualquer imagem (R3) */}
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(10, 12, 16, 0.72) 0%, rgba(10, 12, 16, 0.84) 55%, rgba(10, 12, 16, 0.94) 100%)',
            }}
          />

          <div className="relative z-10 flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:p-5 text-white">
            <button
              type="button"
              onClick={() => onSelectItem?.(hero.work)}
              aria-label={`Abrir ficha de ${hero.work.title}`}
              className="w-20 sm:w-24 shrink-0 self-start rounded-[4px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <CoverArt
                item={hero.work}
                compact
                priority
                className="w-full rounded-[4px]"
              />
            </button>

            <div className="min-w-0 flex-1 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-white/90">
                <span className="inline-flex items-center gap-1.5">
                  <VectorIcon
                    name={getWorkTypeConfig(hero.work.workType).icon}
                    className="h-3.5 w-3.5 text-white"
                  />
                  <span>
                    {hero.state === 'queued'
                      ? 'Sugestão da Fila Quero Ver'
                      : getWorkTypeConfig(hero.work.workType).shortLabel}
                    {hero.work.audioFormat ? ` · ${hero.work.audioFormat}` : ''}
                  </span>
                </span>
                {hero.hasKnownTotal && typeof hero.progressPct === 'number' && (
                  <span className="tabular-nums font-semibold">
                    {hero.progressPct}%
                  </span>
                )}
              </div>

              <div>
                <h2 className="line-clamp-2 text-base sm:text-lg font-semibold leading-snug text-white">
                  {heroTitles.primary}
                </h2>
                {heroTitles.secondary && (
                  <p className="mt-0.5 truncate text-xs italic text-white/80">
                    {heroTitles.secondary}
                  </p>
                )}
                {(hero.work.director || hero.work.studio) && (
                  <p className="mt-0.5 truncate text-xs text-white/80">
                    {hero.work.director || hero.work.studio}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs tabular-nums text-white/90">
                  <span>{hero.progressLabel}</span>
                  {Number(hero.work.rewatchCount) > 0 && (
                    <span>Rewatch #{hero.work.rewatchCount}</span>
                  )}
                </div>
                {hero.hasKnownTotal && typeof hero.progressPct === 'number' && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/25">
                    <div
                      className="h-full transition-all duration-150"
                      style={{
                        width: `${Math.min(100, hero.progressPct)}%`,
                        backgroundColor: 'var(--accent-color)',
                      }}
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {hero.state === 'queued' && onStartPickedWork ? (
                  <button
                    type="button"
                    onClick={() => onStartPickedWork(hero.work)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90"
                  >
                    <Play className="h-4 w-4" strokeWidth={1.5} />
                    <span>Começar</span>
                  </button>
                ) : hero.state === 'active' && heroAdvancePlan && onQuickAdvanceWork ? (
                  <button
                    type="button"
                    disabled={advancingWorkId === hero.work.id}
                    onClick={() => runProtectedAdvance(hero.work, { allowCompletion: true })}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] bg-accent px-4 py-2 text-xs font-semibold tabular-nums text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    <Plus className="h-4 w-4" strokeWidth={1.5} />
                    <span>
                      {heroAdvancePlan.actionLabel}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectItem?.(hero.work)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90"
                  >
                    <Play className="h-4 w-4" strokeWidth={1.5} />
                    <span>{ui.home.resumeLabel}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onSelectItem?.(hero.work)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-white/40 bg-black/50 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-black/75"
                >
                  <span>Ficha</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

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

      {/* Pílulas de sessão: avatares circulares >= 44px (56px) com anel de progresso, máx 12 + "ver todas" */}
      {sessionPills.pills.length > 0 && (
        <section aria-label="Pílulas rápidas de sessão" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">
              Toque Rápido de Sessão
            </h2>
            {sessionPills.hasMore && onNavigateList && (
              <button
                type="button"
                onClick={onNavigateList}
                className="inline-flex min-h-[44px] items-center gap-1 px-2 text-xs font-semibold text-accent hover:opacity-80"
              >
                <span>Ver todas ({sessionPills.totalCount})</span>
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            )}
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
            {sessionPills.pills.map((pill) => (
              <SessionCircularPill
                key={pill.id}
                pill={pill}
                disabled={advancingWorkId === pill.id}
                onTrigger={(work) => runProtectedAdvance(work, { allowCompletion: true })}
              />
            ))}
          </div>
        </section>
      )}

      {/* Trilho 1: Continuar Assistindo */}
      {backlogItems.length > 0 && (
        <HomeRail
          title="Continuar Assistindo"
          icon={Play}
          count={localRails.continueWatching.length}
          isEmpty={localRails.continueWatching.length === 0}
          hideWhenEmpty
        >
          {localRails.continueWatching.map((entry) => {
            const { work, progressPct, metricLabel, confirmedRating } = entry;
            const titles = getDisplayTitles(work, 'bilingual');

            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelectItem?.(work)}
                className="group flex w-36 sm:w-40 shrink-0 snap-start flex-col justify-between rounded-[6px] border border-line bg-card p-2 text-left transition-colors hover:border-accent/50"
              >
                <div className="relative aspect-[2/3] w-full overflow-hidden rounded-[4px]">
                  <CoverArt
                    item={work}
                    compact
                    className="h-full w-full object-cover"
                  />
                  {confirmedRating !== null && (
                    <span className="absolute right-1.5 top-1.5 rounded-[4px] border border-line bg-black/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
                      {confirmedRating}
                    </span>
                  )}
                </div>
                <div className="mt-2 w-full space-y-1">
                  <p className="truncate text-xs font-semibold text-ink group-hover:text-accent">
                    {titles.primary}
                  </p>
                  <div className="flex items-center justify-between gap-1 text-[10px] tabular-nums text-muted">
                    <span className="truncate">{metricLabel}</span>
                    {entry.hasKnownTotal && typeof progressPct === 'number' && (
                      <span className="font-semibold text-accent">{progressPct}%</span>
                    )}
                  </div>
                  {entry.hasKnownTotal && typeof progressPct === 'number' && (
                    <div className="h-[3px] w-full overflow-hidden rounded-[2px] bg-line">
                      <div
                        className="h-full transition-all duration-150"
                        style={{
                          width: `${Math.min(100, progressPct)}%`,
                          backgroundColor: 'var(--accent-color)',
                        }}
                      />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </HomeRail>
      )}

      {/* Trilho 2: Franquias & Sagas (oculto sem franquia >= 2 obras) */}
      {backlogItems.length > 0 && (
        <HomeRail
          title="Franquias & Sagas"
          icon={GitBranch}
          count={localRails.franchises.length}
          isEmpty={localRails.franchises.length === 0}
          hideWhenEmpty
        >
          {localRails.franchises.map((fr) => (
            <div
              key={fr.id}
              className="flex w-64 shrink-0 snap-start flex-col justify-between gap-2.5 rounded-[6px] border border-line bg-card p-3"
            >
              <button
                type="button"
                onClick={() => onSelectItem?.(fr.representativeItem)}
                className="flex items-start gap-2.5 text-left"
              >
                <div className="aspect-[2/3] w-14 shrink-0 overflow-hidden rounded-[4px]">
                  <CoverArt
                    item={fr.representativeItem}
                    compact
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-xs font-semibold text-ink">{fr.name}</p>
                  <p className="truncate text-[10px] text-muted">
                    {fr.director || getWorkTypeConfig(fr.workType).shortLabel}
                  </p>
                  <p className="text-[11px] font-semibold tabular-nums text-accent">
                    {fr.completedCount}/{fr.totalCount} concluídas · {fr.completionPct}%
                  </p>
                  {fr.averageRating !== null && (
                    <p className="text-[10px] font-medium tabular-nums text-ink">
                      Média da saga: {fr.averageRating}/100
                    </p>
                  )}
                </div>
              </button>

              <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                <div
                  className="h-full bg-accent transition-all duration-300"
                  style={{ width: `${fr.completionPct}%` }}
                />
              </div>

              {fr.nextMissingEntry && onCatalogFranchiseEntry ? (
                <button
                  type="button"
                  onClick={() => {
                    const draft = buildMissingFranchiseEntryDraft(fr, fr.nextMissingEntry);
                    if (draft) {
                      onCatalogFranchiseEntry(draft);
                      showToast({
                        message: `"${fr.nextMissingEntry.title}" adicionado à fila Quero Ver.`,
                        type: 'success',
                      });
                    }
                  }}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[4px] border border-accent bg-accent/10 px-2.5 py-1.5 text-[11px] font-semibold text-accent transition-colors hover:bg-accent hover:text-accent-ink"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                  <span className="truncate">+ Catalogar: {fr.nextMissingEntry.title}</span>
                </button>
              ) : (
                <span className="inline-flex min-h-[44px] items-center justify-center rounded-[4px] border border-line bg-app px-2.5 text-[11px] font-medium text-muted">
                  Cronologia completa
                </span>
              )}
            </div>
          ))}
        </HomeRail>
      )}

      {/* Trilho 3: Sugestões do DNA / Quero Ver + botão "O que assistir hoje?" (Roleta) + Curador opcional */}
      {backlogItems.length > 0 && (
        <RecommendationsSection
          items={items}
          profile={profile}
          tmdbKey={tmdbKey}
          geminiKey={geminiKey}
          onAddToWishlist={onAddToWishlist}
          onSelectItem={onSelectItem}
          onNavigateAdd={onNavigateAdd}
          onOpenRoulette={() => setRouletteOpen(true)}
          onOpenGeminiSettings={onOpenGeminiSettings}
        />
      )}

      {/* Trilho 4: Cápsula do Tempo & Destaques (oculto se vazio) */}
      {backlogItems.length > 0 && (
        <HomeRail
          title="Cápsula do Tempo & Destaques"
          icon={Sparkles}
          count={localRails.highlights.length}
          isEmpty={localRails.highlights.length === 0}
          hideWhenEmpty
          headerAction={
            onNavigateList && (
              <button
                type="button"
                onClick={onNavigateList}
                className="inline-flex min-h-[44px] items-center gap-1 px-2 text-xs font-medium text-accent hover:opacity-80"
              >
                <span>{ui.home.seeAllLabel}</span>
                <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
              </button>
            )
          }
        >
          {localRails.highlights.map((entry) => (
            <button
              key={entry.id}
              type="button"
              disabled={!entry.work}
              onClick={() => entry.work && onSelectItem?.(entry.work)}
              className="group flex w-40 sm:w-44 shrink-0 snap-start flex-col justify-between gap-2 rounded-[6px] border border-line bg-card p-2.5 text-left transition-colors hover:border-accent/50 disabled:cursor-default"
            >
              {entry.work && (
                <div className="relative aspect-[2/3] w-full overflow-hidden rounded-[4px]">
                  <CoverArt
                    item={entry.work}
                    compact
                    className="h-full w-full object-cover"
                  />
                  {entry.work.isPlatinum && (
                    <span
                      aria-label="Obra-Prima"
                      className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-accent/50 bg-black/80 text-accent"
                    >
                      <Star className="h-3.5 w-3.5 fill-current" strokeWidth={1.5} />
                    </span>
                  )}
                  {entry.confirmedRating !== null && (
                    <span className="absolute right-1.5 top-1.5 rounded-[4px] border border-line bg-black/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
                      {entry.confirmedRating}
                    </span>
                  )}
                </div>
              )}

              <div className="w-full space-y-1">
                <div className="flex items-center justify-between gap-1 text-[10px] tabular-nums">
                  <span className="inline-flex items-center gap-1 font-semibold text-accent">
                    <CalendarClock className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                    <span className="truncate">{entry.badgeLabel}</span>
                  </span>
                  {entry.dateIso && <span className="text-subtle">{entry.dateIso}</span>}
                </div>
                <p className="truncate text-xs font-semibold text-ink group-hover:text-accent">
                  {entry.title}
                </p>
                {entry.subtitle && (
                  <p className="truncate text-[10px] text-muted">{entry.subtitle}</p>
                )}
                {entry.quoteText && (
                  <p className="line-clamp-2 border-l-2 border-accent/50 pl-2 text-[10px] italic text-subtle">
                    “{entry.quoteText}”
                  </p>
                )}
              </div>
            </button>
          ))}
        </HomeRail>
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

      <ReleaseHistoryModal
        isOpen={releaseModalOpen}
        onClose={() => setReleaseModalOpen(false)}
      />

      <OfflineBookPickerModal
        isOpen={rouletteOpen}
        onClose={() => setRouletteOpen(false)}
        items={items}
        readerDna={profile?.readerDna || null}
        onStartReading={onStartPickedWork}
        onSelectItem={onSelectItem}
      />
    </div>
  );
}
