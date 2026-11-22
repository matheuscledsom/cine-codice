import { Clapperboard, Film, Tv } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isFlagEnabled } from '../config/flags';
import { buildGeneratedPosterDataUri } from '../graphics/posterGenerator';
import { getCachedThumbnail, optimizeCoverThumbnail } from '../services/imagePipeline';

const WORK_ICONS = {
  movie: Film,
  series: Tv,
  anime: Clapperboard,
};

export function sanitizeHttpsCoverUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:image/')) return trimmed;
  return trimmed
    .replace(/^http:\/\//i, 'https://')
    .replace(/&edge=curl/gi, '')
    .replace(/\?edge=curl&?/gi, '?')
    .replace(/\?$/, '');
}

export function CoverImage({
  sources = [],
  title = '',
  author = '',
  director = '',
  workType = 'movie',
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
  const [loadedSrc, setLoadedSrc] = useState(null);
  const [cachedThumb, setCachedThumb] = useState(null);

  useEffect(() => {
    setActiveIndex(0);
    setLoadedSrc(null);
    setCachedThumb(null);
  }, [sourcesKey]);

  const currentSrc =
    activeIndex < cleanSources.length ? cleanSources[activeIndex] : null;
  const effectiveSrc = cachedThumb || currentSrc;
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
    setActiveIndex((prev) => prev + 1);
  };

  return (
    <div
      className={`relative aspect-[2/3] overflow-hidden rounded-[4px] border-2 border-line bg-elevated select-none ${className}`}
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
            alt={title || 'Pôster da obra'}
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
}
