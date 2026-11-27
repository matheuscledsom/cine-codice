import { BookOpen, Clapperboard, Film, Gamepad2, Music, Tv } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { isFlagEnabled } from '../config/flags';
import { buildGeneratedPosterDataUri } from '../graphics/posterGenerator';
import {
  buildRetryCoverUrl,
  COVER_RETRY_DELAY_MS,
  MAX_COVER_IMAGE_RETRIES,
} from '../lib/coverRetry';
import { getCachedThumbnail, optimizeCoverThumbnail } from '../services/imagePipeline';

export { buildRetryCoverUrl, COVER_RETRY_DELAY_MS, MAX_COVER_IMAGE_RETRIES };

const WORK_ICONS = {
  movie: Film,
  series: Tv,
  anime: Clapperboard,
  book: BookOpen,
  manga: BookOpen,
  academic: BookOpen,
  technical: BookOpen,
  game: Gamepad2,
  dlc: Gamepad2,
  modpack: Gamepad2,
  album: Music,
  track: Music,
  ep_single: Music,
  live_show: Music,
  discography: Music,
  concert: Music,
};

const SQUARE_WORK_TYPES = new Set([
  'album',
  'track',
  'ep_single',
  'live_show',
  'discography',
  'concert',
]);

export function resolveCoverAspectClass({ domain = null, workType = 'movie', aspectRatio = null } = {}) {
  if (aspectRatio === '1:1') return 'aspect-square';
  if (aspectRatio === '2:3') return 'aspect-[2/3]';
  if (domain === 'music' || SQUARE_WORK_TYPES.has(workType)) return 'aspect-square';
  return 'aspect-[2/3]';
}

export function sanitizeHttpsCoverUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:image/')) return trimmed;
  const withProtocol = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  return withProtocol
    .replace(/^http:\/\//i, 'https://')
    .replace(/&edge=curl/gi, '')
    .replace(/\?edge=curl&?/gi, '?')
    .replace(/\?$/, '');
}

export const CoverImage = memo(function CoverImage({
  sources = [],
  title = '',
  author = '',
  director = '',
  domain = null,
  workType = 'movie',
  aspectRatio = null,
  releaseYear = '',
  genre = '',
  className = '',
  showTitle = false,
  compact = false,
  badge = null,
  priority = false,
}) {
  const creatorLabel = director || author || '';

  const cleanSources = useMemo(() => {
    const list = Array.isArray(sources) ? sources : [sources];
    return Array.from(
      new Set(list.map(sanitizeHttpsCoverUrl).filter(Boolean))
    );
  }, [sources]);

  const sourcesKey = cleanSources.join('|');
  const [activeIndex, setActiveIndex] = useState(0);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [loadedSrc, setLoadedSrc] = useState(null);
  const [cachedThumb, setCachedThumb] = useState(null);
  const retryTimerRef = useRef(null);

  useEffect(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setActiveIndex(0);
    setRetryAttempt(0);
    setLoadedSrc(null);
    setCachedThumb(null);
  }, [sourcesKey]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  const currentSrc =
    activeIndex < cleanSources.length ? cleanSources[activeIndex] : null;
  const effectiveSrc =
    cachedThumb || (currentSrc ? buildRetryCoverUrl(currentSrc, retryAttempt) : null);
  const isLoaded = Boolean(effectiveSrc && loadedSrc === effectiveSrc);
  const thumbKey = compact ? 'sm' : 'md';

  useEffect(() => {
    let active = true;
    if (!currentSrc || currentSrc.startsWith('data:')) return undefined;
    getCachedThumbnail(currentSrc, thumbKey).then((hit) => {
      if (active && hit) setCachedThumb(hit);
    });
    return () => {
      active = false;
    };
  }, [currentSrc, thumbKey]);

  const FallbackIcon = WORK_ICONS[workType] || Film;
  const hasPendingExternalSource = Boolean(effectiveSrc && !isLoaded);
  const generatedFallbackUri = useMemo(() => {
    if (isLoaded || hasPendingExternalSource || !isFlagEnabled('generatedCovers')) return null;
    return buildGeneratedPosterDataUri({
      title,
      director: creatorLabel,
      workType,
      releaseYear,
      genre,
    });
  }, [isLoaded, hasPendingExternalSource, title, creatorLabel, workType, releaseYear, genre]);

  const handleImageError = () => {
    setLoadedSrc(null);
    if (cachedThumb) {
      setCachedThumb(null);
      return;
    }
    if (
      currentSrc &&
      !currentSrc.startsWith('data:') &&
      !currentSrc.startsWith('blob:') &&
      retryAttempt < MAX_COVER_IMAGE_RETRIES
    ) {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        setRetryAttempt((prev) => prev + 1);
      }, COVER_RETRY_DELAY_MS);
      return;
    }
    setRetryAttempt(0);
    setActiveIndex((prev) => prev + 1);
  };

  const aspectClass = resolveCoverAspectClass({ domain, workType, aspectRatio });
  const isSquare = aspectClass === 'aspect-square';

  return (
    <div
      className={`relative ${aspectClass} overflow-hidden rounded-[6px] border border-line bg-elevated select-none ${className}`}
    >
      {hasPendingExternalSource ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 motion-safe:animate-pulse bg-card"
        />
      ) : generatedFallbackUri && !isLoaded ? (
        <img
          src={generatedFallbackUri}
          alt={title || 'Cartaz editorial gerado'}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div
          className={`absolute inset-0 flex flex-col justify-between bg-card p-2.5 transition-opacity duration-150 ${
            isLoaded ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="flex h-6 w-6 items-center justify-center rounded-[4px] border border-line bg-app text-muted">
              <FallbackIcon
                className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}
                strokeWidth={1.5}
              />
            </span>
            {!compact && badge && (
              <span className="truncate rounded-[4px] border border-line bg-app px-1.5 py-0.5 text-[10px] font-medium tracking-wider text-muted">
                {badge}
              </span>
            )}
          </div>

          <div className="space-y-1 border-t border-line pt-2">
            {title && (
              <p
                className={`font-semibold leading-tight text-ink ${
                  compact ? 'line-clamp-3 text-[10px]' : 'line-clamp-3 text-xs'
                }`}
              >
                {title}
              </p>
            )}
            {creatorLabel && !compact && (
              <p className="line-clamp-1 text-[10px] text-muted">{creatorLabel}</p>
            )}
          </div>
        </div>
      )}

      {effectiveSrc && (
        <>
          <img
            key={effectiveSrc}
            src={effectiveSrc}
            alt={title || 'Capa da obra'}
            width={isSquare ? 300 : 200}
            height={300}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={priority ? 'high' : 'low'}
            referrerPolicy="no-referrer"
            onLoad={(e) => {
              if (
                e.currentTarget.naturalWidth < 15 ||
                e.currentTarget.naturalHeight < 15
              ) {
                handleImageError();
                return;
              }
              setLoadedSrc(effectiveSrc);
              if (!cachedThumb && currentSrc && !currentSrc.startsWith('data:')) {
                optimizeCoverThumbnail(currentSrc, thumbKey, title).catch(() => {});
              }
            }}
            onError={handleImageError}
            className={`relative h-full w-full object-cover transition-opacity duration-150 ${
              isLoaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
          {showTitle && isLoaded && title && (
            <div className="absolute inset-x-0 bottom-0 border-t border-black/30 bg-black/75 p-2">
              <p className="line-clamp-2 text-[10px] font-medium leading-tight text-white">
                {title}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
});
