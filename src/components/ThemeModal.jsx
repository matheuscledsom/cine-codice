import { Check, Layers, Palette, RotateCcw, SlidersHorizontal, Type } from 'lucide-react';
import {
  DENSITY_OPTIONS,
  EDITORIAL_PRESETS,
  FONT_PRESETS,
  MOTION_OPTIONS,
  PASTEL_SUBPALETTES,
  SPECIAL_THEMES,
  TEXTURE_OPTIONS,
  THEME_MODES,
} from '../hooks/useTheme';
import { ResponsiveSheet } from './ResponsiveSheet';

function SpecialThemeMiniature({ special }) {
  const vars = special.vars || {};
  const bg = vars['--bg-app'] || special.previewBg;
  const card = vars['--bg-card'] || special.previewCard;
  const border = vars['--border-subtle'] || 'rgba(0,0,0,0.2)';
  const text = vars['--text-primary'] || '#111111';
  const accent = special.previewAccent;
  const isXp = special.id === 'windows-xp';
  const isWin7 = special.id === 'windows-7';
  const isAero = special.id === 'frutiger-aero';
  const isManga = special.id === 'manga-ink';
  const isPastel = special.id === 'pastel-glass';

  return (
    <div
      aria-hidden="true"
      className="relative h-12 w-full overflow-hidden rounded-[4px] border p-1.5"
      style={{
        backgroundColor: bg,
        borderColor: isManga ? '#111111' : border,
        borderWidth: isXp || isManga ? '2px' : '1px',
        backgroundImage: isManga
          ? 'radial-gradient(rgba(17,17,17,0.16) 1px, transparent 1px)'
          : isWin7
            ? 'linear-gradient(125deg, rgba(255,255,255,0.14) 0%, transparent 45%)'
            : undefined,
        backgroundSize: isManga ? '5px 5px' : undefined,
      }}
    >
      <div
        className="mb-1 flex h-2.5 w-full items-center justify-between rounded-[2px] px-1"
        style={{
          background: isXp
            ? '#0054E3'
            : isAero
              ? 'linear-gradient(180deg, rgba(14,165,233,0.45), rgba(16,185,129,0.25))'
              : isPastel
                ? 'color-mix(in srgb, #FFFFFF 75%, transparent)'
                : card,
          borderBottom: `1px solid ${border}`,
        }}
      >
        <span
          className="h-1 w-6 rounded-full"
          style={{ backgroundColor: isXp ? '#FFFFFF' : text, opacity: 0.85 }}
        />
        <span
          className="h-1.5 w-2.5 rounded-full"
          style={{ backgroundColor: isXp ? '#3C9D2A' : accent }}
        />
      </div>
      <div
        className="flex h-5 items-center justify-between rounded-[2px] border px-1.5"
        style={{
          backgroundColor: card,
          borderColor: isManga ? '#111111' : border,
        }}
      >
        <span
          className="h-1.5 w-8 rounded-full"
          style={{ backgroundColor: text, opacity: 0.7 }}
        />
        <span
          className="h-2 w-4 rounded-full"
          style={{ backgroundColor: accent }}
        />
      </div>
    </div>
  );
}

export function PastelPaletteCustomizer({
  pastelSubpaletteId = 'lavender-rose',
  pastelCustomColor = '#C084FC',
  onSelectPastelSubpalette,
  onChangePastelColor,
}) {
  return (
    <div className="mt-3 space-y-2.5 rounded-xl border border-line bg-app p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
          <Palette className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
          Customização de Paleta Pastel
        </span>
        <span className="text-[10px] text-subtle">Tempo real</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {PASTEL_SUBPALETTES.map((sub) => {
          const isSubActive =
            pastelSubpaletteId === sub.id &&
            String(pastelCustomColor || '').toUpperCase() ===
              sub.baseColor.toUpperCase();
          return (
            <button
              key={sub.id}
              type="button"
              aria-pressed={isSubActive}
              onClick={() => onSelectPastelSubpalette?.(sub.id)}
              className={`flex min-h-[44px] items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-left text-[11px] font-medium transition-colors ${
                isSubActive
                  ? 'border-accent bg-accent/15 text-ink'
                  : 'border-line bg-card text-muted hover:text-ink'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{sub.label}</span>
              <span className="flex shrink-0 items-center -space-x-1" aria-hidden="true">
                {sub.cards.slice(0, 3).map((tone) => (
                  <span
                    key={tone}
                    className="h-3.5 w-3.5 rounded-full border border-black/15"
                    style={{ backgroundColor: tone }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 rounded-xl border border-line bg-card px-3 py-2 transition-colors hover:border-accent/50">
        <div className="min-w-0">
          <span className="block text-[11px] font-medium text-ink">
            Cor Pastel Livre
          </span>
          <span className="block font-mono text-[10px] tabular-nums text-subtle">
            {pastelCustomColor}
          </span>
        </div>
        <input
          type="color"
          value={pastelCustomColor}
          onChange={(e) => onChangePastelColor?.(e.target.value)}
          aria-label="Selecionar cor livre da paleta pastel"
          className="h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-full border border-line bg-transparent p-0"
        />
      </label>
    </div>
  );
}

export function ThemeModal({
  isOpen,
  onClose,
  mode,
  font,
  texture = 'clean',
  density = 'comfortable',
  motion = 'system',
  presetId,
  specialThemeId = null,
  pastelSubpaletteId = 'lavender-rose',
  pastelCustomColor = '#C084FC',
  bgColor,
  accentColor,
  hasCustomBg,
  onSelectMode,
  onSelectFont,
  onSelectTexture,
  onSelectDensity,
  onSelectMotion,
  onApplyPreset,
  onApplySpecialTheme,
  onSelectPastelSubpalette,
  onChangePastelColor,
  onChangeBgColor,
  onChangeAccentColor,
  onResetTheme,
}) {
  return (
    <ResponsiveSheet
      isOpen={isOpen}
      onClose={onClose}
      icon={Palette}
      title="Temas & Aparência"
      subtitle="Materiais, tipografia editorial, densidade e movimento"
      ariaLabel="Temas e Aparência"
      headerActions={
        <button
          type="button"
          onClick={onResetTheme}
          title="Restaurar padrão"
          className="inline-flex min-h-[38px] items-center gap-1 rounded-[4px] border border-line bg-app px-2.5 py-1 text-[11px] font-medium text-muted hover:text-ink"
        >
          <RotateCcw className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
          <span>Padrão</span>
        </button>
      }
    >
      <div className="space-y-5">

        {/* 10 Tipografias Globais */}
        <div className="mt-5">
          <p className="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-muted">
            <Type className="h-4 w-4 text-accent" strokeWidth={1.5} />
            Tipografia Global (10 Fontes)
          </p>
          <div className="grid grid-cols-2 gap-2">
            {FONT_PRESETS.map((f) => {
              const isSelected = font === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onSelectFont(f.id)}
                  style={{ fontFamily: f.cssValue }}
                  className={`flex min-h-[44px] items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    isSelected
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-app text-muted hover:text-ink'
                  }`}
                >
                  <div className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-ink">
                      {f.shortLabel}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-subtle">
                      Abc · {f.fontName}
                    </span>
                  </div>
                  {isSelected && (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink">
                      <Check className="h-3 w-3" strokeWidth={1.5} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 6 Estilos Visuais Especiais */}
        <div className="mt-5">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
              <Palette className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              Estilos Especiais &amp; Vidro
            </p>
            <span className="text-[10px] text-subtle">6 estilos completos</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {SPECIAL_THEMES.map((special) => {
              const isSelected = specialThemeId === special.id;
              return (
                <button
                  key={special.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onApplySpecialTheme?.(special.id)}
                  className={`flex min-h-[48px] flex-col gap-2 rounded-[6px] border p-2 text-left transition-colors ${
                    isSelected
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-app text-muted hover:text-ink'
                  }`}
                >
                  <SpecialThemeMiniature special={special} />
                  <div className="flex w-full items-center justify-between gap-1.5">
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-semibold text-ink">
                        {special.label}
                      </span>
                      <span className="block truncate text-[10px] text-subtle">
                        {special.subtitle}
                      </span>
                    </div>
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.5} />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {specialThemeId === 'pastel-glass' && (
            <PastelPaletteCustomizer
              pastelSubpaletteId={pastelSubpaletteId}
              pastelCustomColor={pastelCustomColor}
              onSelectPastelSubpalette={onSelectPastelSubpalette}
              onChangePastelColor={onChangePastelColor}
            />
          )}
        </div>

        {/* 3 Atmosferas Base */}
        <div className="mt-5">
          <p className="mb-2.5 text-xs font-medium text-muted">
            Atmosferas Base
          </p>
          <div className="grid grid-cols-3 gap-2">
            {THEME_MODES.map((m) => {
              const isSelected =
                !specialThemeId && !hasCustomBg && !presetId && mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onSelectMode(m.id)}
                  className={`flex flex-col items-center gap-2 rounded-2xl border p-2.5 transition-all ${
                    isSelected
                      ? 'border-accent bg-accent/10'
                      : 'border-line bg-app hover:border-muted/50'
                  }`}
                >
                  <div
                    className="flex h-10 w-full items-end justify-between rounded-xl border border-black/15 p-1.5"
                    style={{ backgroundColor: m.previewBg }}
                  >
                    <span
                      className="h-3 w-8 rounded"
                      style={{ backgroundColor: m.previewCard }}
                    />
                    {isSelected && (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-ink">
                        <Check className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </div>
                  <span className="line-clamp-2 text-center text-[10px] font-medium leading-tight text-ink">
                    {m.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Textura de Ambiente */}
        <div className="mt-5">
          <p className="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-muted">
            <Layers className="h-3.5 w-3.5 text-accent" />
            Textura de Ambiente
          </p>
          <div className="grid grid-cols-2 gap-2">
            {TEXTURE_OPTIONS.map((tex) => {
              const isSelected = texture === tex.id;
              return (
                <button
                  key={tex.id}
                  type="button"
                  onClick={() => onSelectTexture?.(tex.id)}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-[11px] font-medium transition-colors ${
                    isSelected
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-app text-muted hover:text-ink'
                  }`}
                >
                  <span>{tex.label}</span>
                  {isSelected && <Check className="h-3 w-3 text-accent" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Seletores Livres (Color Picker) */}
        <div className="mt-5">
          <p className="mb-2.5 text-xs font-medium text-muted">
            Cores Personalizadas
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-line bg-app px-3 py-2.5 transition-colors hover:border-accent/50">
              <div className="min-w-0">
                <span className="block text-[11px] font-medium text-ink">
                  Cor de Fundo
                </span>
                <span className="block text-[10px] font-mono text-subtle">
                  {bgColor}
                </span>
              </div>
              <input
                type="color"
                value={bgColor}
                onChange={(e) => onChangeBgColor(e.target.value)}
                aria-label="Selecionar cor de fundo"
                className="h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-full border border-line bg-transparent p-0"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-line bg-app px-3 py-2.5 transition-colors hover:border-accent/50">
              <div className="min-w-0">
                <span className="block text-[11px] font-medium text-ink">
                  Destaque / Ícones
                </span>
                <span className="block text-[10px] font-mono text-subtle">
                  {accentColor}
                </span>
              </div>
              <input
                type="color"
                value={accentColor}
                onChange={(e) => onChangeAccentColor(e.target.value)}
                aria-label="Selecionar cor de destaque e ícones"
                className="h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-full border border-line bg-transparent p-0"
              />
            </label>
          </div>
        </div>

        {/* Densidade e Movimento */}
        {(onSelectDensity || onSelectMotion) && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {onSelectDensity && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                  Densidade
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {DENSITY_OPTIONS.map((opt) => {
                    const active = density === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onSelectDensity(opt.id)}
                        className={`min-h-[44px] rounded-[4px] border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                          active
                            ? 'border-accent bg-accent/15 text-ink'
                            : 'border-line bg-app text-muted hover:text-ink'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {onSelectMotion && (
              <div>
                <p className="mb-2 text-xs font-medium text-muted">
                  Animações &amp; Movimento
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {MOTION_OPTIONS.map((opt) => {
                    const active = motion === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onSelectMotion(opt.id)}
                        className={`min-h-[44px] rounded-[4px] border px-2 py-1.5 text-[10px] font-medium transition-colors ${
                          active
                            ? 'border-accent bg-accent/15 text-ink'
                            : 'border-line bg-app text-muted hover:text-ink'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 22 Presets Temáticos */}
        <div>
          <p className="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-muted">
            <Layers className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
            22 Presets Temáticos
          </p>
          <div className="grid grid-cols-2 gap-2">
            {EDITORIAL_PRESETS.map((preset) => {
              const isSelected = presetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onApplyPreset(preset.id)}
                  className={`flex min-h-[44px] items-center gap-2.5 rounded-[4px] border px-3 py-2 text-left text-xs font-medium transition-colors ${
                    isSelected
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-app text-muted hover:text-ink'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="h-5 w-5 shrink-0 rounded-full border border-white/20"
                    style={{
                      background: `linear-gradient(135deg, ${preset.bg} 50%, ${preset.accent} 50%)`,
                    }}
                  />
                  <span className="truncate text-[11px]">{preset.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </ResponsiveSheet>
  );
}
