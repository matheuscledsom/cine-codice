import {
  AMBIENT_TINT_SWATCHES,
  THEME_MODES,
  buildHarmonizedThemeVars,
  getContrastForAccent,
  getContrastRatio,
} from '../src/utils/themeTokens.js';

const TEXT_MIN = 4.5;
const UI_MIN = 3.0;

const failures = [];

function checkThemeEntry(name, vars, accentHex) {
  const surfaces = [
    ['bg-canvas', vars['--bg-canvas'] || vars['--bg-app']],
    ['bg-surface', vars['--bg-surface'] || vars['--bg-card']],
    ['bg-elevated', vars['--bg-elevated']],
  ];

  const textVars = [
    ['--text-primary', vars['--text-primary']],
    ['--text-muted', vars['--text-muted']],
    ['--text-subtle', vars['--text-subtle']],
  ];

  surfaces.forEach(([surfName, surfHex]) => {
    textVars.forEach(([txtName, txtHex]) => {
      const ratio = getContrastRatio(txtHex, surfHex);
      if (ratio < TEXT_MIN) {
        failures.push(
          `${name}: ${txtName} (${txtHex}) sobre ${surfName} (${surfHex}) = ${ratio.toFixed(2)}:1 (< ${TEXT_MIN}:1)`
        );
      }
    });

    const accentUiRatio = getContrastRatio(accentHex, surfHex);
    if (accentUiRatio < UI_MIN) {
      failures.push(
        `${name}: --accent-primary (${accentHex}) sobre ${surfName} (${surfHex}) = ${accentUiRatio.toFixed(2)}:1 (< ${UI_MIN}:1)`
      );
    }
  });

  const accentInk = vars['--accent-contrast'] || getContrastForAccent(accentHex);
  const accentBtnRatio = getContrastRatio(accentInk, accentHex);
  if (accentBtnRatio < TEXT_MIN) {
    failures.push(
      `${name}: --accent-contrast (${accentInk}) sobre --accent-primary (${accentHex}) = ${accentBtnRatio.toFixed(2)}:1 (< ${TEXT_MIN}:1)`
    );
  }
}

// 1. Valida os 3 Modos Base Oficiais (dark, white, sepia)
THEME_MODES.forEach((mode) => {
  checkThemeEntry(`ModoBase:${mode.id}`, mode.vars, mode.vars['--accent-primary']);
});

// 2. Valida todas as 8 cores de ambiente curadas em cada um dos 3 modos base (24 combinações)
THEME_MODES.forEach((mode) => {
  AMBIENT_TINT_SWATCHES.forEach((swatch) => {
    const built = buildHarmonizedThemeVars(mode.id, swatch.color);
    checkThemeEntry(
      `OKLCH:${mode.id}:${swatch.id}`,
      built.vars,
      built.accentColor
    );
  });
});

// 3. Valida cores livres extremas (input type="color") em cada modo base (18 combinações)
const FREE_CUSTOM_SAMPLES = [
  '#FF0055',
  '#00FFCC',
  '#FACC15',
  '#22C55E',
  '#0F172A',
  '#38BDF8',
];
THEME_MODES.forEach((mode) => {
  FREE_CUSTOM_SAMPLES.forEach((sampleHex) => {
    const built = buildHarmonizedThemeVars(mode.id, sampleHex);
    checkThemeEntry(
      `OKLCHLivre:${mode.id}:${sampleHex}`,
      built.vars,
      built.accentColor
    );
  });
});

if (failures.length > 0) {
  console.error('FALHAS DE CONTRASTE WCAG 2.2 AA:');
  failures.forEach((line) => console.error(` - ${line}`));
  process.exit(1);
}

console.log(
  `Contraste WCAG 2.2 AA aprovado no motor OKLCH: ${THEME_MODES.length} modos base (dark, white, sepia), ${AMBIENT_TINT_SWATCHES.length} cores de ambiente curadas e ${FREE_CUSTOM_SAMPLES.length} amostras livres.`
);
