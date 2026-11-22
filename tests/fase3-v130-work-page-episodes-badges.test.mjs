import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  computeJikanEpisodeBlocks,
  resolveEpisodeJumpTarget,
} from '../src/lib/episodeStats.js';
import {
  computeCritiqueComparisonBadge,
  computeWorkCritiqueBadge,
} from '../src/lib/ratingBadges.js';
import { fetchJikanEpisodes } from '../src/services/cinemaApi.js';
import {
  calibrateWorkPaletteOklch,
  getWorkAdaptivePaletteSync,
} from '../src/utils/colorExtractor.js';

test('Fase 3 (v1.3.0): Paleta Adaptativa por Obra gera --work-accent e --work-glow com contraste WCAG 2.2 AA (>= 4.5:1)', () => {
  const sampleWorks = [
    {
      id: 'w-1',
      title: 'Blade Runner 2049',
      coverUrl: 'https://image.tmdb.org/t/p/w500/br2049.jpg',
      genres: ['Ficção Científica', 'Noir'],
    },
    {
      id: 'w-2',
      title: 'One Piece',
      coverUrl: 'https://cdn.myanimelist.net/images/anime/6/73245.jpg',
      genres: ['Aventura', 'Ação'],
    },
  ];

  for (const mode of ['dark', 'white', 'sepia']) {
    for (const work of sampleWorks) {
      const palette = getWorkAdaptivePaletteSync(work, { mode });
      assert.ok(palette.workAccent.startsWith('#'));
      assert.ok(palette.workGlow.startsWith('rgba('));
      assert.ok(
        palette.contrastRatio >= 4.5,
        `Contraste insuficiente (${palette.contrastRatio}) em modo ${mode} para ${work.title}`
      );
    }
  }

  const extreme = calibrateWorkPaletteOklch('#FFFF00', '#00FFFF', { mode: 'white' });
  assert.ok(extreme.contrastRatio >= 4.5);

  const workPageSrc = fs.readFileSync(
    path.resolve('src/components/WorkDetailPage.jsx'),
    'utf8'
  );
  assert.ok(workPageSrc.includes('--work-accent'));
  assert.ok(workPageSrc.includes('--work-glow'));
  assert.ok(workPageSrc.includes('blur(32px)'));
});

test('Fase 3 (v1.3.0): Paginação Jikan por blocos de 100 episódios (One Piece) e salto direto para episódio 1015', async () => {
  const blocks = computeJikanEpisodeBlocks(1122, 12);
  assert.equal(blocks.length, 12);
  assert.equal(blocks[0].label, '1–100');
  assert.equal(blocks[1].label, '101–200');
  assert.equal(blocks[10].label, '1001–1100');
  assert.equal(blocks[11].label, '1101–1122');

  const jump1015 = resolveEpisodeJumpTarget(1015, {
    totalEpisodes: 1122,
    lastVisiblePage: 12,
  });
  assert.equal(jump1015.page, 11);
  assert.equal(jump1015.blockIndex, 10);
  assert.equal(jump1015.label, '1001–1100');
  assert.equal(jump1015.episodeNumber, 1015);

  const mockJikanFetch = async (url) => {
    assert.ok(String(url).includes('/anime/21/episodes?page=11'));
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        pagination: {
          last_visible_page: 12,
          has_next_page: true,
        },
        data: [
          {
            mal_id: 1015,
            title: 'Straw Hat Luffy! The Man Who Will Become the King of the Pirates!',
            aired: '2022-04-24T00:00:00+00:00',
            score: 4.92,
            filler: false,
            recap: false,
          },
          {
            mal_id: 1030,
            title: 'A Pledge for the New Genesis! Luffy and Uta',
            aired: '2022-08-21T00:00:00+00:00',
            score: 4.1,
            filler: true,
            recap: false,
          },
        ],
      }),
    };
  };

  const page11 = await fetchJikanEpisodes(21, {
    page: 11,
    fetchImpl: mockJikanFetch,
  });
  assert.equal(page11.page, 11);
  assert.equal(page11.lastVisiblePage, 12);
  assert.equal(page11.hasNextPage, true);
  assert.equal(page11.episodes.length, 2);
  assert.equal(page11.episodes[0].number, 1015);
  assert.equal(
    page11.episodes[0].title,
    'Straw Hat Luffy! The Man Who Will Become the King of the Pirates!'
  );
  assert.equal(page11.episodes[0].filler, false);
  assert.equal(page11.episodes[1].number, 1030);
  assert.equal(page11.episodes[1].filler, true);
});

test('Fase 3 (v1.3.0): Selos Comparativos ("Sua Nota vs. Público") calculam os 4 arquétipos com precisão', () => {
  // 1. Obra-Prima Consensual (ambos >= 88)
  const masterpiece = computeCritiqueComparisonBadge(94, 91);
  assert.equal(masterpiece.id, 'consensus-masterpiece');
  assert.equal(masterpiece.label, 'Obra-Prima Consensual');
  assert.equal(masterpiece.detail, 'Você 94 · Público 91');

  // 2. Sintonia Total (diferença <= 5 pts)
  const harmony = computeCritiqueComparisonBadge(82, 79);
  assert.equal(harmony.id, 'total-harmony');
  assert.equal(harmony.label, 'Sintonia Total');
  assert.equal(harmony.detail, 'Você 82 · Público 79');

  // 3. Você Amou Mais que o Público (sua nota >= +12 pts acima do público)
  const lovedMore = computeCritiqueComparisonBadge(92, 76);
  assert.equal(lovedMore.id, 'loved-more');
  assert.equal(lovedMore.label, 'Você Amou Mais que o Público');
  assert.equal(lovedMore.detail, 'Você 92 · Público 76');

  // 4. Mais Exigente que a Crítica (sua nota <= -12 pts abaixo do público)
  const moreDemanding = computeCritiqueComparisonBadge(64, 85);
  assert.equal(moreDemanding.id, 'more-demanding');
  assert.equal(moreDemanding.label, 'Mais Exigente que a Crítica');
  assert.equal(moreDemanding.detail, 'Você 64 · Público 85');

  // Ignora legacy-default
  const legacy = computeWorkCritiqueBadge({
    rating: 80,
    ratingSource: 'legacy-default',
    publicScore: 80,
  });
  assert.equal(legacy, null);
});
