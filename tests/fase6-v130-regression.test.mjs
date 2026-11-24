import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { CODICE_RELEASE, RELEASE_HISTORY } from '../src/config/versioning.js';
import {
  AMBIENT_TINT_SWATCHES,
  THEME_MODES,
  buildHarmonizedThemeVars,
  getContrastRatio,
} from '../src/utils/themeTokens.js';
import {
  computeJikanEpisodeBlocks,
  resolveEpisodeJumpTarget,
} from '../src/lib/episodeStats.js';
import {
  computeCritiqueComparisonBadge,
  computeWorkCritiqueBadge,
} from '../src/lib/ratingBadges.js';
import {
  CCODEX_FORMAT_VERSION,
  PBKDF2_ITERATIONS,
} from '../src/services/backupCryptoService.js';
import {
  exportSignedBackupPayload,
  exportSignedCcodexPayload,
  inspectBackupPayload,
} from '../src/services/backupEngine.js';
import { buildCodiceDatabase } from '../src/services/codiceDatabase.js';
import {
  buildDeterministicFranchiseOrUniverseModel,
  filterStrictlyCanonicalRelations,
} from '../src/services/franchiseService.js';

const ROOT = process.cwd();

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('FASE 6 (v1.3.0) — Regressão Ponta-a-Ponta · Cine Códice v1.3.0 Lumière', () => {
  it('(a) Motor Visual OKLCH: 3 modos oficiais, 0 presets antigos, 5 variáveis derivadas e contraste WCAG AA', () => {
    // 3 modos oficiais
    assert.deepEqual(
      THEME_MODES.map((m) => m.id),
      ['dark', 'white', 'sepia']
    );
    assert.equal(THEME_MODES[0].id, 'dark');
    assert.equal(THEME_MODES[1].id, 'white');
    assert.equal(THEME_MODES[2].id, 'sepia');

    // 0 presets legados
    const tokensSrc = readText('src/utils/themeTokens.js');
    assert.equal(/EDITORIAL_PRESETS|SPECIAL_THEMES|PASTEL_SUBPALETTES/.test(tokensSrc), false);

    // 5 variáveis derivadas OKLCH e contraste WCAG AA >= 4.5:1
    const res = buildHarmonizedThemeVars('dark', '#0F1A2E');
    const darkVars = res.vars;

    assert.match(darkVars['--bg-canvas'], /^#[0-9A-F]{6}$/);
    assert.match(darkVars['--bg-surface'], /^#[0-9A-F]{6}$/);
    assert.match(darkVars['--bg-elevated'], /^#[0-9A-F]{6}$/);
    assert.match(darkVars['--border-hairline'], /^#[0-9A-F]{6}$/);
    assert.match(darkVars['--accent-primary'], /^#[0-9A-F]{6}$/);

    const cr = getContrastRatio(darkVars['--accent-primary'], darkVars['--bg-surface']);
    assert.ok(cr >= 4.5, `Contraste deve ser >= 4.5:1 no dark mode (obtido: ${cr})`);
  });

  it('(b) Vocabulário "Catálogo": ausência de "Cinemateca" e "Acervo" nas superfícies visíveis de src/', () => {
    const ignoredPaths = ['src/config/versioning.js']; // histórico preserva releases antigas
    const forbidden = [/\bCinemateca\b/, /\bAcervo\b/];

    function checkDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        const rel = path.relative(ROOT, full);
        if (ent.isDirectory()) {
          checkDir(full);
        } else if (/\.(jsx?|tsx?|html)$/.test(ent.name) && !ignoredPaths.includes(rel)) {
          const content = fs.readFileSync(full, 'utf8');
          for (const rx of forbidden) {
            assert.equal(
              rx.test(content),
              false,
              `Termo legado "${rx}" detectado em ${rel}`
            );
          }
        }
      }
    }

    checkDir(path.join(ROOT, 'src'));
  });

  it('(c) Backup Criptografado (.ccodex): GZIP nativo, PBKDF2/AES-GCM 256-bit e retrocompatibilidade com .json', async () => {
    const mockBacklog = [
      {
        id: 'work-matrix',
        title: 'The Matrix',
        workType: 'movie',
        status: 'completed',
        rating: 96,
        ratingSource: 'manual',
        durationMinutes: 136,
        posterUrl: 'https://image.tmdb.org/t/p/w500/matrix.jpg',
      },
      {
        id: 'work-cowboy',
        title: 'Cowboy Bebop',
        workType: 'anime',
        status: 'playing',
        currentEpisode: 12,
        totalEpisodes: 26,
      },
    ];

    const db = buildCodiceDatabase({
      items: mockBacklog,
      profile: { displayName: 'Neo', calmMode: false },
    });

    // Exportação criptografada .ccodex
    const encryptedEnvelope = await exportSignedCcodexPayload(db, {
      password: 'SenhaSuperSegura123!',
    });

    assert.equal(encryptedEnvelope.format, CCODEX_FORMAT_VERSION);
    assert.equal(encryptedEnvelope.encrypted, true);
    assert.equal(encryptedEnvelope.iterations, PBKDF2_ITERATIONS);
    assert.equal(encryptedEnvelope.cipher, 'AES-256-GCM');

    // Inspeção sem senha deve avisar requiresPassword
    const withoutPass = await inspectBackupPayload(JSON.stringify(encryptedEnvelope));
    assert.equal(withoutPass.ok, false);
    assert.equal(withoutPass.requiresPassword, true);

    // Inspeção com senha incorreta deve reportar invalidPassword
    const wrongPass = await inspectBackupPayload(JSON.stringify(encryptedEnvelope), {
      password: 'SenhaErrada!',
    });
    assert.equal(wrongPass.ok, false);
    assert.equal(wrongPass.invalidPassword, true);

    // Inspeção com senha correta valida e restaura contagem íntegra
    const unlocked = await inspectBackupPayload(JSON.stringify(encryptedEnvelope), {
      password: 'SenhaSuperSegura123!',
    });
    assert.equal(unlocked.ok, true);
    assert.equal(unlocked.format, CCODEX_FORMAT_VERSION);
    assert.equal(unlocked.encrypted, true);
    assert.equal(unlocked.checksumStatus, 'valid');
    assert.equal(unlocked.counts.works, 2);

    // Compatibilidade com .json legado assinado
    const legacySignedJson = await exportSignedBackupPayload(db);
    const legacyInspection = await inspectBackupPayload(
      JSON.stringify(legacySignedJson)
    );
    assert.equal(legacyInspection.ok, true);
    assert.equal(legacyInspection.format, 'legacy-json');
    assert.equal(legacyInspection.encrypted, false);
    assert.equal(legacyInspection.checksumStatus, 'valid');
    assert.equal(legacyInspection.counts.works, 2);
  });

  it('(d) Anime Longo (One Piece): 100-ep pagination Jikan, salto rápido e separação Franquia vs Universo', () => {
    // One Piece 1.122 episódios -> 12 blocos de 100
    const blocks = computeJikanEpisodeBlocks(1122);
    assert.equal(blocks.length, 12);
    assert.equal(blocks[0].label, '1–100');
    assert.equal(blocks[10].label, '1001–1100');
    assert.equal(blocks[11].label, '1101–1122');

    // Salto rápido para ep. 1015 cai no bloco 1001–1100 (blockIndex 10 / page 11)
    const jump = resolveEpisodeJumpTarget(1015, { totalEpisodes: 1122 });
    assert.equal(jump.blockIndex, 10);
    assert.equal(jump.page, 11);
    assert.equal(jump.episodeNumber, 1015);
    assert.equal(jump.label, '1001–1100');

    // Franquia de Filmes (Dune) -> Franquia & Sequências
    const duneCatalog = [
      { id: 'dune-1', title: 'Duna', workType: 'movie', tmdbId: 438631, status: 'completed', rating: 92 },
      { id: 'dune-2', title: 'Duna: Parte 2', workType: 'movie', tmdbId: 693134, status: 'completed', rating: 95 },
    ];
    const duneParts = [
      { tmdbId: 438631, title: 'Duna', releaseYear: 2021 },
      { tmdbId: 693134, title: 'Duna: Parte 2', releaseYear: 2024 },
      { tmdbId: 999999, title: 'Duna: Messias', releaseYear: 2027 },
    ];
    const duneModel = buildDeterministicFranchiseOrUniverseModel(
      duneCatalog[0],
      duneCatalog,
      duneParts
    );
    assert.equal(duneModel.mode, 'movie-franchise');
    assert.equal(duneModel.sectionTitle, 'Franquia & Sequências');
    assert.equal(duneModel.completedCount, 2);
    assert.equal(duneModel.totalCount, 3);
    assert.equal(duneModel.completionPct, 67);
    assert.match(duneModel.progressHeader, /2\/3 filmes · 67% concluído/);

    // Universo de Séries/Animes (Steins;Gate) -> Obras do Mesmo Universo agrupadas
    const rawSgRelations = [
      { id: 1, title: 'Steins;Gate 0', relationType: 'SEQUEL', format: 'TV' },
      { id: 2, title: 'Steins;Gate Movie: Fuka Ryouiki', relationType: 'SIDE_STORY', format: 'MOVIE' },
      { id: 3, title: 'Steins;Gate: Soumei Eichi no Cognitive', relationType: 'SPIN_OFF', format: 'OVA' },
      { id: 4, title: 'Personagem Noise', relationType: 'CHARACTER', format: 'SPECIAL' }, // Ruído deve ser descartado
    ];
    const filteredRelations = filterStrictlyCanonicalRelations(rawSgRelations);
    assert.equal(filteredRelations.length, 3);
    assert.equal(filteredRelations.some((r) => r.relationType === 'CHARACTER'), false);

    const sgMain = {
      id: 'sg-main',
      title: 'Steins;Gate',
      workType: 'anime',
      status: 'completed',
      franchiseRelations: rawSgRelations,
    };
    const sgCatalog = [
      sgMain,
      { id: 'sg-0', title: 'Steins;Gate 0', workType: 'anime', status: 'completed' },
    ];
    const sgModel = buildDeterministicFranchiseOrUniverseModel(sgMain, sgCatalog);
    assert.equal(sgModel.mode, 'series-universe');
    assert.equal(sgModel.sectionTitle, 'Obras do Mesmo Universo');
    assert.equal(sgModel.totalCount, 4); // sg-main + sg0 + movie + ova (CHARACTER descartado)
    assert.equal(sgModel.groups.length, 3);
    assert.equal(sgModel.groups[0].label, 'Série Principal');
    assert.equal(sgModel.groups[1].label, 'Filmes');
    assert.equal(sgModel.groups[2].label, 'OVAs / Especiais');
  });

  it('(e) Selos Comparativos de Crítica (Sintonia Total, Obra-Prima Consensual, Você vs. Público)', () => {
    // Obra-Prima Consensual: Você >= 88 e Público >= 88 com diferença pequena
    const masterpiece = computeCritiqueComparisonBadge(95, 92);
    assert.equal(masterpiece?.id, 'consensus-masterpiece');
    assert.equal(masterpiece?.label, 'Obra-Prima Consensual');

    // Você Amou Mais que o Público (delta >= 12)
    const lovedMore = computeCritiqueComparisonBadge(94, 75);
    assert.equal(lovedMore?.id, 'loved-more');
    assert.equal(lovedMore?.label, 'Você Amou Mais que o Público');

    // Mais Exigente que a Crítica (delta <= -12)
    const demanding = computeCritiqueComparisonBadge(60, 85);
    assert.equal(demanding?.id, 'more-demanding');
    assert.equal(demanding?.label, 'Mais Exigente que a Crítica');

    // Sintonia Total (abs(delta) <= 5)
    const harmony = computeCritiqueComparisonBadge(82, 80);
    assert.equal(harmony?.id, 'total-harmony');
    assert.equal(harmony?.label, 'Sintonia Total');

    // Exclusão de legacy-default
    const legacy = computeCritiqueComparisonBadge(80, 80, 'legacy-default');
    assert.equal(legacy, null);
  });

  it('(f) Consistência Nominal e Semântica da Versão atual (2.4.0) e preservação do histórico 1.x/2.3.3 em todos os arquivos oficiais', () => {
    const pkg = JSON.parse(readText('package.json'));
    const lock = JSON.parse(readText('package-lock.json'));

    assert.equal(pkg.name, 'omniprism');
    assert.equal(pkg.version, '2.4.0');
    assert.equal(lock.version, '2.4.0');
    assert.equal(lock.packages?.['']?.version, '2.4.0');

    assert.equal(CODICE_RELEASE.version, '2.4.0');
    assert.equal(CODICE_RELEASE.label, 'v2.4.0');
    assert.equal(CODICE_RELEASE.label.includes('Lumière'), false);

    assert.equal(RELEASE_HISTORY[0].version, '2.4.0');
    assert.ok(RELEASE_HISTORY.some((r) => r.version === '2.3.3'));
    assert.ok(RELEASE_HISTORY.some((r) => r.version === '1.3.0'));
    assert.ok(RELEASE_HISTORY.some((r) => r.version === '1.2.0'));
    assert.ok(RELEASE_HISTORY.some((r) => r.version === '1.1.0'));
    assert.ok(RELEASE_HISTORY.some((r) => r.version === '1.0.0'));

    const changelog = readText('CHANGELOG.md');
    assert.match(changelog, /## \[v2\.4\.0\]/);
    assert.match(changelog, /## \[v2\.3\.3\]/);
    assert.match(changelog, /## \[v1\.3\.0 · Lumière\]/);
    assert.match(changelog, /## \[v1\.2\.0 · Lumière\]/);
  });
});
