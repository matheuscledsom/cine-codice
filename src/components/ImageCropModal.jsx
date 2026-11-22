import { Check, RotateCcw, RotateCw, X, ZoomIn } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export function ImageCropModal({
  isOpen,
  imageSrc,
  aspectMode = 'avatar',
  onCancel,
  onConfirm,
}) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 280, height: 280 });
  const [isExporting, setIsExporting] = useState(false);

  const viewportRef = useRef(null);
  const imgRef = useRef(null);
  const dragStateRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  const isAvatar = aspectMode === 'avatar';

  useEffect(() => {
    if (!isOpen) return;
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
    setNaturalSize({ width: 0, height: 0 });
  }, [isOpen, imageSrc, aspectMode]);

  useEffect(() => {
    if (!isOpen || !viewportRef.current) return undefined;
    const measure = () => {
      if (!viewportRef.current) return;
      const rect = viewportRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewportSize({ width: rect.width, height: rect.height });
      }
    };
    measure();

    if (imgRef.current?.complete && imgRef.current?.naturalWidth > 0) {
      setNaturalSize({
        width: imgRef.current.naturalWidth,
        height: imgRef.current.naturalHeight,
      });
    }

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(measure)
        : null;
    observer?.observe(viewportRef.current);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isOpen, aspectMode, imageSrc]);

  if (!isOpen || !imageSrc) return null;

  const effWidth =
    rotation % 180 === 0 ? naturalSize.width : naturalSize.height;
  const effHeight =
    rotation % 180 === 0 ? naturalSize.height : naturalSize.width;
  const baseScale =
    effWidth > 0 && effHeight > 0
      ? Math.max(viewportSize.width / effWidth, viewportSize.height / effHeight)
      : 1;

  const handlePointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragStateRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      originX: pan.x,
      originY: pan.y,
    };
  };

  const handlePointerMove = (e) => {
    if (!dragStateRef.current.active) return;
    const dx = e.clientX - dragStateRef.current.startX;
    const dy = e.clientY - dragStateRef.current.startY;
    setPan({
      x: dragStateRef.current.originX + dx,
      y: dragStateRef.current.originY + dy,
    });
  };

  const handlePointerUp = () => {
    dragStateRef.current.active = false;
  };

  const handleReset = () => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  };

  const handleExport = () => {
    if (!imgRef.current || !naturalSize.width || !viewportSize.width) return;
    setIsExporting(true);

    try {
      const outW = isAvatar ? 256 : 1200;
      const outH = isAvatar ? 256 : 450;
      const outScale = outW / viewportSize.width;

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = '#0A0A0A';
      ctx.fillRect(0, 0, outW, outH);

      ctx.save();
      ctx.translate(
        outW / 2 + pan.x * outScale,
        outH / 2 + pan.y * outScale
      );
      ctx.rotate((rotation * Math.PI) / 180);
      const totalScale = baseScale * zoom * outScale;
      ctx.scale(totalScale, totalScale);
      ctx.drawImage(
        imgRef.current,
        -naturalSize.width / 2,
        -naturalSize.height / 2
      );
      ctx.restore();

      let exported = canvas.toDataURL('image/webp', 0.85);
      if (!exported.startsWith('data:image/webp')) {
        exported = canvas.toDataURL('image/jpeg', 0.85);
      }
      onConfirm(exported);
    } catch {
      onCancel();
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/80 backdrop-blur-xs"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-t-3xl border-x border-t border-line bg-card p-5 pb-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />

        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-ink">
              {isAvatar ? 'Ajustar Avatar (1:1)' : 'Ajustar Banner de Capa (16:6)'}
            </h3>
            <p className="text-[11px] text-subtle">
              Arraste para enquadrar e ajuste o zoom
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancelar recorte"
            className="rounded-full p-1 text-muted hover:bg-elevated hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex justify-center">
          <div
            ref={viewportRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className={`relative overflow-hidden border border-accent/50 bg-black touch-none cursor-grab active:cursor-grabbing ${
              isAvatar ? 'aspect-square w-64 rounded-2xl' : 'aspect-[16/6] w-full rounded-2xl'
            }`}
          >
            <img
              ref={imgRef}
              src={imageSrc}
              alt="Prévia do recorte"
              draggable={false}
              onLoad={(e) =>
                setNaturalSize({
                  width: e.currentTarget.naturalWidth,
                  height: e.currentTarget.naturalHeight,
                })
              }
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: naturalSize.width || 'auto',
                height: naturalSize.height || 'auto',
                maxWidth: 'none',
                maxHeight: 'none',
                transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) rotate(${rotation}deg) scale(${baseScale * zoom})`,
                transformOrigin: 'center center',
              }}
            />

            {isAvatar && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-2 rounded-full border-2 border-accent/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
              />
            )}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3 rounded-xl border border-line bg-app px-3 py-2.5">
            <ZoomIn className="h-4 w-4 shrink-0 text-accent" />
            <input
              type="range"
              min="1"
              max="3"
              step="0.05"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="Zoom"
              className="flex-1 cursor-pointer accent-accent"
            />
            <span className="w-10 text-right text-xs font-semibold text-ink">
              {zoom.toFixed(1)}x
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setRotation((prev) => (prev + 90) % 360)}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line bg-app py-2.5 text-xs font-medium text-ink hover:border-accent/50"
            >
              <RotateCw className="h-3.5 w-3.5 text-accent" />
              Girar 90°
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line bg-app py-2.5 text-xs font-medium text-muted hover:border-accent/50 hover:text-ink"
            >
              <RotateCcw className="h-3.5 w-3.5 text-accent" />
              Resetar
            </button>
          </div>
        </div>

        <button
          type="button"
          disabled={isExporting || !naturalSize.width}
          onClick={handleExport}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
          {isExporting ? 'Aplicando recorte...' : 'Aplicar Enquadramento'}
        </button>
      </div>
    </div>
  );
}
