import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const ROOT_DIR = process.cwd();

function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT_DIR, relPath), 'utf8');
}

describe('OMNIPRISM v2.4.0 — Fase 3: Direcao de Arte (docs/DESIGN.md) e UI Limpa', () => {
  it('documenta as diretrizes visuais em docs/DESIGN.md e consolida 2 valores de raio em tokens.css', () => {
    const designDoc = readFile('docs/DESIGN.md');
    const tokensCss = readFile('src/design/tokens.css');

    assert.match(designDoc, /Capa como protagonista/i);
    assert.match(designDoc, /card dentro de card/i);
    assert.match(designDoc, /44×44 px/);
    assert.match(designDoc, /tabular-nums/);
    assert.match(tokensCss, /--radius-card:\s*6px/);
    assert.match(tokensCss, /--radius-sheet:\s*14px/);
  });

  it('elimina caixas vazias pesadas (border-dashed) em todas as telas principais', () => {
    const screens = [
      'src/screens/HomeScreen.jsx',
      'src/screens/ListScreen.jsx',
      'src/screens/AddScreen.jsx',
      'src/screens/StatsScreen.jsx',
      'src/screens/ProfileScreen.jsx',
    ];
    for (const rel of screens) {
      const src = readFile(rel);
      assert.equal(
        src.includes('border-dashed'),
        false,
        `${rel} não deve usar caixas vazias pesadas com border-dashed`
      );
    }
  });

  it('mantem capa como protagonista em WorkCard sem pilulas sobre a arte e barra de progresso so quando em andamento', () => {
    const cardSrc = readFile('src/components/WorkCard.jsx');
    assert.equal(cardSrc.includes('catalog-format-badge'), false);
    assert.match(cardSrc, /const isInProgress = item\.status === 'playing' \|\| item\.status === 'rewatching'/);
    assert.match(cardSrc, /\{isInProgress && itemPct > 0 && \(/);
    assert.match(cardSrc, /StarRatingDisplay/);
    assert.match(cardSrc, /font-editorial/);
  });

  it('restringe a cor do dominio na barra de dominios e na navegacao inferior apenas a aba ativa', () => {
    const switcherSrc = readFile('src/components/DomainSwitcherBar.jsx');
    const bottomNavSrc = readFile('src/components/BottomNav.jsx');

    assert.match(switcherSrc, /border-line bg-card text-muted/);
    assert.match(switcherSrc, /min-h-\[44px\]/);
    assert.equal(bottomNavSrc.includes('border-accent/40 bg-accent/10'), false);
  });
});
