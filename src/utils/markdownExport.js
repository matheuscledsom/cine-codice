import { formatSecondsToHms, isEpisodicWork } from './backlogHelpers.js';

const TYPE_LABELS = {
  movie: 'Filme',
  series: 'Série',
  anime: 'Anime',
};

export function buildWorkMarkdown(item) {
  if (!item || !item.title) return '';
  const lines = [`# ${item.title}`];
  if (item.originalTitle && item.originalTitle !== item.title) {
    lines.push(`*Título original: ${item.originalTitle}*`);
  }
  lines.push('');

  const creator = item.director || item.author;
  if (creator) lines.push(`- **Direção / Criador:** ${creator}`);
  if (item.studio) lines.push(`- **Estúdio / Rede:** ${item.studio}`);
  if (item.releaseYear) lines.push(`- **Ano:** ${item.releaseYear}`);
  if (item.workType) lines.push(`- **Formato:** ${TYPE_LABELS[item.workType] || item.workType}`);
  if (item.status) lines.push(`- **Status:** ${item.status}`);
  if (typeof item.rating === 'number') lines.push(`- **Nota:** ${item.rating}/100`);

  if (isEpisodicWork(item)) {
    const totalEp = item.totalEpisodes > 0 ? item.totalEpisodes : '?';
    lines.push(
      `- **Progresso:** Temp. ${item.currentSeason || 1}/${item.totalSeasons || 1} · Ep. ${item.currentEpisode || 0}/${totalEp}`
    );
  } else {
    const totalSec =
      Number(item.totalSeconds) > 0
        ? Number(item.totalSeconds)
        : Number(item.durationMinutes) > 0
          ? Number(item.durationMinutes) * 60
          : 0;
    if (totalSec > 0 || Number(item.currentSeconds) > 0) {
      lines.push(
        `- **Minutagem:** ${formatSecondsToHms(item.currentSeconds || 0)} / ${formatSecondsToHms(totalSec)}`
      );
    }
  }

  if (Number(item.rewatchCount) > 0) {
    lines.push(`- **Reassistidas:** Rewatch #${item.rewatchCount}`);
  }
  const mediaMeta = [item.format, item.audioFormat].filter(Boolean).join(' · ');
  if (mediaMeta) lines.push(`- **Mídia & Áudio:** ${mediaMeta}`);
  if (item.imdbId) lines.push(`- **IMDb ID:** ${item.imdbId}`);

  if (Array.isArray(item.genres) && item.genres.length > 0) {
    lines.push(`- **Gêneros:** ${item.genres.join(', ')}`);
  }
  if (Array.isArray(item.tags) && item.tags.length > 0) {
    lines.push(`- **Tags:** ${item.tags.map((t) => `#${t.replace(/^#/, '')}`).join(' ')}`);
  }

  if (item.notes) {
    lines.push('', '## Crítica & Impressões de Sessão', '', String(item.notes).trim());
  }

  if (item.fichamento) {
    lines.push('', '## Notas de Direção & Cena', '', String(item.fichamento).trim());
  }

  const quotes = Array.isArray(item.quotes) ? item.quotes : [];
  if (quotes.length > 0) {
    lines.push('', '## Diálogos & Cenas Marcantes');
    quotes.forEach((q) => {
      if (!q?.text) return;
      lines.push('');
      lines.push(`> ${String(q.text).trim()}`);
      if (q.location) lines.push(`— *${q.location}*`);
      if (q.note) lines.push(`Nota: ${q.note}`);
    });
  }

  lines.push('');
  return lines.join('\n');
}

export function downloadWorkMarkdown(item) {
  const md = buildWorkMarkdown(item);
  if (!md || typeof document === 'undefined') return false;
  const slug =
    String(item.title || 'obra')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'obra';

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${slug}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}
