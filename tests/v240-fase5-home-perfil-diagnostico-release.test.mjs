import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { CODICE_RELEASE, RELEASE_HISTORY } from '../src/config/versioning.js';
import {
  buildDiagnosticsReportText,
  collectStorageEstimate,
  computeCatalogDiagnosticsSummary,
  estimateLocalStorageUsage,
  formatBytesHuman,
} from '../src/lib/diagnosticsHelpers.js';
import {
  MAX_LOCAL_ERROR_ENTRIES,
  clearLocalErrorLog,
  getLocalErrorLog,
  recordLocalError,
} from '../src/lib/errorLogger.js';
import { buildHomeInProgressStrip } from '../src/lib/homeEngine.js';
import {
  getOracleConfigForDomain,
  scopeOracleItemsForDomain,
} from '../src/lib/oracleDomainConfig.js';
import { computeDomainQuickActionPatch } from '../src/utils/catalogDraftHelpers.js';

const ROOT_DIR = path.resolve(process.cwd());
const readSrc = (rel) => fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');

function createMemStorage() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: (i) => Array.from(map.keys())[i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(String(k), String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

describe('OMNIPRISM v2.4.0 — Fase 5.1: Home cross-domain, acoes rapidas + Desfazer e Curador por dominio', () => {
  it('reune os 4 dominios na faixa Em andamento com acoes rapidas e snapshots de Desfazer', () => {
    const items = [
      { id: 'c1', domain: 'cinema', workType: 'series', title: 'Severance', status: 'playing', currentSeason: 1, currentEpisode: 3, totalEpisodes: 9 },
      { id: 'r1', domain: 'reading', workType: 'book', title: 'Duna', status: 'playing', pagesRead: 120, totalPages: 680, chaptersRead: 4 },
      { id: 'g1', domain: 'games', workType: 'game', title: 'Hades', status: 'playing', hoursPlayed: 12 },
      { id: 'm1', domain: 'music', workType: 'album', title: 'Kid A', status: 'playing', listenCount: 2 },
    ];

    const strip = buildHomeInProgressStrip(items, { domainFilter: 'all' });
    assert.equal(strip.length, 4);
    assert.deepEqual(
      strip.find((e) => e.domain === 'cinema').quickActions.map((a) => a.label),
      ['+1 Ep']
    );
    assert.deepEqual(
      strip.find((e) => e.domain === 'reading').quickActions.map((a) => a.label),
      ['+10 págs', '+1 cap']
    );
    assert.deepEqual(
      strip.find((e) => e.domain === 'games').quickActions.map((a) => a.label),
      ['+30 min', '+1 h']
    );
    assert.deepEqual(
      strip.find((e) => e.domain === 'music').quickActions.map((a) => a.label),
      ['+1 audição']
    );

    // Todas as acoes rapidas retornam undoSnapshot
    const p10 = computeDomainQuickActionPatch(items[1], 'reading_pages');
    assert.equal(p10.patch.pagesRead, 130);
    assert.equal(p10.undoSnapshot.pagesRead, 120);

    const ch1 = computeDomainQuickActionPatch(items[1], 'reading_chapter');
    assert.equal(ch1.patch.chaptersRead, 5);
    assert.equal(ch1.undoSnapshot.chaptersRead, 4);

    const g30 = computeDomainQuickActionPatch(items[2], 'games_30m');
    assert.equal(g30.patch.hoursPlayed, 12.5);
    assert.equal(g30.undoSnapshot.hoursPlayed, 12);

    const g1h = computeDomainQuickActionPatch(items[2], 'games_1h');
    assert.equal(g1h.patch.hoursPlayed, 13);
    assert.equal(g1h.undoSnapshot.hoursPlayed, 12);

    const listen = computeDomainQuickActionPatch(items[3], 'music_listen');
    assert.equal(listen.patch.listenCount, 3);
    assert.equal(listen.undoSnapshot.listenCount, 2);

    const appSrc = readSrc('src/App.jsx');
    assert.match(appSrc, /handleQuickAdvanceWork/);
    assert.match(appSrc, /label:\s*'Desfazer'/);
  });

  it('adapta Curador (OracleWidget) a cada dominio ativo e o integra na HomeScreen', () => {
    const cinemaCfg = getOracleConfigForDomain('cinema');
    const readingCfg = getOracleConfigForDomain('reading');
    const gamesCfg = getOracleConfigForDomain('games');
    const musicCfg = getOracleConfigForDomain('music');

    assert.equal(cinemaCfg.title, 'Curador de Cinema');
    assert.equal(readingCfg.title, 'Curador de Leitura');
    assert.equal(gamesCfg.title, 'Curador de Games');
    assert.equal(musicCfg.title, 'Curador Musical');

    assert.notEqual(readingCfg.presets[0].id, cinemaCfg.presets[0].id);
    assert.notEqual(gamesCfg.presets[0].id, musicCfg.presets[0].id);

    const catalog = [
      { id: 'c1', domain: 'cinema', status: 'queued', title: 'Stalker' },
      { id: 'r1', domain: 'reading', status: 'queued', title: 'Neuromancer' },
      { id: 'g1', domain: 'games', status: 'queued', title: 'Celeste' },
      { id: 'm1', domain: 'music', status: 'queued', title: 'Loveless' },
    ];
    const musicScope = scopeOracleItemsForDomain(catalog, 'music');
    assert.equal(musicScope.queuedItems.length, 1);
    assert.equal(musicScope.queuedItems[0].id, 'm1');

    const homeSrc = readSrc('src/screens/HomeScreen.jsx');
    assert.match(homeSrc, /const OracleWidget = lazy\(/);
    assert.match(homeSrc, /<OracleWidget/);
    assert.match(homeSrc, /activeDomain=\{homeFilterDomain === 'all' \? activeDomain : homeFilterDomain\}/);

    const oracleSrc = readSrc('src/components/OracleWidget.jsx');
    assert.match(oracleSrc, /getOracleConfigForDomain/);
    assert.match(oracleSrc, /scopeOracleItemsForDomain/);
  });
});

describe('OMNIPRISM v2.4.0 — Fase 5.2: Perfil, Novidades da Versao e Configuracoes > Diagnostico (100% local)', () => {
  it('calcula diagnostico local (catalogo, storage, log copiavel dos ultimos 50 erros) sem chamadas de rede', async () => {
    assert.equal(formatBytesHuman(0), '0 B');
    assert.equal(formatBytesHuman(1536), '1.5 KB');
    assert.equal(formatBytesHuman(2 * 1024 * 1024), '2.00 MB');

    const sampleItems = [
      { id: '1', domain: 'cinema', status: 'completed', title: 'Filme A' },
      { id: '2', domain: 'reading', status: 'playing', title: 'Livro B' },
      { id: '3', domain: 'games', status: 'queued', title: 'Jogo C' },
      { id: '4', domain: 'music', status: 'completed', title: 'Disco D' },
    ];
    const cat = computeCatalogDiagnosticsSummary(sampleItems);
    assert.equal(cat.backlogWorks, 4);
    assert.equal(cat.completedWorks, 2);
    assert.equal(cat.inProgressWorks, 1);
    assert.equal(cat.queuedWorks, 1);
    assert.deepEqual(cat.byDomain, { cinema: 1, reading: 1, games: 1, music: 1 });
    assert.ok(cat.approxPayloadBytes > 0);

    const mem = createMemStorage();
    mem.setItem('omniprism_test_key', 'valor_local_12345');
    const lsEst = estimateLocalStorageUsage(mem);
    assert.equal(lsEst.keysCount, 1);
    assert.ok(lsEst.totalBytes > 0);

    const stEst = await collectStorageEstimate({
      navigatorImpl: {
        storage: {
          estimate: async () => ({ usage: 1024 * 512, quota: 1024 * 1024 * 100 }),
          persisted: async () => true,
        },
      },
      storageImpl: mem,
    });
    assert.equal(stEst.persisted, true);
    assert.equal(stEst.formattedUsage, '512.0 KB');
    assert.equal(stEst.formattedQuota, '100.00 MB');

    // Ring buffer de 50 erros com redacao de segredos
    clearLocalErrorLog({ storage: mem });
    for (let i = 0; i < 55; i += 1) {
      recordLocalError(
        { message: `Erro #${i} api_key=SECRET_TOKEN_${i}` },
        { source: 'test-diag', storage: mem }
      );
    }
    const log = getLocalErrorLog({ storage: mem });
    assert.equal(log.length, MAX_LOCAL_ERROR_ENTRIES);
    assert.equal(log.some((e) => e.message.includes('SECRET_TOKEN_')), false);

    const report = buildDiagnosticsReportText({
      release: CODICE_RELEASE,
      schemaVersion: 2,
      catalogSummary: cat,
      storageSummary: stEst,
      errorLog: log,
    });
    assert.match(report, /v2\.7\.1/);
    assert.match(report, /Schema IndexedDB: v2/);
    assert.match(report, /Cinema 1 \| Leitura 1 \| Games 1 \| Música 1/);
    assert.match(report, /50\/50/);
    assert.equal(report.includes('SECRET_TOKEN_'), false);

    // Garante que DiagnosticsPanel e diagnosticsHelpers NAO fazem fetch/telemetria para fora
    const diagHelperSrc = readSrc('src/lib/diagnosticsHelpers.js');
    const diagPanelSrc = readSrc('src/components/DiagnosticsPanel.jsx');
    assert.equal(/\bfetch\s*\(/.test(diagHelperSrc), false);
    assert.equal(/\bfetch\s*\(/.test(diagPanelSrc), false);
    assert.equal(/sendBeacon/.test(diagPanelSrc), false);
    assert.match(diagPanelSrc, /100% local no dispositivo/);
    assert.match(diagPanelSrc, /copy-error-log-button/);
    assert.match(diagPanelSrc, /<ApiStatusPanel/);
  });

  it('expoe identidade editavel, 4 mundos, Top 4, Backup, Novidades e Configuracoes > Diagnostico no Perfil', () => {
    const profileSrc = readSrc('src/screens/ProfileScreen.jsx');
    assert.match(profileSrc, /ProfileEditModal/);
    assert.match(profileSrc, /Resumo dos 4 Mundos/);
    assert.match(profileSrc, /resolveTop4Favorites/);
    assert.match(profileSrc, /profile-backup-center-btn/);
    assert.match(profileSrc, /profile-release-notes-btn/);
    assert.match(profileSrc, /profile-diagnostics-btn/);
    assert.match(profileSrc, /ReleaseHistoryModal/);

    const drawerSrc = readSrc('src/components/ProfileSettingsDrawer.jsx');
    assert.match(drawerSrc, /id:\s*'diagnostics'/);
    assert.match(drawerSrc, /label:\s*'Diagnóstico'/);
    assert.match(drawerSrc, /<DiagnosticsPanel/);
  });
});

describe('OMNIPRISM v2.4.0 — Fase 5.3: Fechamento de Versao 2.7.1', () => {
  it('sincroniza package.json, package-lock.json, versioning.js, CHANGELOG.md e docs/PROGRESSO.md para 2.7.1', () => {
    const pkg = JSON.parse(readSrc('package.json'));
    const lock = JSON.parse(readSrc('package-lock.json'));
    assert.equal(pkg.version, '2.7.1');
    assert.equal(lock.version, '2.7.1');
    assert.equal(lock.packages?.['']?.version, '2.7.1');

    assert.equal(CODICE_RELEASE.version, '2.7.1');
    assert.equal(CODICE_RELEASE.label, 'v2.7.1');
    assert.equal(RELEASE_HISTORY[0].version, '2.7.1');
    assert.ok(RELEASE_HISTORY.some((r) => r.version === '2.3.3'));

    const changelog = readSrc('CHANGELOG.md');
    assert.match(changelog, /## \[v2\.4\.0\]/);
    assert.match(changelog, /## \[v2\.3\.3\]/);
  });
});
