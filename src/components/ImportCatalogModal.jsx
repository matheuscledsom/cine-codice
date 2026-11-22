import { AlertCircle, Check, FileSpreadsheet, Upload, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { parseCatalogImport } from '../utils/catalogImporters';

const FORMAT_LABELS = {
  letterboxd: 'Letterboxd CSV',
  imdb: 'IMDb CSV',
  myanimelist: 'MyAnimeList CSV',
  'generic-csv': 'Planilha CSV',
  'plain-list': 'Lista de títulos',
  unknown: 'Formato não detectado',
};

export function ImportCatalogModal({
  isOpen,
  onClose,
  existingItems = [],
  onCommitImport,
}) {
  const [rawText, setRawText] = useState('');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const fileRef = useRef(null);

  const preview = useMemo(
    () => parseCatalogImport({ text: rawText, existingItems }),
    [rawText, existingItems]
  );

  if (!isOpen) return null;

  const toImport = skipDuplicates
    ? preview.records.filter((r) => !r.isDuplicate)
    : preview.records;

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      setRawText(content);
    } catch {
      // Ignora erro de leitura
    }
    e.target.value = '';
  };

  const handleConfirm = () => {
    if (toImport.length === 0) return;
    onCommitImport?.(toImport);
    setRawText('');
    onClose?.();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Importar catálogo audiovisual"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[6px] border border-line bg-card p-5 space-y-4 text-ink"
      >
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-accent" strokeWidth={1.5} />
            <div>
              <h2 className="text-sm font-semibold">Importar Catálogo em Lote</h2>
              <p className="text-[11px] text-subtle">
                Letterboxd CSV, IMDb CSV, MyAnimeList CSV ou lista simples
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar importador"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line text-muted hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          onChange={handleFileChange}
          className="hidden"
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-accent bg-accent/10 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent hover:text-accent-ink"
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span>Selecionar arquivo CSV / TXT</span>
          </button>
          {rawText && (
            <button
              type="button"
              onClick={() => setRawText('')}
              className="min-h-[44px] rounded-[4px] border border-line bg-app px-3 py-2 text-xs text-muted hover:text-ink"
            >
              Limpar texto
            </button>
          )}
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted">
            Ou cole o conteúdo CSV / lista (uma obra por linha):
          </span>
          <textarea
            rows={5}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={'A Viagem de Chihiro - Hayao Miyazaki (2001)\nParasita - Bong Joon-ho (2019)'}
            className="w-full rounded-[4px] border border-line bg-app px-3 py-2 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
          />
        </label>

        {preview.records.length > 0 && (
          <div className="space-y-2.5 rounded-[4px] border border-line bg-app p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-ink">
                Detectado: {FORMAT_LABELS[preview.format] || preview.format}
              </span>
              <span className="tabular-nums text-muted">
                {preview.newCount} nova(s) · {preview.duplicateCount} duplicada(s)
              </span>
            </div>

            {preview.duplicateCount > 0 && (
              <label className="flex min-h-[36px] cursor-pointer items-center gap-2 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={(e) => setSkipDuplicates(e.target.checked)}
                  className="h-4 w-4 accent-[var(--accent-color)]"
                />
                <span>Ignorar obras que já existem no catálogo ({preview.duplicateCount})</span>
              </label>
            )}

            <ul className="max-h-40 divide-y divide-line overflow-y-auto rounded-[4px] border border-line bg-card">
              {preview.records.slice(0, 25).map((rec) => (
                <li
                  key={rec.tempId}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">
                      {rec.title}
                      {rec.releaseYear ? ` (${rec.releaseYear})` : ''}
                    </p>
                    {rec.director && (
                      <p className="truncate text-[10px] text-subtle">{rec.director}</p>
                    )}
                  </div>
                  {rec.isDuplicate ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-[2px] border border-line bg-app px-1.5 py-0.5 text-[10px] text-subtle">
                      <AlertCircle className="h-3 w-3" strokeWidth={1.5} />
                      Já catalogada
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-[2px] border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                      <Check className="h-3 w-3" strokeWidth={1.5} />
                      Nova
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-[4px] border border-line bg-app px-4 text-xs font-medium text-muted hover:text-ink"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={toImport.length === 0}
            onClick={handleConfirm}
            className="min-h-[44px] rounded-[4px] bg-accent px-4 text-xs font-semibold text-accent-ink hover:opacity-90 disabled:opacity-45"
          >
            Importar ({toImport.length})
          </button>
        </div>
      </div>
    </div>
  );
}
