import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  advanceEpisodeProgress,
  createExpandedSeasonPatch,
} from '../src/utils/backlogHelpers.js';

const readSrc = (rel) => fs.readFileSync(path.resolve(rel), 'utf8');

describe('FASE 2 (v1.2.0) — Página Completa da Obra (WorkDetailPage Editorial Sem Formulários Abertos)', () => {
  it('WorkDetailPage não renderiza nenhum <input>, <textarea> ou <select> fora do drawer sob demanda isEditDrawerOpen', () => {
    const src = readSrc('src/components/WorkDetailPage.jsx');

    // Divide o código antes e depois do bloco `{isEditDrawerOpen && (`
    const splitMarker = '{isEditDrawerOpen && (';
    const markerIndex = src.indexOf(splitMarker);
    assert.equal(
      markerIndex > 0,
      true,
      'WorkDetailPage deve encapsular os campos de formulário dentro de {isEditDrawerOpen && (...)}'
    );

    const readModeJSX = src.slice(0, markerIndex);
    const editDrawerJSX = src.slice(markerIndex);

    // No Modo Leitura (Hero + 3 abas editoriais), zero <input, <textarea ou <select
    assert.equal(
      /<input\b|<textarea\b|<select\b/.test(readModeJSX),
      false,
      'Nenhum <input>, <textarea> ou <select> pode existir no modo leitura de WorkDetailPage'
    );

    // No drawer sob demanda "Editar Metadados", os campos de edição estão disponíveis
    assert.equal(/<input\b/.test(editDrawerJSX), true);
    assert.equal(/<textarea\b/.test(editDrawerJSX), true);
  });

  it('QuotesVaultTab e EpisodeListTab também mantêm formulários fechados por padrão no modo leitura', () => {
    const quotesSrc = readSrc('src/components/QuotesVaultTab.jsx');
    assert.match(quotesSrc, /const \[composerOpen, setComposerOpen\] = useState\(false\)/);
    assert.match(quotesSrc, /const \[editingSceneOpen, setEditingSceneOpen\] = useState\(false\)/);
    assert.match(quotesSrc, /const \[editingNotesOpen, setEditingNotesOpen\] = useState\(false\)/);

    const epSrc = readSrc('src/components/EpisodeListTab.jsx');
    assert.match(epSrc, /const \[showArcForm, setShowArcForm\] = useState\(false\)/);
    assert.match(epSrc, /\{showArcForm && \(/);
  });

  it('Hero Cinematográfico respeita proporção 2:3 do pôster, banner widescreen center 20% e scrim >= 72% (R3)', () => {
    const src = readSrc('src/components/WorkDetailPage.jsx');
    assert.match(src, /aspectRatio:\s*'2 \/ 3'/);
    assert.match(src, /h-\[180px\] w-\[120px\].*sm:h-\[240px\] sm:w-\[160px\]/);
    assert.match(src, /objectPosition:\s*'center 20%'/);
    assert.match(src, /rgba\(10,12,16,0\.74\)/);
    assert.match(src, /fontSize:\s*'0\.8125rem'/);
    assert.match(src, /tabular-nums/);
    assert.match(src, /maxWidth:\s*'68ch'/);
    assert.match(src, /Ler sinopse completa/);
  });

  it('Possui as 3 abas editoriais limpas (Visão Geral, Temporadas & Episódios, Cenas & Diário) e ação Fixar nos Top 4', () => {
    const src = readSrc('src/components/WorkDetailPage.jsx');
    assert.match(src, /Visão Geral/);
    assert.match(src, /Temporadas & Episódios/);
    assert.match(src, /Cenas &amp; Diário/);
    assert.match(src, /Fixar nos Top 4/);
    assert.match(src, /Editar Metadados/);

    // Sem símbolos proibidos (R1)
    assert.equal(/[★✓✕]/u.test(src), false);
  });

  it('Aba Temporadas & Episódios unificada permite +1 Ep, +3 Eps e + Nova Temporada destravando progressão', () => {
    const serie = {
      id: 'work-2',
      title: 'Dark',
      workType: 'series',
      status: 'in-progress',
      currentSeason: 1,
      currentEpisode: 9,
      totalSeasons: 1,
      episodesPerSeason: [10],
      watchedEpisodes: {},
    };

    const p1 = advanceEpisodeProgress(serie, 1, { allowExpandSeasons: true });
    assert.equal(p1.currentSeason, 1);
    assert.equal(p1.currentEpisode, 10);

    const expanded = createExpandedSeasonPatch({ ...serie, ...p1 }, {
      defaultEpisodes: 8,
      switchToNewSeason: true,
    });
    assert.equal(expanded.totalSeasons, 2);
    assert.equal(expanded.currentSeason, 2);
    assert.deepEqual(expanded.episodesPerSeason, [10, 8]);
  });
});
