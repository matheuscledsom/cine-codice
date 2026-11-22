import {
  Check,
  Layers,
  Moon,
  Palette,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Type,
} from 'lucide-react';
import {
  AMBIENT_TINT_SWATCHES,
  DENSITY_OPTIONS,
  FONT_PRESETS,
  MOTION_OPTIONS,
  TEXTURE_OPTIONS,
  THEME_MODES,
} from '../hooks/useTheme';
import { buildHarmonizedThemeVars } from '../utils/themeTokens';
import { ResponsiveSheet } from './ResponsiveSheet';

const MODE_ICONS = {
  dark: Moon,
  white: Sun,
  sepia: Sparkles,
};

export function ThemeModal({
  isOpen,
  onClose,
  mode = 'dark',
  bgTintColor = null,
  font = 'source-sans',
  texture = 'clean',
  density = 'comfortable',
  motion = 'system',
  bgColor,
  accentColor,
  onSelectMode,
  onChangeBgTintColor,
  onChangeBgColor,
  onSelectFont,
  onSelectTexture,
  onSelectDensity,
  onSelectMotion,
  onResetTheme,
}) {
  const handleSelectTint = (nextHexOrNull) => {
    if (onChangeBgTintColor) {
      onChangeBgTintColor(nextHexOrNull);
    } else if (onChangeBgColor) {
      onChangeBgColor(nextHexOrNull);
    }
  };

  const previewPalette = buildHarmonizedThemeVars(mode, bgTintColor);
  const currentTintHex =
    bgTintColor ||
    AMBIENT_TINT_SWATCHES[1]?.previewHex ||
    accentColor;

  return (
    <ResponsiveSheet
      isOpen={isOpen}
      onClose={onClose}
      icon={Palette}
      title="Aparência & Motor OKLCH"
      subtitle="3 modos base (Dark, White, Sépia) com cor de ambiente harmonizada"
      ariaLabel="Aparência e Motor de Cores OKLCH"
      headerActions={
        <button
          type="button"
          onClick={onResetTheme}
          title="Restaurar padrão"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line bg-app px-3 py-1.5 text-xs font-medium text-muted hover:border-accent hover:text-ink"
        >
          <RotateCcw className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
          <span>Padrão</span>
        </button>
      }
    >
      <div className="space-y-5">
        {/* 1. OS 3 MODOS BASE OFICIAIS: DARK, WHITE, SÉPIA */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
              <Layers className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              <span>Modo Base</span>
            </span>
            <span className="text-[11px] text-subtle">
              Contraste WCAG 2.2 AA garantido
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {THEME_MODES.map((m) => {
              const isSelected = mode === m.id;
              const IconComp = MODE_ICONS[m.id] || Moon;
              const previewForMode = buildHarmonizedThemeVars(m.id, bgTintColor);

              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelectMode?.(m.id)}
                  className={`flex min-h-[88px] flex-col justify-between rounded-2xl border p-3 text-left transition-all ${
                    isSelected
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-app text-muted hover:border-accent/50 hover:text-ink'
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-1.5">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ink">
                      <IconComp className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                      <span>{m.shortLabel}</span>
                    </span>
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                    )}
                  </div>

                  {/* Miniatura de superfície harmonizada */}
                  <div
                    aria-hidden="true"
                    className="mt-2 flex h-7 w-full items-center justify-between rounded-lg border px-2"
                    style={{
                      backgroundColor: previewForMode.vars['--bg-canvas'],
                      borderColor: previewForMode.vars['--border-hairline'],
                    }}
                  >
                    <span
                      className="h-3 w-8 rounded-sm border"
                      style={{
                        backgroundColor: previewForMode.vars['--bg-surface'],
                        borderColor: previewForMode.vars['--border-hairline'],
                      }}
                    />
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{
                        backgroundColor: previewForMode.vars['--accent-primary'],
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* 2. COR DE AMBIENTE / FUNDO COM HARMONIZAÇÃO OKLCH (8 SWATCHES + COR LIVRE) */}
        <section className="space-y-3 rounded-2xl border border-line bg-app p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
                <Palette className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                <span>Cor de Ambiente / Fundo (OKLCH)</span>
              </span>
              <p className="mt-0.5 text-[11px] text-subtle">
                Mistura sutil de 10% no fundo, 14% nos cards e 18% em superfícies elevadas
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {AMBIENT_TINT_SWATCHES.map((swatch) => {
              const isSelected =
                swatch.color === null
                  ? !bgTintColor
                  : String(bgTintColor || '').toUpperCase() ===
                    String(swatch.color).toUpperCase();
              const swatchPreview = buildHarmonizedThemeVars(mode, swatch.color);

              return (
                <button
                  key={swatch.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => handleSelectTint(swatch.color)}
                  className={`flex min-h-[48px] items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors ${
                    isSelected
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-card text-muted hover:border-accent/50 hover:text-ink'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{swatch.label}</span>
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 rounded-full border border-line"
                    style={{
                      backgroundColor: swatchPreview.vars['--accent-primary'],
                    }}
                  />
                </button>
              );
            })}
          </div>

          {/* Seletor de Cor Livre + Preview Instantâneo das 5 Variáveis OKLCH */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card p-3">
            <label className="flex min-h-[44px] flex-1 cursor-pointer items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="block text-xs font-semibold text-ink">
                  Cor Livre Personalizada
                </span>
                <span className="block font-mono text-[10px] tabular-nums text-subtle">
                  {bgTintColor || 'Neutro ativo'} · Canvas {previewPalette.vars['--bg-canvas']}
                </span>
              </div>
              <input
                type="color"
                value={currentTintHex}
                onChange={(e) => handleSelectTint(e.target.value)}
                aria-label="Escolher cor de ambiente livre"
                className="h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-line bg-transparent p-0"
              />
            </label>
          </div>
        </section>

        {/* 3. TIPOGRAFIA EDITORIAL */}
        <section className="space-y-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
            <Type className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
            <span>Tipografia</span>
          </span>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {FONT_PRESETS.map((f) => {
              const active = font === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelectFont?.(f.id)}
                  style={{ fontFamily: f.cssValue }}
                  className={`flex min-h-[44px] items-center justify-between rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                    active
                      ? 'border-accent bg-accent/15 font-semibold text-ink'
                      : 'border-line bg-app text-muted hover:text-ink'
                  }`}
                >
                  <span className="truncate">{f.label}</span>
                  {active && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.5} />
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* 4. DENSIDADE, MOVIMENTO & TEXTURA */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5 rounded-xl border border-line bg-app p-3">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink">
              <SlidersHorizontal className="h-3 w-3 text-accent" strokeWidth={1.5} />
              <span>Densidade</span>
            </span>
            <div className="grid grid-cols-2 gap-1">
              {DENSITY_OPTIONS.map((opt) => {
                const active = density === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelectDensity?.(opt.id)}
                    className={`min-h-[44px] rounded-lg border px-2 text-[11px] font-medium ${
                      active
                        ? 'border-accent bg-accent text-accent-ink'
                        : 'border-line bg-card text-muted hover:text-ink'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5 rounded-xl border border-line bg-app p-3">
            <span className="block text-[11px] font-semibold text-ink">
              Movimento
            </span>
            <div className="grid grid-cols-3 gap-1">
              {MOTION_OPTIONS.map((opt) => {
                const active = motion === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelectMotion?.(opt.id)}
                    className={`min-h-[44px] rounded-lg border px-1.5 text-[10px] font-medium ${
                      active
                        ? 'border-accent bg-accent text-accent-ink'
                        : 'border-line bg-card text-muted hover:text-ink'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5 rounded-xl border border-line bg-app p-3">
            <span className="block text-[11px] font-semibold text-ink">
              Acabamento
            </span>
            <div className="grid grid-cols-2 gap-1">
              {TEXTURE_OPTIONS.map((opt) => {
                const active = texture === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelectTexture?.(opt.id)}
                    className={`min-h-[44px] rounded-lg border px-2 text-[10px] font-medium ${
                      active
                        ? 'border-accent bg-accent text-accent-ink'
                        : 'border-line bg-card text-muted hover:text-ink'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </ResponsiveSheet>
  );
}
