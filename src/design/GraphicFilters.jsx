export function GraphicFilters() {
  return (
    <svg
      aria-hidden="true"
      width="0"
      height="0"
      className="pointer-events-none absolute h-0 w-0 overflow-hidden"
    >
      <defs>
        <filter id="paper-grain" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.8"
            numOctaves="2"
            seed="7"
            result="noise"
          />
          <feColorMatrix
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.035 0"
            in="noise"
            result="softNoise"
          />
          <feBlend mode="multiply" in="SourceGraphic" in2="softNoise" />
        </filter>

        <filter id="ink-bleed" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.06"
            numOctaves="2"
            seed="3"
            result="turb"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="turb"
            scale="0.85"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        <pattern
          id="screentone"
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="2" cy="2" r="0.85" fill="currentColor" opacity="0.1" />
          <circle cx="6" cy="6" r="0.85" fill="currentColor" opacity="0.07" />
        </pattern>
      </defs>
    </svg>
  );
}
