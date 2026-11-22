import { hashString32 } from './dominantColor.js';

export function computeSpineMetrics(item = {}) {
  const workType = item.workType || 'movie';
  const hash = hashString32(`${item.id || ''}:${item.title || ''}:${workType}`);

  const totalMinutes =
    workType === 'movie'
      ? Number(item.durationMinutes) || Math.round((Number(item.totalSeconds) || 6600) / 60)
      : (Number(item.totalEpisodes) || 12) * (Number(item.episodeDurationMinutes) || (workType === 'anime' ? 24 : 45));

  // Fitas VHS / caixas de temporada multi-disco ficam ligeiramente mais largas
  const rawWidth =
    workType === 'movie'
      ? 34 + Math.min(18, Math.round(totalMinutes / 18)) + (hash % 3)
      : 38 + Math.min(24, Math.round(totalMinutes / 90)) + (hash % 3);

  const width = Math.max(32, Math.min(62, rawWidth));
  const baseHeight = workType === 'anime' ? 170 : workType === 'series' ? 186 : 194;
  const height = Math.max(166, Math.min(216, baseHeight + (hash % 18)));

  return { width, height };
}
