import { Bookmark, Film, ImagePlus, Plus, Search, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { domainConfig } from '../config/domainConfig';
import { isDirectGifUrl, searchOpenverseGifs } from '../services/gifApi';
import { formatFlexibleProgressMetric } from '../utils/backlogHelpers';
import { compressImageFile, readFileAsDataUrl } from '../utils/imageUtils';
import { MediaCarousel } from './MediaCarousel';

function deriveDefaultMarker(item) {
  if (!item) return '';
  return item.checkpoint || formatFlexibleProgressMetric(item) || '';
}

export function JournalComposerModal({
  isOpen,
  onClose,
  items = [],
  initialItemId = null,
  onPublish,
}) {
  const backlogItems = useMemo(() => {
    const active = items.filter((item) => item.inBacklog);
    return [...active].sort((a, b) => {
      if (a.status === 'playing' && b.status !== 'playing') return -1;
      if (b.status === 'playing' && a.status !== 'playing') return 1;
      return 0;
    });
  }, [items]);

  const [selectedItemId, setSelectedItemId] = useState('');
  const [progressMarker, setProgressMarker] = useState('');
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [media, setMedia] = useState([]);
  const [gifQuery, setGifQuery] = useState('');
  const [gifResults, setGifResults] = useState([]);
  const [isSearchingGif, setIsSearchingGif] = useState(false);
  const [gifFeedback, setGifFeedback] = useState('');
  const [videoInput, setVideoInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const fileInputRef = useRef(null);
  const gifAbortRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const defaultId = initialItemId || backlogItems[0]?.id || '';
    const defaultItem = backlogItems.find((i) => i.id === defaultId) ?? null;

    setSelectedItemId(defaultId);
    setProgressMarker(deriveDefaultMarker(defaultItem));
    setTitle('');
    setCaption('');
    setMedia([]);
    setGifQuery('');
    setGifResults([]);
    setGifFeedback('');
    setIsSearchingGif(false);
    setVideoInput('');

    return () => {
      gifAbortRef.current?.abort();
    };
  }, [isOpen, initialItemId, backlogItems]);

  if (!isOpen) return null;

  const { journalComposer } = domainConfig.ui.profile;
  const selectedItem =
    backlogItems.find((item) => item.id === selectedItemId) ?? null;

  const handleSelectLinkedItem = (nextId) => {
    setSelectedItemId(nextId);
    const nextItem = backlogItems.find((i) => i.id === nextId) ?? null;
    setProgressMarker(deriveDefaultMarker(nextItem));
  };

  const handleFilesSelected = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;

    setIsProcessing(true);
    try {
      const processed = await Promise.all(
        files.map(async (file, index) => {
          const isGif = file.type === 'image/gif';
          if (isGif) {
            const url = await readFileAsDataUrl(file);
            return {
              id: `gif-${Date.now()}-${index}`,
              type: 'gif',
              url,
            };
          }
          const url = await compressImageFile(file, {
            maxWidth: 960,
            maxHeight: 960,
            quality: 0.72,
          });
          return {
            id: `img-${Date.now()}-${index}`,
            type: 'image',
            url,
          };
        })
      );
      setMedia((prev) => [...prev, ...processed]);
    } catch {
      // Ignora arquivos inválidos
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGifAction = async () => {
    const clean = gifQuery.trim();
    if (!clean) return;

    if (/^https?:\/\//i.test(clean) || isDirectGifUrl(clean)) {
      setMedia((prev) => [
        ...prev,
        { id: `gif-${Date.now()}`, type: 'gif', url: clean },
      ]);
      setGifQuery('');
      setGifResults([]);
      setGifFeedback('');
      return;
    }

    gifAbortRef.current?.abort();
    const controller = new AbortController();
    gifAbortRef.current = controller;

    setIsSearchingGif(true);
    setGifFeedback('');
    try {
      const found = await searchOpenverseGifs(clean, {
        signal: controller.signal,
      });
      setGifResults(found);
      if (found.length === 0) {
        setGifFeedback(
          'Nenhum GIF encontrado na busca. Cole um link .gif direto se preferir.'
        );
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        setGifResults([]);
        setGifFeedback(
          'Busca de GIF indisponível no momento. Você pode colar um link .gif direto.'
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsSearchingGif(false);
      }
    }
  };

  const handlePickGif = (gif) => {
    setMedia((prev) => [
      ...prev,
      { id: `gif-${Date.now()}-${gif.id}`, type: 'gif', url: gif.url },
    ]);
    setGifResults([]);
    setGifQuery('');
    setGifFeedback('');
  };

  const handleAddVideo = () => {
    const cleanUrl = videoInput.trim();
    if (!cleanUrl) return;
    if (isDirectGifUrl(cleanUrl)) {
      setMedia((prev) => [
        ...prev,
        { id: `gif-${Date.now()}`, type: 'gif', url: cleanUrl },
      ]);
    } else {
      setMedia((prev) => [
        ...prev,
        { id: `vid-${Date.now()}`, type: 'video', url: cleanUrl },
      ]);
    }
    setVideoInput('');
  };

  const handleRemoveSlide = (slideId) => {
    setMedia((prev) => prev.filter((slide) => slide.id !== slideId));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;

    onPublish({
      itemId: selectedItem?.id || null,
      itemTitle: selectedItem?.title || '',
      itemSnapshot: selectedItem
        ? {
            id: selectedItem.id,
            title: selectedItem.title,
            author: selectedItem.author || '',
            workType: selectedItem.workType || 'book',
            isbn: selectedItem.isbn || '',
            coverUrl: selectedItem.coverUrl || null,
            coverSources: Array.isArray(selectedItem.coverSources)
              ? selectedItem.coverSources
              : [],
            palette: selectedItem.palette,
            monogram: selectedItem.monogram,
            format: selectedItem[domainConfig.cardFields.primary],
          }
        : null,
      progressMarker: progressMarker.trim(),
      title: title.trim(),
      caption: caption.trim(),
      media,
    });
    onClose();
  };

  const isGifUrlMode =
    /^https?:\/\//i.test(gifQuery.trim()) || isDirectGifUrl(gifQuery.trim());

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-xs"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-x border-t border-line bg-card p-5 pb-8 shadow-2xl no-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />

        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">
            {journalComposer.title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={domainConfig.ui.detail.closeLabel}
            className="rounded-full p-1 text-muted hover:bg-elevated hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {backlogItems.length > 0 ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">
                  {journalComposer.itemLabel}
                </span>
                <select
                  value={selectedItemId}
                  onChange={(e) => handleSelectLinkedItem(e.target.value)}
                  className="w-full rounded-xl border border-line bg-app px-3 py-2.5 text-xs font-medium text-ink focus:border-accent focus:outline-none"
                >
                  {backlogItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 flex items-center gap-1 text-xs font-medium text-muted">
                  <Bookmark className="h-3 w-3 text-accent" strokeWidth={1.5} />
                  Temporada, Episódio ou Minuto
                </span>
                <input
                  type="text"
                  value={progressMarker}
                  onChange={(e) => setProgressMarker(e.target.value)}
                  placeholder="Ex: Temp. 2 Ep. 4 ou 01:14:00"
                  className="w-full rounded-xl border border-line bg-app px-3 py-2.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </label>
            </div>
          ) : (
            <p className="rounded-xl border border-line bg-app px-3 py-2.5 text-xs text-muted">
              {journalComposer.noItemsHint}
            </p>
          )}

          {/* Mídias e Preview Carrossel */}
          <div className="space-y-2.5">
            <span className="block text-xs font-medium text-muted">
              Fotos, GIFs ou Vídeos
            </span>

            {media.length > 0 && (
              <MediaCarousel
                media={media}
                onRemoveSlide={handleRemoveSlide}
                aspectClass="aspect-[4/3]"
              />
            )}

            <div className="flex gap-2">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-accent/40 bg-accent/10 py-2.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
              >
                <ImagePlus className="h-4 w-4" />
                {isProcessing ? 'Processando...' : 'Adicionar Fotos / GIF'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFilesSelected}
                className="hidden"
              />
            </div>

            {/* Busca rápida de GIFs (Openverse) ou URL .gif direta */}
            <div className="space-y-2 rounded-2xl border border-line bg-app p-2.5">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-accent" />
                  <input
                    type="text"
                    value={gifQuery}
                    onChange={(e) => setGifQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleGifAction();
                      }
                    }}
                    placeholder="Buscar GIF (ex: reading) ou colar link .gif"
                    className="w-full rounded-xl border border-line bg-card py-2 pl-8 pr-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  disabled={isSearchingGif || !gifQuery.trim()}
                  onClick={handleGifAction}
                  className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-accent/40 bg-accent/15 px-3 py-2 text-xs font-medium text-accent hover:bg-accent/25 disabled:opacity-45"
                >
                  {isGifUrlMode ? (
                    <>
                      <Plus className="h-3.5 w-3.5" />
                      Anexar GIF
                    </>
                  ) : (
                    <>
                      <Search className="h-3.5 w-3.5" />
                      {isSearchingGif ? 'Buscando...' : 'Buscar GIF'}
                    </>
                  )}
                </button>
              </div>

              {isSearchingGif && (
                <div className="grid grid-cols-3 gap-1.5" aria-hidden="true">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="aspect-square animate-pulse rounded-xl bg-elevated"
                    />
                  ))}
                </div>
              )}

              {!isSearchingGif && gifResults.length > 0 && (
                <div className="grid max-h-44 grid-cols-3 gap-1.5 overflow-y-auto no-scrollbar">
                  {gifResults.map((gif) => (
                    <button
                      key={gif.id}
                      type="button"
                      onClick={() => handlePickGif(gif)}
                      title={gif.title}
                      className="group relative aspect-square overflow-hidden rounded-xl border border-line bg-card focus:outline-none hover:border-accent"
                    >
                      <img
                        src={gif.thumbnailUrl || gif.url}
                        alt={gif.title}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-150 group-hover:scale-105"
                      />
                      <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-semibold text-accent">
                        GIF
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {gifFeedback && (
                <p className="px-1 text-[11px] text-subtle">{gifFeedback}</p>
              )}
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Film className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
                <input
                  type="url"
                  value={videoInput}
                  onChange={(e) => setVideoInput(e.target.value)}
                  placeholder={journalComposer.videoUrlPlaceholder}
                  className="w-full rounded-xl border border-line bg-app py-2 pl-8 pr-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={handleAddVideo}
                className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-line bg-app px-3 py-2 text-xs font-medium text-ink hover:border-accent"
              >
                <Plus className="h-3.5 w-3.5 text-accent" />
                {journalComposer.addVideoLabel}
              </button>
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">
              {journalComposer.postTitleLabel}
            </span>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={journalComposer.postTitlePlaceholder}
              className="w-full rounded-xl border border-line bg-app px-3 py-2.5 text-sm text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">
              {journalComposer.captionLabel}
            </span>
            <textarea
              rows={3}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={journalComposer.captionPlaceholder}
              className="w-full resize-none rounded-xl border border-line bg-app px-3 py-2.5 text-xs leading-relaxed text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={isProcessing || !title.trim()}
          className="mt-5 w-full rounded-2xl bg-accent py-3 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-45"
        >
          {journalComposer.publishLabel}
        </button>
      </form>
    </div>
  );
}
