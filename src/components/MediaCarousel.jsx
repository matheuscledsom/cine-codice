import { ChevronLeft, ChevronRight, ExternalLink, Film, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { CoverArt } from './CoverArt';

function getVideoEmbedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v) return `https://www.youtube.com/embed/${v}`;
      if (url.pathname.startsWith('/shorts/')) {
        return `https://www.youtube.com/embed/${url.pathname.split('/shorts/')[1]}`;
      }
    }
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1);
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (url.hostname.includes('vimeo.com')) {
      const id = url.pathname.split('/').filter(Boolean)[0];
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    }
  } catch {
    return null;
  }
  return null;
}

function isDirectVideoFile(url) {
  return /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url || '');
}

export function MediaCarousel({
  media = [],
  fallbackItem = null,
  onRemoveSlide = null,
  aspectClass = 'aspect-square',
}) {
  const trackRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const handleScroll = () => {
    const el = trackRef.current;
    if (!el || !el.clientWidth) return;
    const nextIdx = Math.round(el.scrollLeft / el.clientWidth);
    setActiveIndex(nextIdx);
  };

  const scrollToSlide = (idx) => {
    const el = trackRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(media.length - 1, idx));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' });
    setActiveIndex(clamped);
  };

  if (media.length === 0) {
    if (!fallbackItem) return null;
    return (
      <div className={`relative w-full overflow-hidden rounded-2xl ${aspectClass}`}>
        <CoverArt item={fallbackItem} showTitle className="h-full w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-card">
        <div
          ref={trackRef}
          onScroll={handleScroll}
          className="flex snap-x snap-mandatory overflow-x-auto no-scrollbar"
        >
          {media.map((slide, index) => {
            const embedUrl =
              slide.type === 'video' ? getVideoEmbedUrl(slide.url) : null;

            return (
              <div
                key={slide.id || index}
                className={`relative w-full shrink-0 snap-center bg-black ${aspectClass}`}
              >
                {onRemoveSlide && (
                  <button
                    type="button"
                    onClick={() => onRemoveSlide(slide.id)}
                    aria-label="Remover mídia"
                    className="absolute right-2.5 top-2.5 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur-xs hover:bg-black"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}

                {slide.type === 'image' || slide.type === 'gif' ? (
                  <>
                    <img
                      src={slide.url}
                      alt={`Mídia ${index + 1}`}
                      className="h-full w-full object-cover"
                    />
                    {slide.type === 'gif' && (
                      <span className="absolute left-2.5 top-2.5 rounded-md border border-white/15 bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-accent backdrop-blur-xs">
                        GIF
                      </span>
                    )}
                  </>
                ) : isDirectVideoFile(slide.url) ? (
                  <video
                    src={slide.url}
                    controls
                    playsInline
                    className="h-full w-full object-cover"
                  />
                ) : embedUrl ? (
                  <iframe
                    src={embedUrl}
                    title={`Vídeo ${index + 1}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="h-full w-full border-0"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-elevated p-6 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 text-accent">
                      <Film className="h-6 w-6" />
                    </div>
                    <p className="max-w-xs truncate text-xs text-muted">
                      {slide.url}
                    </p>
                    <a
                      href={slide.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-xs font-semibold text-accent-ink"
                    >
                      Abrir vídeo
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {media.length > 1 && (
          <>
            {activeIndex > 0 && (
              <button
                type="button"
                onClick={() => scrollToSlide(activeIndex - 1)}
                aria-label="Slide anterior"
                className="absolute left-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-xs transition-opacity hover:bg-black/80"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {activeIndex < media.length - 1 && (
              <button
                type="button"
                onClick={() => scrollToSlide(activeIndex + 1)}
                aria-label="Próximo slide"
                className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-xs transition-opacity hover:bg-black/80"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
            <span className="absolute right-2.5 bottom-2.5 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-xs">
              {activeIndex + 1}/{media.length}
            </span>
          </>
        )}
      </div>

      {media.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 pt-0.5">
          {media.map((slide, index) => (
            <button
              key={slide.id || index}
              type="button"
              onClick={() => scrollToSlide(index)}
              aria-label={`Ir para slide ${index + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                activeIndex === index
                  ? 'w-4 bg-accent'
                  : 'w-1.5 bg-line hover:bg-muted'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
