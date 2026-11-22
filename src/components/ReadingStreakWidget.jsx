import { CalendarCheck, CheckCircle2, Flame, PauseCircle } from 'lucide-react';
import { getTodayLocalISO } from '../utils/backlogHelpers';

function getRecentSevenDays() {
  const days = [];
  const base = new Date();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const d = new Date(base);
    d.setDate(base.getDate() - offset);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    days.push(`${year}-${month}-${day}`);
  }
  return days;
}

export function ReadingStreakWidget({
  streakCount = 0,
  loggedToday = false,
  isPaused = false,
  history = [],
  restDaysRemaining = 2,
  isRestDayToday = false,
  onUseRestDay,
  onRegisterToday,
}) {
  const today = getTodayLocalISO();
  const recentDays = getRecentSevenDays();
  const historySet = new Set(history);

  const daysLabel =
    streakCount === 1 ? '1 dia seguido' : `${streakCount} dias seguidos`;

  const subtitle = isRestDayToday
    ? 'Dia de descanso gentil ativado — sequência preservada'
    : loggedToday
      ? 'Sessão de hoje registrada'
      : isPaused
        ? 'Mesmo 5 minutos hoje retomam o seu ritmo'
        : streakCount > 0
          ? 'Um episódio ou filme hoje mantém sua constância sem pressa'
          : 'Comece no seu ritmo — até 5 minutos de sessão contam hoje';

  return (
    <section
      aria-label="Constância de Sessões"
      className="rounded-2xl border border-line bg-card p-3.5"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
              loggedToday || streakCount > 0
                ? 'border-accent/40 bg-accent/15 text-accent'
                : 'border-line bg-app text-subtle'
            }`}
          >
            {isPaused ? (
              <PauseCircle className="h-5 w-5 text-accent" strokeWidth={2} />
            ) : (
              <Flame className="h-5 w-5" strokeWidth={2} />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold tracking-tight text-ink">
                {daysLabel}
              </p>
              {isPaused && (
                <span className="rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium text-accent">
                  Pausado
                </span>
              )}
            </div>
            <p className="truncate text-[11px] text-muted">{subtitle}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {!loggedToday && !isRestDayToday && streakCount > 0 && restDaysRemaining > 0 && onUseRestDay && (
            <button
              type="button"
              onClick={onUseRestDay}
              title="Usar 1 dos 2 dias de descanso mensais sem perder a sequência"
              className="inline-flex min-h-[40px] items-center rounded-[4px] border border-line bg-app px-2.5 py-1.5 text-[11px] font-medium text-muted hover:border-accent hover:text-ink"
            >
              Descansar ({restDaysRemaining}/2)
            </button>
          )}
          <button
            type="button"
            onClick={onRegisterToday}
            disabled={loggedToday}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-semibold transition-all ${
              loggedToday
                ? 'border border-accent/40 bg-accent/15 text-accent cursor-default'
                : 'bg-accent text-accent-ink shadow-xs hover:opacity-90'
            }`}
          >
            {loggedToday ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Registrado
              </>
            ) : (
              <>
                <CalendarCheck className="h-3.5 w-3.5" strokeWidth={1.5} />
                Registrar Sessão Hoje
              </>
            )}
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-line/70 pt-2.5">
        <span className="text-[10px] font-medium text-subtle">
          Constância (últimos 7 dias)
        </span>
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {recentDays.map((iso) => {
            const active = historySet.has(iso);
            const isToday = iso === today;
            return (
              <span
                key={iso}
                title={iso}
                className={`h-2 w-2 rounded-full transition-colors ${
                  active
                    ? 'bg-accent'
                    : isToday
                      ? 'border border-accent/60 bg-transparent'
                      : 'bg-line'
                }`}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
