import { OMNIPRISM_DOMAINS } from '../config/domainConfig';

export function OmniLogo({
  size = 28,
  className = '',
  decorative = true,
  label = 'OmniPrism',
}) {
  const beams = OMNIPRISM_DOMAINS.map((d) => d.beamHex);
  const cinemaColor = beams[0];
  const readingColor = beams[1];
  const gamesColor = beams[2];
  const musicColor = beams[3];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={decorative ? 'true' : undefined}
      aria-label={decorative ? undefined : label}
      role={decorative ? undefined : 'img'}
      className={`shrink-0 ${className}`.trim()}
    >
      {/* Feixe incidente */}
      <line
        x1="2.5"
        y1="20"
        x2="10.4"
        y2="15.8"
        stroke="currentColor"
        strokeOpacity="0.88"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Faceta e cone de dispersao interna */}
      <polygon
        points="14.6,6.2 6.8,24.4 22.4,24.4"
        fill="currentColor"
        fillOpacity="0.08"
      />
      <polygon
        points="10.4,15.8 17.9,13.9 20.1,19.1"
        fill="currentColor"
        fillOpacity="0.14"
      />
      {/* 4 feixes refratados dos 4 mundos */}
      <line
        x1="17.8"
        y1="13.8"
        x2="29.2"
        y2="10.4"
        stroke={cinemaColor}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="18.6"
        y1="15.6"
        x2="29.6"
        y2="14.5"
        stroke={readingColor}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="19.4"
        y1="17.4"
        x2="29.6"
        y2="18.6"
        stroke={gamesColor}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="20.1"
        y1="19.2"
        x2="29.2"
        y2="22.6"
        stroke={musicColor}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Contorno geometrico do prisma */}
      <polygon
        points="14.6,6.2 6.8,24.4 22.4,24.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}
