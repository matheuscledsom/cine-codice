import { Stamp } from 'lucide-react';
import { computePassportStamps } from '../utils/passportStamps';

function PassportStampSvg({ code, unlocked, index }) {
  const tilt = index % 2 === 0 ? -6 : 5;
  const strokeColor = unlocked ? 'var(--accent-color)' : 'var(--text-subtle)';
  return (
    <svg
      viewBox="0 0 88 88"
      width="72"
      height="72"
      aria-hidden="true"
      className="mx-auto shrink-0"
      style={{
        transform: `rotate(${tilt}deg)`,
        opacity: unlocked ? 1 : 0.42,
      }}
    >
      <circle
        cx="44"
        cy="44"
        r="36"
        fill="none"
        stroke={strokeColor}
        strokeWidth="2"
        strokeDasharray={unlocked ? undefined : '4 3'}
      />
      <circle
        cx="44"
        cy="44"
        r="29"
        fill="none"
        stroke={strokeColor}
        strokeWidth="1"
        strokeOpacity="0.7"
      />
      <line x1="16" y1="35" x2="72" y2="35" stroke={strokeColor} strokeWidth="0.9" strokeOpacity="0.6" />
      <line x1="16" y1="53" x2="72" y2="53" stroke={strokeColor} strokeWidth="0.9" strokeOpacity="0.6" />
      <text
        x="44"
        y="47"
        textAnchor="middle"
        fontSize="10.5"
        fontWeight="700"
        fontFamily="monospace"
        fill={strokeColor}
      >
        {code}
      </text>
      <text
        x="44"
        y="27"
        textAnchor="middle"
        fontSize="7"
        fontWeight="600"
        fill={strokeColor}
      >
        LUMIÈRE
      </text>
      <text
        x="44"
        y="65"
        textAnchor="middle"
        fontSize="6.5"
        fontWeight="600"
        fill={strokeColor}
      >
        {unlocked ? 'VISTO' : 'PEND.'}
      </text>
    </svg>
  );
}

export function ReaderPassportWidget({
  items = [],
  posts = [],
  streakCount = 0,
}) {
  const stamps = computePassportStamps({ items, posts, streakCount });
  const unlockedCount = stamps.filter((s) => s.unlocked).length;

  return (
    <section
      aria-label="Carteira do Catálogo"
      className="rounded-[6px] border border-line bg-card p-3.5 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Stamp className="h-4 w-4 text-accent" strokeWidth={1.5} />
          <div>
            <h3 className="text-xs font-semibold text-ink">
              Carteira do Catálogo
            </h3>
            <p className="text-[11px] text-subtle tabular-nums">
              {unlockedCount}/{stamps.length} carimbos de cineclubista conquistados
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {stamps.map((stamp, idx) => (
          <div
            key={stamp.id}
            className={`flex flex-col items-center rounded-[4px] border px-2.5 py-3 text-center ${
              stamp.unlocked
                ? 'border-accent/45 bg-app'
                : 'border-dashed border-line bg-app/50'
            }`}
          >
            <PassportStampSvg code={stamp.code} unlocked={stamp.unlocked} index={idx} />
            <p className="mt-2 text-xs font-semibold text-ink">{stamp.title}</p>
            <p className="mt-0.5 text-[10px] leading-snug text-muted">
              {stamp.requirement}
            </p>
            <span className="mt-1.5 rounded-[2px] border border-line bg-card px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-accent">
              {stamp.progressLabel}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
