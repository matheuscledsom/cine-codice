import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { domainConfig } from '../src/config/domainConfig.js';
import {
  AMBIENT_TINT_SWATCHES,
  THEME_MODES,
  buildHarmonizedThemeVars,
  getContrastRatio,
  hexToOklch,
  oklchToHex,
} from '../src/utils/themeTokens.js';

describe('FASE 1 (v1.3.0) — Motor Visual OKLCH (Dark, White, Sepia + Cor de Ambiente) & Vocabulário Catálogo', () => {
  it('Define exatamente os 3 modos base oficiais (dark, white, sepia) e os 8 swatches curados de ambiente sem os 21 presets antigos', () => {
    assert.deepEqual(
      THEME_MODES.map((m) => m.id),
      ['dark', 'white', 'sepia']
    );
    assert.equal(THEME_MODES[0].previewBg, '#0B0D12');
    assert.equal(THEME_MODES[1].previewBg, '#F7F8FA');
    assert.equal(THEME_MODES[1].previewCard, '#FFFFFF');
    assert.equal(THEME_MODES[2].previewBg, '#F3EDE2');
    assert.equal(THEME_MODES[2].previewCard, '#FAF6EE');

    assert.equal(AMBIENT_TINT_SWATCHES.length, 8);
    assert.equal(AMBIENT_TINT_SWATCHES[0].id, 'neutral');
    assert.equal(AMBIENT_TINT_SWATCHES[1].id, 'midnight-blue');

    const tokensSrc = fs.readFileSync(path.resolve('src/utils/themeTokens.js'), 'utf8');
    assert.equal(/EDITORIAL_PRESETS|SPECIAL_THEMES|PASTEL_SUBPALETTES/.test(tokensSrc), false);
  });

  it('buildHarmonizedThemeVars gera as 5 variáveis derivadas OKLCH (10% canvas, 14% surface, 18% elevated, 14% hairline e acento AA >= 4.5:1)', () => {
    const sampleOklch = hexToOklch('#2563EB');
    assert.equal(sampleOklch.l > 0 && sampleOklch.l < 1, true);
    const roundTrip = oklchToHex(sampleOklch.l, sampleOklch.c, sampleOklch.h);
    assert.match(roundTrip, /^#[0-9A-F]{6}$/);

    for (const mode of THEME_MODES) {
      for (const swatch of AMBIENT_TINT_SWATCHES) {
        const res = buildHarmonizedThemeVars(mode.id, swatch.color);
        const v = res.vars;

        assert.match(v['--bg-canvas'], /^#[0-9A-F]{6}$/);
        assert.match(v['--bg-surface'], /^#[0-9A-F]{6}$/);
        assert.match(v['--bg-elevated'], /^#[0-9A-F]{6}$/);
        assert.match(v['--border-hairline'], /^#[0-9A-F]{6}$/);
        assert.match(v['--accent-primary'], /^#[0-9A-F]{6}$/);
        assert.match(v['--accent-contrast'], /^#[0-9A-F]{6}$/);

        // Quando há cor de ambiente, canvas != surface != elevated (profundidade natural)
        if (swatch.color) {
          assert.notEqual(v['--bg-canvas'], v['--bg-surface']);
          assert.notEqual(v['--bg-surface'], v['--bg-elevated']);
        }

        // Contraste WCAG 2.2 AA >= 4.5:1 para textos e botão de acento
        for (const surf of [v['--bg-canvas'], v['--bg-surface'], v['--bg-elevated']]) {
          assert.equal(getContrastRatio(v['--text-primary'], surf) >= 4.5, true);
          assert.equal(getContrastRatio(v['--text-muted'], surf) >= 4.5, true);
          assert.equal(getContrastRatio(v['--text-subtle'], surf) >= 4.5, true);
          assert.equal(getContrastRatio(v['--accent-primary'], surf) >= 3.0, true);
        }
        assert.equal(
          getContrastRatio(v['--accent-contrast'], v['--accent-primary']) >= 4.5,
          true
        );
      }
    }
  });

  it('Padroniza vocabulário para "Catálogo" e elimina "Cinemateca" e "Acervo" das telas e configurações', () => {
    const navList = domainConfig.navigation.find((n) => n.id === 'list');
    assert.equal(navList?.label, 'Catálogo');
    assert.equal(domainConfig.ui.list.title, 'Catálogo');
    assert.equal(domainConfig.ui.add.drawerSaveLabel, 'Guardar no Catálogo');
    assert.equal(domainConfig.ui.add.suggestionsLabel, 'Sugestões do Catálogo');

    const screens = [
      'src/screens/HomeScreen.jsx',
      'src/screens/ListScreen.jsx',
      'src/screens/AddScreen.jsx',
      'src/screens/StatsScreen.jsx',
      'src/screens/ProfileScreen.jsx',
      'src/components/WorkDetailPage.jsx',
      'src/components/BottomNav.jsx',
    ];
    for (const rel of screens) {
      const content = fs.readFileSync(path.resolve(rel), 'utf8');
      assert.equal(
        /\bcinemateca\b|\bacervo\b/i.test(content),
        false,
        `Vocabulário antigo encontrado em ${rel}`
      );
    }
  });
});
