import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  computeCollectorMilestones,
  computeDomainBreakdownMetrics,
  normalizeCollectorHandle,
  resolveCollectorIdentity,
  resolveTop4Favorites,
} from '../src/lib/profileMetrics.js';

const ROOT_DIR = process.cwd();
const readSrc = (rel) => fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');

describe('OMNIPRISM v2.7.0 — Fase 2: Novo Perfil de Colecionador (Agregacoes & Identidade)', () => {
  it('resolve identidade de colecionador com normalizacao de @arroba, titulo customizado e fallback editorial', () => {
    assert.equal(normalizeCollectorHandle('Matheus Cledsom'), '@matheus-cledsom');
    assert.equal(normalizeCollectorHandle('@@Épico_99'), '@epico_99');
    assert.equal(normalizeCollectorHandle('   '), '@meu-arquivo');

    const custom = resolveCollectorIdentity(
      {
        displayName: 'Matheus',
        handle: 'matheus',
        collectorTitle: 'Arquivista de Mundos',
        bio: 'Cinema, RPGs clássicos e ficção científica.',
      },
      { resolvedActiveBadge: { name: 'Insígnia Secundária' } },
      []
    );
    assert.equal(custom.displayName, 'Matheus');
    assert.equal(custom.handle, '@matheus');
    assert.equal(custom.collectorTitle, 'Arquivista de Mundos');
    assert.equal(custom.hasCustomTitle, true);
    assert.equal(custom.bio, 'Cinema, RPGs clássicos e ficção científica.');

    // Sem título customizado, usa insígnia ativa
    const fromBadge = resolveCollectorIdentity(
      { displayName: 'Ana', handle: '@ana' },
      { resolvedActiveBadge: { name: 'Cronista da Estante' } },
      []
    );
    assert.equal(fromBadge.collectorTitle, 'Cronista da Estante');
    assert.equal(fromBadge.hasCustomTitle, false);

    // Sem título nem insígnia e com 12+ obras nos 4 mundos -> Colecionador dos 4 Mundos
    const richCatalog = [
      ...Array.from({ length: 3 }, (_, i) => ({ id: `c${i}`, domain: 'cinema', title: `C${i}` })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `r${i}`, domain: 'reading', title: `R${i}` })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `g${i}`, domain: 'games', title: `G${i}` })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `m${i}`, domain: 'music', title: `M${i}` })),
    ];
    const autoRank = resolveCollectorIdentity({}, null, richCatalog);
    assert.equal(autoRank.displayName, 'Meu arquivo');
    assert.equal(autoRank.collectorTitle, 'Colecionador dos 4 Mundos');
  });

  it('agrega progresso dos 4 Mundos com total, concluidos, media geral e Obras da Vida por dominio', () => {
    const catalog = [
      {
        id: 'c1',
        domain: 'cinema',
        workType: 'movie',
        title: 'Blade Runner 2049',
        status: 'completed',
        rating: 100,
        ratingSource: 'manual',
        lifeWork: true,
        favoriteRank: 1,
      },
      {
        id: 'c2',
        domain: 'cinema',
        workType: 'series',
        title: 'Dark',
        status: 'playing',
        rating: 80,
        ratingSource: 'manual',
        currentEpisode: 10,
      },
      {
        id: 'r1',
        domain: 'reading',
        workType: 'book',
        title: 'Duna',
        status: 'completed',
        rating: 96,
        ratingSource: 'manual',
        progress_data: { lifeWork: true },
        pagesRead: 680,
        favoriteRank: 1,
      },
      {
        id: 'g1',
        domain: 'games',
        workType: 'game',
        title: 'Shadow of the Colossus',
        status: 'completed',
        gameRating11: 11,
        hoursPlayed: 22,
        favoriteRank: 1,
      },
      {
        id: 'm1',
        domain: 'music',
        workType: 'album',
        title: 'Powerslave',
        status: 'completed',
        rating: 94,
        ratingSource: 'manual',
        lifeWork: true,
        listenCount: 18,
        favoriteRank: 1,
      },
    ];

    const breakdown = computeDomainBreakdownMetrics(catalog);
    assert.equal(breakdown.length, 4);

    const cinema = breakdown.find((d) => d.domainId === 'cinema');
    assert.equal(cinema.totalWorks, 2);
    assert.equal(cinema.completedWorks, 1);
    assert.equal(cinema.completionRatePct, 50);
    assert.equal(cinema.averageRating, 90);
    assert.equal(cinema.lifeWorksCount, 1);

    const reading = breakdown.find((d) => d.domainId === 'reading');
    assert.equal(reading.totalWorks, 1);
    assert.equal(reading.completedWorks, 1);
    assert.equal(reading.lifeWorksCount, 1);

    const games = breakdown.find((d) => d.domainId === 'games');
    assert.equal(games.totalWorks, 1);
    assert.equal(games.completedWorks, 1);
    assert.equal(games.averageRating, 100);
    assert.equal(games.lifeWorksCount, 1);

    const music = breakdown.find((d) => d.domainId === 'music');
    assert.equal(music.totalWorks, 1);
    assert.equal(music.completedWorks, 1);
    assert.equal(music.lifeWorksCount, 1);

    // Vitrine Top 4 isolada por domínio
    assert.equal(resolveTop4Favorites(catalog, 'cinema')[0].work?.id, 'c1');
    assert.equal(resolveTop4Favorites(catalog, 'reading')[0].work?.id, 'r1');
    assert.equal(resolveTop4Favorites(catalog, 'games')[0].work?.id, 'g1');
    assert.equal(resolveTop4Favorites(catalog, 'music')[0].work?.id, 'm1');
  });

  it('calcula Estante de Marcos & Conquistas (Platinas/100%, Sagas Concluidas, Discografias Completas e Obras da Vida)', () => {
    const catalog = [
      // Games: 2 platinas (1 por completionType, 1 por conquistas 100%) e 1 normal
      {
        id: 'g-plat-1',
        domain: 'games',
        workType: 'game',
        title: 'Bloodborne',
        status: 'completed',
        completionType: '100% / Platina',
        platform: 'PS4',
        lifeWork: true,
        updatedAt: '2026-11-20T12:00:00Z',
      },
      {
        id: 'g-plat-2',
        domain: 'games',
        workType: 'game',
        title: 'Hollow Knight',
        status: 'completed',
        completionType: 'Zerado',
        achievements: { source: 'steam', unlocked: 63, total: 63, updated_at: '2026-11-21T12:00:00Z' },
        platform: 'PC',
        updatedAt: '2026-11-21T12:00:00Z',
      },
      {
        id: 'g-normal',
        domain: 'games',
        workType: 'game',
        title: 'Hades',
        status: 'completed',
        completionType: 'História Principal',
        achievements: { source: 'steam', unlocked: 20, total: 49 },
      },
      // Saga concluída (2 livros mainline concluídos + 1 spin-off em fila não bloqueia linha principal)
      {
        id: 'r-duna-1',
        domain: 'reading',
        workType: 'book',
        title: 'Duna',
        franchiseName: 'Crônicas de Duna',
        status: 'completed',
        lifeWork: true,
      },
      {
        id: 'r-duna-2',
        domain: 'reading',
        workType: 'book',
        title: 'Messias de Duna',
        franchiseName: 'Crônicas de Duna',
        status: 'completed',
      },
      {
        id: 'r-duna-ed',
        domain: 'reading',
        workType: 'book',
        title: 'Duna (Edição Luxo)',
        franchiseName: 'Crônicas de Duna',
        editionOf: 'r-duna-1',
        status: 'queued',
      },
      // Saga incompleta (1 concluído, 1 em fila) -> NÃO entra em Sagas Concluídas
      {
        id: 'c-lotr-1',
        domain: 'cinema',
        workType: 'movie',
        title: 'A Sociedade do Anel',
        franchiseName: 'O Senhor dos Anéis',
        status: 'completed',
      },
      {
        id: 'c-lotr-2',
        domain: 'cinema',
        workType: 'movie',
        title: 'As Duas Torres',
        franchiseName: 'O Senhor dos Anéis',
        status: 'queued',
      },
      // Discografia completa (2 álbuns de estúdio concluídos)
      {
        id: 'm-im-1',
        domain: 'music',
        workType: 'album',
        artist: 'Iron Maiden',
        creator: 'Iron Maiden',
        title: 'Piece of Mind',
        releaseFormat: 'Álbum de Estúdio',
        status: 'completed',
      },
      {
        id: 'm-im-2',
        domain: 'music',
        workType: 'album',
        artist: 'Iron Maiden',
        creator: 'Iron Maiden',
        title: 'Powerslave',
        releaseFormat: 'Álbum de Estúdio',
        status: 'completed',
      },
      // Discografia incompleta (1 concluído, 1 ouvindo) -> NÃO entra
      {
        id: 'm-met-1',
        domain: 'music',
        workType: 'album',
        artist: 'Metallica',
        creator: 'Metallica',
        title: 'Ride the Lightning',
        releaseFormat: 'Álbum de Estúdio',
        status: 'completed',
      },
      {
        id: 'm-met-2',
        domain: 'music',
        workType: 'album',
        artist: 'Metallica',
        creator: 'Metallica',
        title: 'Master of Puppets',
        releaseFormat: 'Álbum de Estúdio',
        status: 'playing',
      },
    ];

    const milestones = computeCollectorMilestones(catalog);
    assert.equal(milestones.platinums.count, 2);
    assert.deepEqual(
      milestones.platinums.works.map((w) => w.id),
      ['g-plat-2', 'g-plat-1']
    );

    assert.equal(milestones.completedSagas.count, 1);
    assert.equal(milestones.completedSagas.sagas[0].name, 'Crônicas de Duna');
    assert.equal(milestones.completedSagas.sagas[0].completedCount, 2);

    assert.equal(milestones.completedDiscographies.count, 1);
    assert.equal(milestones.completedDiscographies.artists[0].artist, 'Iron Maiden');
    assert.equal(milestones.completedDiscographies.artists[0].completedCount, 2);

    assert.equal(milestones.lifeWorks.count, 2);
    assert.equal(milestones.lifeWorks.byDomain.games, 1);
    assert.equal(milestones.lifeWorks.byDomain.reading, 1);
    assert.equal(milestones.totalMilestones, 6);
  });

  it('wiring do novo ProfileScreen cobre Hero inline, 4 Mundos, Top 4 direto, Marcos e gaveta secundaria no rodape', () => {
    const profileSrc = readSrc('src/screens/ProfileScreen.jsx');

    // Hero de Identidade + Edição Inline
    assert.match(profileSrc, /data-testid="collector-identity-hero"/);
    assert.match(profileSrc, /data-testid="inline-identity-edit-btn"/);
    assert.match(profileSrc, /data-testid="inline-identity-form"/);
    assert.match(profileSrc, /data-testid="collector-handle"/);
    assert.match(profileSrc, /data-testid="collector-title-badge"/);

    // Painel de Progresso nos 4 Mundos
    assert.match(profileSrc, /data-testid="four-worlds-progress-panel"/);
    assert.match(profileSrc, /world-progress-card-/);
    assert.match(profileSrc, /lifeWorksCount/);

    // Vitrine Top 4 com troca direta inline (2:3 e 1:1)
    assert.match(profileSrc, /data-testid="collector-top4-showcase"/);
    assert.match(profileSrc, /data-testid="top4-inline-swap-panel"/);
    assert.match(profileSrc, /aspect-square/);
    assert.match(profileSrc, /aspect-\[2\/3\]/);

    // Estante de Marcos & Conquistas
    assert.match(profileSrc, /data-testid="collector-milestones-shelf"/);
    assert.match(profileSrc, /data-testid="milestone-platinums"/);
    assert.match(profileSrc, /data-testid="milestone-sagas"/);
    assert.match(profileSrc, /data-testid="milestone-discographies"/);
    assert.match(profileSrc, /data-testid="milestone-lifeworks"/);

    // Gaveta secundária limpa no rodapé agrupando Configurações, APIs, Backup, Atualização e Diagnóstico
    assert.match(profileSrc, /data-testid="profile-system-drawer"/);
    assert.match(profileSrc, /data-testid="profile-system-drawer-toggle"/);
    assert.match(profileSrc, /data-testid="profile-open-settings-btn"/);
    assert.match(profileSrc, /data-testid="profile-api-status-btn"/);
    assert.match(profileSrc, /data-testid="profile-backup-center-btn"/);
    assert.match(profileSrc, /data-testid="profile-check-update-btn"/);
    assert.match(profileSrc, /data-testid="profile-diagnostics-btn"/);
  });
});
