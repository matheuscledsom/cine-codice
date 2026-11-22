import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  computeSpectatorMetrics,
  formatDecadeLabel,
} from '../src/lib/statsEngine.js';

describe('FASE 4 (v1.2.0) — Métricas Acumuladas de Espectador (Foco em Horas, Episódios & Décadas)', () => {
  it('computeSpectatorMetrics calcula horas assistidas, dias equivalentes, episódios, distribuição por formato e décadas', () => {
    const items = [
      {
        id: 'm-1',
        title: 'Blade Runner 2049',
        workType: 'movie',
        status: 'completed',
        releaseYear: 2017,
        durationMinutes: 164,
        totalSeconds: 164 * 60,
        director: 'Denis Villeneuve',
        genres: ['Ficção Científica', 'Suspense & Thriller'],
        rating: 94,
        ratingSource: 'manual',
      },
      {
        id: 'm-2',
        title: 'Duna',
        workType: 'movie',
        status: 'completed',
        releaseYear: 2021,
        durationMinutes: 155,
        totalSeconds: 155 * 60,
        director: 'Denis Villeneuve',
        genres: ['Ficção Científica'],
        rating: 80,
        ratingSource: 'legacy-default', // deve ser ignorada na média
      },
      {
        id: 's-1',
        title: 'Dark',
        workType: 'series',
        status: 'completed',
        releaseYear: 2017,
        totalSeasons: 3,
        totalEpisodes: 26,
        currentEpisode: 26,
        episodeDurationMinutes: 55,
        director: 'Baran bo Odar',
        genres: ['Ficção Científica', 'Drama'],
        rating: 96,
        ratingSource: 'manual',
      },
      {
        id: 'a-1',
        title: 'Cowboy Bebop',
        workType: 'anime',
        status: 'playing',
        releaseYear: 1998,
        totalSeasons: 1,
        totalEpisodes: 26,
        currentEpisode: 10,
        episodeDurationMinutes: 24,
        studio: 'Sunrise',
        genres: ['Ficção Científica', 'Animação'],
      },
    ];

    const m = computeSpectatorMetrics(items);

    // Total de obras e concluídas (absoluto)
    assert.equal(m.totalCount, 4);
    assert.equal(m.completedCount, 3);
    assert.equal(m.inProgressCount, 1);

    // Episódios: 26 (Dark) + 10 (Bebop) = 36
    assert.equal(m.episodesWatched, 36);

    // Minutos: 164 + 155 + (26*55=1430) + (10*24=240) = 1989 min -> 33.2 h -> ~1.4 dias
    assert.equal(m.watchedMinutes, 1989);
    assert.equal(m.watchedHours, 33.2);
    assert.equal(m.equivalentDays, 1.4);

    // Média ignora legacy-default (80) e considera só 94 e 96 -> 95/100
    assert.equal(m.avgRatingValue, 95);
    assert.equal(m.avgRating, '95/100');

    // Distribuição por formato
    const movieFmt = m.formatDistribution.find((f) => f.id === 'movie');
    const seriesFmt = m.formatDistribution.find((f) => f.id === 'series');
    const animeFmt = m.formatDistribution.find((f) => f.id === 'anime');
    assert.equal(movieFmt.count, 2);
    assert.equal(movieFmt.watchedMinutes, 319);
    assert.equal(seriesFmt.count, 1);
    assert.equal(seriesFmt.episodesWatched, 26);
    assert.equal(animeFmt.count, 1);
    assert.equal(animeFmt.episodesWatched, 10);

    // Linha do tempo por década
    assert.equal(formatDecadeLabel(1990), 'Anos 90');
    assert.equal(formatDecadeLabel(2010), 'Anos 2010');
    assert.equal(m.decadeDistribution.length, 3); // 1990, 2010, 2020
    assert.equal(m.topDecade.decade, 2010);
    assert.equal(m.topDecade.label, 'Anos 2010');

    // Top Diretores / Estúdios e Gêneros por horas acumuladas
    assert.equal(m.topCreators[0].label, 'Baran bo Odar'); // 1430 min (23.8h)
    assert.equal(m.topCreators[1].label, 'Denis Villeneuve'); // 319 min (5.3h, 2 obras)
    assert.equal(m.topGenres[0].label, 'Ficção Científica');
  });

  it('StatsScreen remove métricas de cobrança ("Taxa de Conclusão" e "Média p/ concluir") e usa tabular-nums', () => {
    const src = fs.readFileSync(path.resolve('src/screens/StatsScreen.jsx'), 'utf8');
    assert.equal(/Taxa de Conclusão|completionRateTitle|Média p\/ concluir/i.test(src), false);
    assert.match(src, /Tempo Acumulado em Tela/);
    assert.match(src, /Linha do Tempo por Década/);
    assert.match(src, /Distribuição por Formato \(Horas &amp; Títulos\)/);
    assert.match(src, /tabular-nums/);
    assert.equal(/[★✓✕]/u.test(src), false);
  });
});
