import { getWatchedMinutes } from './backlogHelpers.js';

export function computePassportStamps({
  items = [],
  posts = [],
  streakCount = 0,
} = {}) {
  const safeItems = (Array.isArray(items) ? items : []).filter(
    (i) => i && i.inBacklog !== false
  );
  const completed = safeItems.filter((i) => i.status === 'completed');
  const totalQuotes = safeItems.reduce(
    (sum, i) => sum + (Array.isArray(i.quotes) ? i.quotes.length : 0),
    0
  );
  const distinctGenres = new Set();
  completed.forEach((i) => {
    if (Array.isArray(i.genres)) {
      i.genres.forEach((g) => {
        const clean = String(g || '').trim().toLowerCase();
        if (clean) distinctGenres.add(clean);
      });
    }
  });
  const totalMinutes = safeItems.reduce((sum, i) => sum + getWatchedMinutes(i), 0);
  const totalHours = Math.round(totalMinutes / 60);

  return [
    {
      id: 'first-codex',
      code: 'CINE-01',
      title: 'Primeiro Bilhete',
      requirement: 'Catalogar ou iniciar 1 obra',
      unlocked: safeItems.length >= 1,
      progressLabel: `${Math.min(1, safeItems.length)}/1`,
    },
    {
      id: 'bronze-shelf',
      code: 'SES-05',
      title: 'Cinco Sessões',
      requirement: 'Concluir 5 filmes, séries ou animes',
      unlocked: completed.length >= 5,
      progressLabel: `${Math.min(5, completed.length)}/5`,
    },
    {
      id: 'silver-archive',
      code: 'ACV-15',
      title: 'Curador de Acervo',
      requirement: 'Concluir 15 obras na cinemateca',
      unlocked: completed.length >= 15,
      progressLabel: `${Math.min(15, completed.length)}/15`,
    },
    {
      id: 'genre-traveler',
      code: 'GEN-04',
      title: 'Viajante de Gêneros',
      requirement: 'Concluir 4 gêneros diferentes',
      unlocked: distinctGenres.size >= 4,
      progressLabel: `${Math.min(4, distinctGenres.size)}/4`,
    },
    {
      id: 'scribe-ink',
      code: 'CRT-03',
      title: 'Crítico de Cabine',
      requirement: 'Registrar 3 diálogos ou críticas',
      unlocked: totalQuotes + (Array.isArray(posts) ? posts.length : 0) >= 3,
      progressLabel: `${Math.min(3, totalQuotes + (Array.isArray(posts) ? posts.length : 0))}/3`,
    },
    {
      id: 'lumiere-24h',
      code: 'MAR-24H',
      title: 'Maratona Lumière',
      requirement: 'Alcançar 24h assistidas ou 7 dias de constância',
      unlocked: totalMinutes >= 1440 || streakCount >= 7,
      progressLabel: totalMinutes >= 1440 ? `${totalHours}h+` : `${streakCount}d`,
    },
  ];
}
