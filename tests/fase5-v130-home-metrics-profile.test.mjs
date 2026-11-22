import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  buildHomeLiveSummary,
  resolveHeroNextEpisodeTitle,
} from '../src/lib/homeEngine.js';
import {
  computeProfileMetrics,
  computeRatingHistogram,
  computeRecentActivityWorks,
  resolveProfileHeroBackdrop,
  resolveTop4Favorites,
} from '../src/lib/profileMetrics.js';

const ROOT = process.cwd();

function readSrc(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('FASE 5 (v1.3.0) — Métricas Zero-Scroll, Início Refinada & Perfil Editorial', () => {
  it('1. StatsScreen organiza métricas em dashboard denso de 2 dobras (Linhas 1, 2 e 3)', () => {
    const statsSrc = readSrc('src/screens/StatsScreen.jsx');

    // Linha 1: 4 KPIs compactos horizontais
    assert.match(statsSrc, /Tempo Acumulado em Tela/);
    assert.match(statsSrc, /Episódios Vistos/);
    assert.match(statsSrc, /Obras Concluídas/);
    assert.match(statsSrc, /Média Geral/);
    assert.match(statsSrc, /grid-cols-2.*sm:grid-cols-4/);

    // Linha 2: Coluna A (Formatos & Décadas) e Coluna B (Top 5 Diretores / Estúdios / Gêneros)
    assert.match(statsSrc, /Distribuição por Formato/);
    assert.match(statsSrc, /Linha do Tempo por Década/);
    assert.match(statsSrc, /Diretores/);
    assert.match(statsSrc, /Estúdios/);
    assert.match(statsSrc, /Gêneros/);

    // Linha 3: Mapa de Sessões e Cine Wrapped
    assert.match(statsSrc, /Mapa de Sessões/);
    assert.match(statsSrc, /Cine Wrapped/);
    assert.match(statsSrc, /tabular-nums/);
  });

  it('2. homeEngine e HomeScreen geram resumo vivo e próximo episódio no Hero', () => {
    const items = [
      {
        id: 'w1',
        title: 'Breaking Bad',
        status: 'playing',
        workType: 'series',
        currentSeason: 1,
        currentEpisode: 2,
        durationMinutes: 45,
        episodesList: [
          { seasonNumber: 1, episodeNumber: 1, title: 'Pilot' },
          { seasonNumber: 1, episodeNumber: 2, title: 'Cat\'s in the Bag...' },
          { seasonNumber: 1, episodeNumber: 3, title: '...And the Bag\'s in the River' },
        ],
      },
      {
        id: 'w2',
        title: 'Blade Runner 2049',
        status: 'completed',
        workType: 'movie',
        durationMinutes: 164,
      },
    ];

    const summary = buildHomeLiveSummary(items);
    assert.match(summary, /1 obra em andamento/);
    assert.match(summary, /h acumuladas/);

    const nextTitle = resolveHeroNextEpisodeTitle(items[0]);
    assert.equal(nextTitle, '...And the Bag\'s in the River');

    const homeSrc = readSrc('src/screens/HomeScreen.jsx');
    assert.match(homeSrc, /buildHomeLiveSummary/);
    assert.match(homeSrc, /resolveHeroNextEpisodeTitle/);
    assert.match(homeSrc, /Sortear da fila Quero Ver/);
    assert.match(homeSrc, /Continuar última sessão/);
  });

  it('3. profileMetrics calcula Histograma de Notas (0–100) e Atividade Recente', () => {
    const items = [
      {
        id: 'eva',
        title: 'Neon Genesis Evangelion',
        status: 'completed',
        rating: 95,
        ratingSource: 'manual',
        favoriteScene: 'Eu não devo fugir.',
        updatedAt: '2026-11-22T12:00:00Z',
      },
      {
        id: 'cowboy',
        title: 'Cowboy Bebop',
        status: 'completed',
        rating: 98,
        ratingSource: 'manual',
        updatedAt: '2026-11-22T14:00:00Z',
      },
      {
        id: 'mid',
        title: 'Filme Mediano',
        status: 'completed',
        rating: 55,
        ratingSource: 'manual',
        updatedAt: '2026-11-20T10:00:00Z',
      },
      {
        id: 'legacy',
        title: 'Obra Legada',
        status: 'completed',
        rating: 80,
        ratingSource: 'legacy-default', // deve ser ignorada
      },
    ];

    const hist = computeRatingHistogram(items);
    assert.equal(hist.totalRated, 3);
    assert.equal(hist.maxCount, 2); // 95 e 98 caem no balde 91-100
    const topBucket = hist.buckets.find((b) => b.key === '91-100');
    assert.equal(topBucket?.count, 2);
    assert.equal(topBucket?.percentage, 100);

    const midBucket = hist.buckets.find((b) => b.key === '51-60');
    assert.equal(midBucket?.count, 1);
    assert.equal(midBucket?.percentage, 50);

    const recent = computeRecentActivityWorks(items, 5);
    assert.equal(recent.length >= 3, true);
    assert.equal(recent[0].id, 'cowboy'); // mais recente
    assert.equal(recent[1].id, 'eva');
    assert.equal(recent[1].hasScene, true);
  });

  it('4. ProfileScreen preserva integrações de compatibilidade e adota estética Letterboxd/Serializd', () => {
    const profileSrc = readSrc('src/screens/ProfileScreen.jsx');

    // Estética Letterboxd/Serializd
    assert.match(profileSrc, /rounded-2xl/); // avatar quadrado arredondado
    assert.match(profileSrc, /Atividade Recente/);
    assert.match(profileSrc, /Histograma de Notas \(0–100\)/);

    // Compatibilidade com testes anteriores
    assert.match(profileSrc, /resolveProfileHeroBackdrop/);
    assert.match(profileSrc, /computeProfileMetrics/);
    assert.match(profileSrc, /rgba\(10,12,16,0\.72\)/);
    assert.match(profileSrc, /Em cartaz:/);
    assert.match(profileSrc, /Episódios \/ Horas/);
    assert.match(profileSrc, /Média Geral/);
    assert.match(profileSrc, /sem duração excluída/);
    assert.match(profileSrc, /Favoritos da Vida · Top 4/);
  });
});
