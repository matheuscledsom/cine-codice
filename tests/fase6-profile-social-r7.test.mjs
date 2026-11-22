import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { SOCIAL_ENABLED } from '../src/config/flags.js';
import {
  computeProfileMetrics,
  formatWatchedHoursLabel,
  resolveProfileHeroBackdrop,
} from '../src/lib/profileMetrics.js';

const ROOT = process.cwd();

function readSrc(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('Fase 6 — Perfil, social oculto (SOCIAL_ENABLED) e limpeza R7', () => {
  it('resolveProfileHeroBackdrop escolhe backdropUrl da obra em andamento mais recente e cai para null sem obra ativa', () => {
    const items = [
      {
        id: 'completed-1',
        title: 'Concluído',
        status: 'completed',
        backdropUrl: 'https://image.tmdb.org/t/p/w780/completed.jpg',
        updatedAt: '2026-11-20T10:00:00Z',
      },
      {
        id: 'playing-old',
        title: 'Série Antiga',
        status: 'playing',
        backdropUrl: 'http://image.tmdb.org/t/p/w780/old.jpg',
        updatedAt: '2026-11-18T10:00:00Z',
      },
      {
        id: 'rewatch-new',
        title: 'Blade Runner 2049',
        status: 'rewatching',
        backdropUrl: 'https://image.tmdb.org/t/p/w780/br2049.jpg',
        updatedAt: '2026-11-21T15:00:00Z',
      },
      {
        id: 'playing-no-backdrop',
        title: 'Sem Backdrop',
        status: 'playing',
        backdropUrl: '',
        updatedAt: '2026-11-22T15:00:00Z',
      },
    ];

    const hero = resolveProfileHeroBackdrop(items);
    assert.deepEqual(hero, {
      workId: 'rewatch-new',
      title: 'Blade Runner 2049',
      backdropUrl: 'https://image.tmdb.org/t/p/w780/br2049.jpg',
    });

    assert.equal(
      resolveProfileHeroBackdrop([
        { id: 'q1', title: 'Fila', status: 'queued', backdropUrl: 'https://example.com/a.jpg' },
        { id: 'p1', title: 'Sem URL', status: 'playing', backdropUrl: '' },
      ]),
      null
    );
  });

  it('computeProfileMetrics calcula Obras, Episódios/Horas (excluindo sem duração) e Média Geral (excluindo legacy-default)', () => {
    const items = [
      {
        id: 'movie-known',
        title: 'Filme 120min',
        workType: 'movie',
        status: 'completed',
        durationMinutes: 120,
        rating: 90,
        ratingSource: 'manual',
      },
      {
        id: 'movie-active-known',
        title: 'Filme Ativo 30min de 100min',
        workType: 'movie',
        status: 'playing',
        durationMinutes: 100,
        currentSeconds: 1800,
        rating: 80,
        ratingSource: 'criteria',
      },
      {
        id: 'series-known',
        title: 'Série 3 eps x 40min',
        workType: 'series',
        status: 'playing',
        currentEpisode: 3,
        totalEpisodes: 10,
        episodeDurationMinutes: 40,
        rating: 85,
        ratingSource: 'episodes-avg',
      },
      {
        id: 'anime-unknown-duration',
        title: 'Anime sem duração conhecida',
        workType: 'anime',
        status: 'playing',
        currentEpisode: 5,
        totalEpisodes: 12,
        rating: 60,
        ratingSource: 'legacy-default', // deve ser ignorada na Média Geral
      },
      {
        id: 'movie-unknown-duration',
        title: 'Filme concluído sem duração',
        workType: 'movie',
        status: 'completed',
        rating: null,
      },
      {
        id: 'queued-ignored',
        title: 'Na fila sem ver',
        workType: 'series',
        status: 'queued',
        episodeDurationMinutes: 45,
      },
    ];

    const metrics = computeProfileMetrics(items);
    assert.equal(metrics.totalWorks, 6);
    assert.equal(metrics.completedWorks, 2);
    assert.equal(metrics.episodesWatched, 8); // 3 (série) + 5 (anime)
    // Conhecidos: 120 + 30 + (3 * 40 = 120) = 270 min = 4.5h (anime sem duração NÃO soma 5*24)
    assert.equal(metrics.knownDurationMinutes, 270);
    assert.equal(metrics.watchedHours, 4.5);
    assert.equal(metrics.watchedHoursLabel, '4.5h');
    assert.equal(metrics.unknownDurationCount, 2);
    // Média confirmada: (90 + 80 + 85) / 3 = 85 (legacy-default 60 excluída)
    assert.equal(metrics.ratedWorksCount, 3);
    assert.equal(metrics.averageRating, 85);
    assert.equal(metrics.averageRatingLabel, '85');

    // Quando não há nenhuma nota confirmada, retorna '—'
    const onlyLegacy = computeProfileMetrics([
      {
        id: 'legacy-1',
        title: 'Legado',
        workType: 'movie',
        status: 'completed',
        rating: 78,
        ratingSource: 'legacy-default',
      },
    ]);
    assert.equal(onlyLegacy.ratedWorksCount, 0);
    assert.equal(onlyLegacy.averageRating, null);
    assert.equal(onlyLegacy.averageRatingLabel, '—');
    assert.equal(formatWatchedHoursLabel(0), '0h');
  });

  it('R6 (v1.2.0) — código social morto foi fisicamente removido e superfícies sociais não existem', () => {
    assert.equal(SOCIAL_ENABLED, false);

    const removedSocialFiles = [
      'src/components/social/CommunityScreen.jsx',
      'src/components/social/ProfileWall.jsx',
      'src/components/social/UserProfileModal.jsx',
      'src/components/social/DirectChatDrawer.jsx',
      'src/components/social/ShareProfileCardModal.jsx',
      'src/components/social/FriendProfileCardModal.jsx',
      'src/components/social/ActivityFeed.jsx',
      'src/components/auth/AuthModal.jsx',
      'src/components/BuddyReadPanel.jsx',
      'src/services/buddyReadService.js',
    ];
    for (const rel of removedSocialFiles) {
      assert.equal(
        fs.existsSync(path.join(ROOT, rel)),
        false,
        `${rel} deve ter sido fisicamente removido na v1.2.0 (R6)`
      );
    }

    const bottomNavSrc = readSrc('src/components/BottomNav.jsx');
    assert.match(bottomNavSrc, /item\.id !== 'community'/);

    const profileSrc = readSrc('src/screens/ProfileScreen.jsx');
    assert.match(profileSrc, /resolveProfileHeroBackdrop/);
    assert.match(profileSrc, /computeProfileMetrics/);
    assert.match(profileSrc, /rgba\(10,12,16,0\.72\)/);
    assert.match(profileSrc, /Em cartaz:/);
    assert.match(profileSrc, /Episódios \/ Horas/);
    assert.match(profileSrc, /Média Geral/);
    assert.match(profileSrc, /sem duração excluída/);
    assert.match(profileSrc, /Favoritos da Vida · Top 4/);

    const settingsSrc = readSrc('src/components/ProfileSettingsDrawer.jsx');
    assert.match(settingsSrc, /Modo Calmo/);
  });

  it('R7 — telas visíveis e prompts de IA não carregam resíduos de livros', () => {
    const streakSrc = readSrc('src/components/ReadingStreakWidget.jsx');
    assert.equal(/Registrar Leitura Hoje/i.test(streakSrc), false);
    assert.match(streakSrc, /Registrar Sessão Hoje/);

    const composerSrc = readSrc('src/components/JournalComposerModal.jsx');
    assert.equal(/Página ou Capítulo/i.test(composerSrc), false);
    assert.match(composerSrc, /Temporada, Episódio ou Minuto/);

    const tokensSrc = readSrc('src/utils/themeTokens.js');
    assert.equal(/Editorial \/ Livro/i.test(tokensSrc), false);
    assert.equal(/Clássico Literário/i.test(tokensSrc), false);
    assert.match(tokensSrc, /Editorial \/ Roteiro \(Lora\)/);
    assert.match(tokensSrc, /Clássico de Cinema \(Merriweather\)/);

    const titlesSrc = readSrc('src/components/TitlesBadgesModal.jsx');
    assert.equal(/Insígnias do Leitor/i.test(titlesSrc), false);
    assert.match(titlesSrc, /Títulos e Insígnias do Espectador/);

    const profileSrc = readSrc('src/screens/ProfileScreen.jsx');
    assert.equal(/Progresso de XP do leitor/i.test(profileSrc), false);
    assert.match(profileSrc, /Progresso de XP do espectador/);

    const epSrc = readSrc('src/components/EpisodeListTab.jsx');
    assert.equal(/Arcos &(?:amp;)? Capítulos/i.test(epSrc), false);
    assert.match(epSrc, /Arcos &(?:amp;)? Episódios/);

    const geminiSrc = readSrc('src/services/geminiApi.js');
    assert.equal(/crítico literário|Autor\(es\)|ABNT/i.test(geminiSrc), false);
  });
});
