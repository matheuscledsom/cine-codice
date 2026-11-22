import { diffCalendarDays, getTodayLocalISO } from './backlogHelpers.js';
import { toLocalIsoDate } from './readingCheckIn.js';

const MILESTONE_DAYS = [30, 90, 180];

export function buildTimeCapsuleEntries({
  items = [],
  readingSessions = [],
  dailyLogs = {},
  referenceDate = null,
} = {}) {
  const refIso = toLocalIsoDate(referenceDate) || getTodayLocalISO();
  const [refYearStr, refMonthStr, refDayStr] = refIso.split('-');
  const refYear = Number(refYearStr);
  const refMonthDay = `${refMonthStr}-${refDayStr}`;

  const itemMap = new Map(
    (Array.isArray(items) ? items : [])
      .filter((i) => i && i.id)
      .map((i) => [String(i.id), i])
  );

  const candidates = [];
  const seenKeys = new Set();

  const pushCandidate = ({ dateIso, work = null, subtitle, quoteText = '' }) => {
    const iso = toLocalIsoDate(dateIso);
    if (!iso || iso >= refIso) return;

    const year = Number(iso.slice(0, 4));
    const md = iso.slice(5, 10);
    const diffDays = diffCalendarDays(iso, refIso);

    let kind = null;
    let badgeLabel = '';

    if (year < refYear && md === refMonthDay) {
      const yearsAgo = refYear - year;
      kind = 'anniversary';
      badgeLabel =
        yearsAgo === 1 ? 'Há 1 ano neste dia' : `Há ${yearsAgo} anos neste dia`;
    } else if (MILESTONE_DAYS.includes(diffDays)) {
      kind = 'milestone';
      badgeLabel = `Há ${diffDays} dias`;
    }

    if (!kind) return;

    const dedupeKey = `${kind}:${work?.id || 'log'}:${iso}`;
    if (seenKeys.has(dedupeKey)) return;
    seenKeys.add(dedupeKey);

    candidates.push({
      id: dedupeKey,
      kind,
      priority: kind === 'anniversary' ? 0 : 1,
      workId: work?.id || null,
      work,
      title: work?.title || 'Sessão registrada',
      subtitle,
      badgeLabel,
      dateIso: iso,
      quoteText: quoteText || '',
    });
  };

  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!item || item.inBacklog === false) return;
    const creator = item.director || item.author || item.studio || '';
    if (item.completedDate) {
      pushCandidate({
        dateIso: item.completedDate,
        work: item,
        subtitle: creator ? `Sessão concluída · ${creator}` : 'Sessão concluída',
      });
    } else if (item.startDate) {
      pushCandidate({
        dateIso: item.startDate,
        work: item,
        subtitle: creator ? `Iniciado · ${creator}` : 'Sessão iniciada',
      });
    } else if (item.createdAt) {
      pushCandidate({
        dateIso: item.createdAt,
        work: item,
        subtitle: 'Catalogado na sua estante',
      });
    }

    if (Array.isArray(item.quotes)) {
      item.quotes.forEach((q) => {
        if (q?.createdAt && q?.text) {
          pushCandidate({
            dateIso: q.createdAt,
            work: item,
            subtitle: q.location ? `Diálogo · ${q.location}` : 'Cena salva no cofre',
            quoteText: q.text,
          });
        }
      });
    }
  });

  (Array.isArray(readingSessions) ? readingSessions : []).forEach((s) => {
    const work = s?.workId ? itemMap.get(String(s.workId)) || null : null;
    const ep = Number(s?.episodesWatched) || 0;
    const min = Number(s?.minutesWatched ?? s?.pagesRead) || 0;
    let subtitle = 'Sessão de cinema registrada';
    if (ep > 0) subtitle = `Sessão com ${ep} episódio(s)`;
    else if (min > 0) subtitle = `Sessão de ${min} min`;
    pushCandidate({
      dateIso: s?.endedAt || s?.startedAt || s?.createdAt,
      work,
      subtitle,
      quoteText: s?.notes || '',
    });
  });

  if (dailyLogs && typeof dailyLogs === 'object') {
    Object.entries(dailyLogs).forEach(([iso, entry]) => {
      if (!entry || typeof entry !== 'object') return;
      const firstNote = Array.isArray(entry.notes) ? entry.notes[0] : '';
      if (firstNote || Number(entry.standalonePages) > 0) {
        pushCandidate({
          dateIso: iso,
          work: null,
          subtitle:
            Number(entry.standalonePages) > 0
              ? `${entry.standalonePages} min no diário de sessões`
              : 'Impressão no diário de cinema',
          quoteText: firstNote || '',
        });
      }
    });
  }

  return candidates
    .sort((a, b) => a.priority - b.priority || b.dateIso.localeCompare(a.dateIso))
    .slice(0, 4);
}
