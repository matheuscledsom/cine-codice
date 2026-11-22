import { domainConfig } from '../config/domainConfig.js';
import { formatSecondsToHms, isEpisodicWork } from '../utils/backlogHelpers.js';
import { mapCategoriesToGenreAndSubgenres } from '../utils/genreMapper.js';
import { searchCinemaMedia, searchMockCinema } from './cinemaApi.js';

function inferAtmospheresFromGenres(genres = [], synopsis = '') {
  const blob = [...genres, synopsis].join(' ').toLowerCase();
  const picks = [];
  if (/terror|horror|sombrio|noir|crime|psicol/.test(blob)) picks.push('Sombrio');
  if (/fantasia|epico|aventura|mecha|acao/.test(blob)) picks.push('Épico');
  if (/drama|documentario|biograf|slice/.test(blob)) picks.push('Contemplativo');
  if (/suspense|thriller|misterio/.test(blob)) picks.push('Tenso');
  if (/classico|nostalg/.test(blob)) picks.push('Nostálgico');
  if (/comedia|familia|romance|leve/.test(blob)) picks.push('Leve');
  return picks.length > 0 ? picks.slice(0, 3) : ['Contemplativo'];
}

export async function runLocalSmartCataloging(item = {}, { signal } = {}) {
  const title = String(item.title || '').trim();
  let matched = null;

  if (title) {
    try {
      const apiRes = await searchCinemaMedia(title, {
        filter: item.workType || 'all',
        signal,
      });
      matched = apiRes?.results?.[0] || null;
    } catch {
      // Fallback local abaixo
    }
    if (!matched) {
      matched = searchMockCinema(title, 'all')[0] || null;
    }
  }

  const combinedGenres = Array.from(
    new Set([
      ...(Array.isArray(item.genres) ? item.genres : []),
      ...(Array.isArray(matched?.genres) ? matched.genres : []),
    ])
  ).filter(Boolean);

  const mapped = mapCategoriesToGenreAndSubgenres(combinedGenres, {
    workType: item.workType || matched?.workType || 'movie',
  });

  const resolvedSynopsis =
    String(item.synopsis || '').trim() ||
    String(matched?.synopsis || '').trim() ||
    `${title || 'Obra audiovisual'}${item.director || matched?.director ? ` dirigida por ${item.director || matched.director}` : ''}${item.releaseYear || matched?.releaseYear ? ` (${item.releaseYear || matched.releaseYear})` : ''}.`;

  const updates = {
    synopsis: resolvedSynopsis,
    genres: mapped.genres.slice(0, 4),
    atmosphere:
      Array.isArray(item.atmosphere) && item.atmosphere.length > 0
        ? item.atmosphere
        : inferAtmospheresFromGenres(mapped.genres, resolvedSynopsis),
  };

  if (!item.director && matched?.director) updates.director = matched.director;
  if (!item.studio && matched?.studio) updates.studio = matched.studio;
  if (!item.releaseYear && matched?.releaseYear) updates.releaseYear = matched.releaseYear;
  if (!item.durationMinutes && matched?.durationMinutes) {
    updates.durationMinutes = matched.durationMinutes;
  }
  if (!item.totalEpisodes && matched?.totalEpisodes) {
    updates.totalEpisodes = matched.totalEpisodes;
  }
  if (!item.coverUrl && matched?.coverUrl) updates.coverUrl = matched.coverUrl;

  return { updates, matchedSource: matched?.sourceBadge || 'Local' };
}

export function buildLocalSpoilerFreeRecap({ item = {}, linkedPosts = [] } = {}) {
  const title = item.title || 'Obra selecionada';
  const position = isEpisodicWork(item)
    ? `Temp. ${item.currentSeason || 1} · Ep. ${item.currentEpisode || 0}${item.totalEpisodes ? ` de ${item.totalEpisodes}` : ''}`
    : `Minutagem ${formatSecondsToHms(item.currentSeconds || 0)}${item.totalSeconds ? ` / ${formatSecondsToHms(item.totalSeconds)}` : ''}`;

  const lines = [
    `1. Ponto de Parada: Você está em ${position} de "${title}".`,
    item.checkpoint ? `Cena registrada: ${item.checkpoint}.` : '',
    '',
    '2. Síntese até aqui:',
    item.synopsis
      ? String(item.synopsis).slice(0, 260)
      : 'Use suas notas de sessão para registrar o contexto sem spoilers.',
  ].filter(Boolean);

  const recentQuotes = (Array.isArray(item.quotes) ? item.quotes : []).slice(0, 2);
  if (recentQuotes.length > 0) {
    lines.push('', '3. Falas & Momentos salvos:');
    recentQuotes.forEach((q) => {
      lines.push(`- "${q.text}"${q.location ? ` (${q.location})` : ''}`);
    });
  } else if (Array.isArray(linkedPosts) && linkedPosts.length > 0) {
    lines.push('', '3. Último registro do Diário:');
    lines.push(`- ${linkedPosts[0].title}: ${String(linkedPosts[0].caption || '').slice(0, 140)}`);
  } else {
    lines.push('', `3. Próximo passo: retome ${position} com foco na atmosfera ${domainConfig.appName}.`);
  }

  return lines.join('\n');
}

export function buildLocalReviewOrAbstractSynthesis({
  item = {},
  linkedPosts = [],
} = {}) {
  const title = item.title || 'Obra audiovisual';
  const creator = item.director || item.studio || 'Direção não informada';
  const year = item.releaseYear ? ` (${item.releaseYear})` : '';
  const verdictPart = item.verdict ? ` — Veredito: ${item.verdict}` : '';
  const ratingPart = typeof item.rating === 'number' ? `Nota ${item.rating}/100${verdictPart}` : 'Sem nota definida';

  const blocks = [
    `${title}${year}, de ${creator}. ${ratingPart}.`,
    item.notes ? `Impressões principais: ${String(item.notes).trim()}` : '',
    Array.isArray(item.quotes) && item.quotes.length > 0
      ? `Destaque do cofre: "${item.quotes[0].text}"${item.quotes[0].location ? ` (${item.quotes[0].location})` : ''}.`
      : '',
    Array.isArray(linkedPosts) && linkedPosts.length > 0
      ? `Anotação de sessão: ${String(linkedPosts[0].caption || '').slice(0, 180)}.`
      : '',
  ].filter(Boolean);

  return blocks.join('\n\n');
}
