import {
  PASTEL_SUBPALETTES,
  SPECIAL_THEMES,
  buildPastelGlassTheme,
} from '../src/data/themePresets.js';
import {
  EDITORIAL_PRESETS,
  THEME_MODES,
  buildSurfaceVarsFromBg,
  getContrastForAccent,
  getContrastRatio,
} from '../src/utils/themeTokens.js';

const TEXT_MIN = 4.5;
const UI_MIN = 3.0;

const failures = [];

function checkThemeEntry(name, vars, accentHex) {
  const resolved = {
    ...vars,
    '--surface-base': vars['--surface-base'] || vars['--bg-app'],
    '--surface-elevated': vars['--surface-elevated'] || vars['--bg-card'],
    '--text-1': vars['--text-1'] || vars['--text-primary'],
    '--text-2': vars['--text-2'] || vars['--text-muted'],
    '--text-3': vars['--text-3'] || vars['--text-subtle'],
  };

  const surfaces = [
    ['bg-app', resolved['--bg-app']],
    ['bg-card', resolved['--bg-card']],
    ['bg-elevated', resolved['--bg-elevated']],
    ['surface-base', resolved['--surface-base']],
    ['surface-elevated', resolved['--surface-elevated']],
  ];

  const textVars = [
    ['--text-primary', resolved['--text-primary']],
    ['--text-muted', resolved['--text-muted']],
    ['--text-subtle', resolved['--text-subtle']],
    ['--text-1', resolved['--text-1']],
    ['--text-2', resolved['--text-2']],
    ['--text-3', resolved['--text-3']],
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
        `${name}: --accent-color (${accentHex}) sobre ${surfName} (${surfHex}) = ${accentUiRatio.toFixed(2)}:1 (< ${UI_MIN}:1)`
      );
    }
  });

  const accentInk = getContrastForAccent(accentHex);
  const accentBtnRatio = getContrastRatio(accentInk, accentHex);
  if (accentBtnRatio < TEXT_MIN) {
    failures.push(
      `${name}: --accent-contrast (${accentInk}) sobre --accent-color (${accentHex}) = ${accentBtnRatio.toFixed(2)}:1 (< ${TEXT_MIN}:1)`
    );
  }
}

THEME_MODES.forEach((mode) => {
  checkThemeEntry(`Modo:${mode.id}`, mode.vars, '#8B5CF6');
});

EDITORIAL_PRESETS.forEach((preset) => {
  const surface = buildSurfaceVarsFromBg(preset.bg, preset.card);
  checkThemeEntry(`Preset:${preset.id}`, surface.vars, preset.accent);
});

SPECIAL_THEMES.forEach((special) => {
  checkThemeEntry(`Especial:${special.id}`, special.vars, special.accent);
});

PASTEL_SUBPALETTES.forEach((sub) => {
  const built = buildPastelGlassTheme(sub.id);
  checkThemeEntry(`PastelSub:${sub.id}`, built.vars, built.accentColor);
  built.cards.forEach((cardHex, index) => {
    checkThemeEntry(
      `PastelSub:${sub.id}:Card${index + 1}`,
      { ...built.vars, '--bg-card': cardHex },
      built.accentColor
    );
  });
});

['#FFB3C6', '#38BDF8', '#FACC15', '#22C55E', '#0F172A'].forEach((sampleHex) => {
  const built = buildPastelGlassTheme('lavender-rose', sampleHex);
  checkThemeEntry(`PastelCustom:${sampleHex}`, built.vars, built.accentColor);
  built.cards.forEach((cardHex, index) => {
    checkThemeEntry(
      `PastelCustom:${sampleHex}:Card${index + 1}`,
      { ...built.vars, '--bg-card': cardHex },
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
  `Contraste WCAG 2.2 AA aprovado em ${THEME_MODES.length} modos base, ${EDITORIAL_PRESETS.length} presets e ${SPECIAL_THEMES.length} estilos especiais (+ ${PASTEL_SUBPALETTES.length} sub-paletas Pastel).`
);
