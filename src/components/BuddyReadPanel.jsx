import { Copy, Download, Lock, Send, Upload, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../context/ToastContext';
import {
  addBuddyComment,
  buildWorkMatchKey,
  clampSpoilerPct,
  encodeBuddyClubBundle,
  filterBuddyComments,
  importBuddyClubBundle,
  loadBuddyComments,
} from '../services/buddyReadService';
import { calculateWorkProgress } from '../utils/backlogHelpers';

export function BuddyReadPanel({ item, profile = null }) {
  const { showToast } = useToast();
  const workKey = useMemo(() => buildWorkMatchKey(item), [item]);
  const viewerProgressPct = useMemo(
    () => clampSpoilerPct(calculateWorkProgress(item)),
    [item]
  );

  const [allComments, setAllComments] = useState(() => loadBuddyComments(workKey));
  const [noteText, setNoteText] = useState('');
  const [notePct, setNotePct] = useState(() => String(viewerProgressPct));
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');

  useEffect(() => {
    setAllComments(loadBuddyComments(workKey));
    setNotePct(String(viewerProgressPct));
  }, [workKey, viewerProgressPct]);

  // Escudo Anti-Spoiler: comentários acima de viewerProgressPct nunca entram em `visible`
  const { visible, hiddenCount, threshold } = useMemo(
    () => filterBuddyComments(allComments, viewerProgressPct),
    [allComments, viewerProgressPct]
  );

  const handlePostNote = (e) => {
    e.preventDefault();
    if (!noteText.trim()) return;
    const boundedPct = Math.min(threshold, clampSpoilerPct(notePct));
    const res = addBuddyComment({
      workKey,
      authorName: profile?.displayName || 'Você',
      authorHandle: profile?.handle || '',
      progressPct: boundedPct,
      text: noteText,
    });
    if (res.ok) {
      setAllComments(res.comments);
      setNoteText('');
      showToast({
        message: `Comentário marcado em ${boundedPct}% adicionado à Leitura Conjunta.`,
        type: 'success',
      });
    }
  };

  const handleCopyBundle = async () => {
    const encoded = encodeBuddyClubBundle(workKey, allComments);
    try {
      await navigator.clipboard.writeText(encoded);
      showToast({
        message: 'Pacote da Leitura Conjunta copiado para enviar aos amigos.',
        type: 'success',
      });
    } catch {
      setImportText(encoded);
      setImportOpen(true);
    }
  };

  const handleImportBundle = () => {
    const res = importBuddyClubBundle(importText, workKey);
    if (!res.ok) {
      showToast({ message: res.error, type: 'error' });
      return;
    }
    setAllComments(res.comments);
    setImportText('');
    setImportOpen(false);
    showToast({
      message: `${res.importedCount} nota(s) importada(s) com filtro anti-spoiler ativo.`,
      type: 'success',
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[6px] border border-accent/40 bg-accent/10 p-3 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
            <Lock className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
            <span>Escudo Anti-Spoiler Ativo</span>
          </span>
          <span className="rounded-[4px] border border-accent/40 bg-card px-2 py-0.5 text-[11px] font-semibold tabular-nums text-accent">
            Seu marco: {threshold}%
          </span>
        </div>
        <p className="text-[11px] leading-relaxed text-muted">
          Notas marcadas acima de <strong className="text-ink">{threshold}%</strong> nunca são carregadas na tela até você avançar na obra.
        </p>
        {hiddenCount > 0 && (
          <p className="text-[11px] font-medium text-accent tabular-nums">
            {hiddenCount} {hiddenCount === 1 ? 'comentário oculto' : 'comentários ocultos'} acima de {threshold}%
          </p>
        )}
      </div>

      <form
        onSubmit={handlePostNote}
        className="space-y-2.5 rounded-[6px] border border-line bg-app p-3"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
            <Users className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
            <span>Nova impressão até {threshold}%</span>
          </span>
          <label className="flex items-center gap-1.5 text-[11px] text-muted">
            <span>Ponto (%):</span>
            <input
              type="number"
              min="0"
              max={threshold}
              step="1"
              value={notePct}
              onChange={(e) => setNotePct(e.target.value)}
              aria-label="Percentual da obra para esta nota"
              className="w-16 rounded-[4px] border border-line bg-card px-2 py-1 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
            />
          </label>
        </div>

        <textarea
          rows={2}
          maxLength={480}
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Escreva uma teoria ou reação neste ponto do filme/episódio..."
          className="w-full resize-none rounded-[4px] border border-line bg-card px-3 py-2 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopyBundle}
              className="inline-flex min-h-[38px] items-center gap-1 rounded-[4px] border border-line bg-card px-2.5 text-[11px] font-medium text-muted hover:text-ink"
            >
              <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Exportar Sessão</span>
            </button>
            <button
              type="button"
              onClick={() => setImportOpen((v) => !v)}
              className="inline-flex min-h-[38px] items-center gap-1 rounded-[4px] border border-line bg-card px-2.5 text-[11px] font-medium text-muted hover:text-ink"
            >
              <Upload className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Colar Sessão</span>
            </button>
          </div>

          <button
            type="submit"
            disabled={!noteText.trim()}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-[4px] bg-accent px-3.5 text-xs font-semibold text-accent-ink hover:opacity-90 disabled:opacity-45"
          >
            <Send className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span>Publicar</span>
          </button>
        </div>
      </form>

      {importOpen && (
        <div className="space-y-2 rounded-[6px] border border-line bg-app p-3">
          <p className="text-[11px] text-muted">
            Cole abaixo o código <code className="text-ink">CODICE-BUDDY:...</code> enviado por um amigo:
          </p>
          <textarea
            rows={3}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="CODICE-BUDDY:{...}"
            className="w-full rounded-[4px] border border-line bg-card px-2.5 py-1.5 font-mono text-[11px] text-ink focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={handleImportBundle}
            disabled={!importText.trim()}
            className="inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-[4px] border border-accent bg-accent/15 text-xs font-semibold text-accent hover:bg-accent hover:text-accent-ink disabled:opacity-45"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span>Importar Comentários com Anti-Spoiler</span>
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="rounded-[6px] border border-dashed border-line bg-app py-6 text-center text-xs text-subtle">
          {hiddenCount > 0
            ? `Avance além de ${threshold}% para revelar as impressões guardadas.`
            : 'Nenhum comentário nesta Sessão Conjunta ainda.'}
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Comentários desbloqueados da sessão conjunta">
          {visible.map((comment) => (
            <li
              key={comment.id}
              data-buddy-pct={comment.progressPct}
              className="rounded-[6px] border border-line bg-app p-3 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-ink">
                  {comment.authorName}
                  {comment.authorHandle ? ` (${comment.authorHandle})` : ''}
                </span>
                <span className="rounded-[2px] border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-accent">
                  em {comment.progressPct}%
                </span>
              </div>
              <p className="text-xs leading-relaxed text-ink">{comment.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
