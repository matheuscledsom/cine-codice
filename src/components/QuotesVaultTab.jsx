import { Check, Edit3, ImageDown, Plus, Quote, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../context/ToastContext';
import {
  EDITORIAL_CARD_TEMPLATES,
  generateEditorialQuoteCard,
} from '../utils/editorialCardGenerator';

function formatQuoteDate(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'short',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

export function QuotesVaultTab({ item, onUpdate }) {
  const { showToast } = useToast();
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingSceneOpen, setEditingSceneOpen] = useState(false);
  const [editingNotesOpen, setEditingNotesOpen] = useState(false);
  const [quoteText, setQuoteText] = useState('');
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [sceneDraft, setSceneDraft] = useState(item?.favoriteScene || '');
  const [notesDraft, setNotesDraft] = useState(item?.fichamento || item?.notes || '');
  const [templateId, setTemplateId] = useState(EDITORIAL_CARD_TEMPLATES[0]?.id || 'bilhete');
  const [generatingId, setGeneratingId] = useState(null);
  const [downloadedId, setDownloadedId] = useState(null);

  const quotes = Array.isArray(item.quotes) ? item.quotes : [];

  const handleAddQuote = (e) => {
    e.preventDefault();
    const cleanText = quoteText.trim();
    if (!cleanText) return;

    const newQuote = {
      id: `quote-${Date.now()}`,
      text: cleanText,
      location: location.trim(),
      note: note.trim(),
      createdAt: new Date().toISOString(),
    };

    const patch = { quotes: [newQuote, ...quotes] };
    if (!item.favoriteScene) {
      patch.favoriteScene = cleanText.slice(0, 200);
    }
    onUpdate(patch);
    showToast({ message: 'Fala / cena salva no cofre', type: 'success' });
    setQuoteText('');
    setLocation('');
    setNote('');
    setComposerOpen(false);
  };

  const handleDeleteQuote = (quoteId) => {
    onUpdate({ quotes: quotes.filter((q) => q.id !== quoteId) });
  };

  const handleGenerateCard = async (quote) => {
    setGeneratingId(quote.id);
    try {
      await generateEditorialQuoteCard({
        quoteText: quote.text,
        location: quote.location,
        note: quote.note,
        title: item.title,
        director: item.director || item.studio || item.author,
        author: item.director || item.studio || item.author,
        templateId,
      });
      setDownloadedId(quote.id);
      showToast({
        message: 'Bilhete de Cinema 1080x1350 baixado',
        type: 'success',
      });
      setTimeout(() => {
        setDownloadedId((current) => (current === quote.id ? null : current));
      }, 2500);
    } finally {
      setGeneratingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Cena Favorita / Destaque Editorial (Modo Leitura por padrão) */}
      <section className="rounded-2xl border border-line bg-card p-4 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <Quote className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
            <span>Cena ou Frase Favorita da Obra</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setSceneDraft(item.favoriteScene || '');
              setEditingSceneOpen((v) => !v);
            }}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line bg-app px-3 py-1.5 text-[11px] font-medium text-ink transition-colors hover:border-accent hover:text-accent"
          >
            <Edit3 className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
            <span>{item.favoriteScene ? 'Editar Cena' : '+ Registrar Cena'}</span>
          </button>
        </div>

        {item.favoriteScene ? (
          <blockquote className="border-l-2 border-accent pl-3.5 text-sm italic leading-relaxed text-ink">
            “{item.favoriteScene}”
          </blockquote>
        ) : (
          <p className="text-xs leading-relaxed text-muted">
            Nenhuma cena favorita destacada ainda. Registre uma fala ou plano marcante para exibir no seu diário e na tela inicial.
          </p>
        )}

        {editingSceneOpen && (
          <div className="space-y-2 border-t border-line pt-3">
            <textarea
              rows={2}
              maxLength={200}
              value={sceneDraft}
              onChange={(e) => setSceneDraft(e.target.value.slice(0, 200))}
              placeholder="Frase marcante ou cena que definiu a obra (máx. 200 caracteres)..."
              className="w-full resize-none rounded-xl border border-line bg-app px-3 py-2 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] tabular-nums text-subtle">
                {sceneDraft.length}/200
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingSceneOpen(false)}
                  className="min-h-[38px] rounded-xl border border-line bg-app px-3 text-xs font-medium text-muted hover:text-ink"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onUpdate({ favoriteScene: sceneDraft.trim().slice(0, 200) });
                    setEditingSceneOpen(false);
                    showToast({ message: 'Cena favorita atualizada', type: 'success' });
                  }}
                  className="min-h-[38px] rounded-xl bg-accent px-3.5 text-xs font-semibold text-accent-ink"
                >
                  Salvar Cena
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Cofre de Cenas & Diálogos + Gerador de Bilhete Cinematográfico (PNG) */}
      <section className="rounded-2xl border border-line bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-semibold text-ink">Cofre de Cenas &amp; Diálogos</h4>
            <p className="text-[11px] tabular-nums text-subtle">
              {quotes.length} {quotes.length === 1 ? 'registro salvo' : 'registros salvos'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setComposerOpen((v) => !v)}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90"
          >
            {composerOpen ? (
              <>
                <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>Fechar Editor</span>
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>+ Novo Diálogo / Bilhete</span>
              </>
            )}
          </button>
        </div>

        {composerOpen && (
          <form
            onSubmit={handleAddQuote}
            className="space-y-3 rounded-2xl border border-line bg-app p-3.5"
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
              <Quote className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              <span>Novo Diálogo ou Cena Marcante</span>
            </div>

            <textarea
              rows={3}
              required
              value={quoteText}
              onChange={(e) => setQuoteText(e.target.value)}
              placeholder="Transcreva aqui a fala, monólogo ou descrição de plano..."
              className="w-full resize-none rounded-xl border border-line bg-card px-3 py-2.5 text-xs leading-relaxed text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
            />

            <div className="grid grid-cols-1 gap-2">
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Minutagem ou Episódio (ex: 01:14:20 ou T02E05)"
                className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3 py-2 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
              />

              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Nota de fotografia, subtexto ou trilha sonora (opcional)..."
                className="w-full resize-none rounded-xl border border-line bg-card px-3 py-2 text-xs leading-relaxed text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={!quoteText.trim()}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl bg-accent py-2.5 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-45"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              Salvar no Cofre
            </button>
          </form>
        )}

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Estilo do cartão PNG">
          {EDITORIAL_CARD_TEMPLATES.map((tpl) => {
            const active = templateId === tpl.id;
            return (
              <button
                key={tpl.id}
                type="button"
                aria-pressed={active}
                onClick={() => setTemplateId(tpl.id)}
                className={`min-h-[44px] rounded-xl border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                  active
                    ? 'border-accent bg-accent/15 text-ink'
                    : 'border-line bg-app text-muted hover:text-ink'
                }`}
              >
                {tpl.label}
              </button>
            );
          })}
        </div>

        {quotes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-app px-4 py-6 text-center space-y-2.5">
            <p className="text-xs text-subtle">
              Nenhuma fala ou cena salva para esta obra ainda.
            </p>
            {item.favoriteScene && (
              <button
                type="button"
                onClick={() =>
                  handleGenerateCard({
                    id: 'fav-scene-card',
                    text: item.favoriteScene,
                    location: item.releaseYear ? String(item.releaseYear) : '',
                    note: item.notes || '',
                  })
                }
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-accent/40 bg-accent/15 px-4 py-2 text-xs font-semibold text-ink hover:bg-accent/25"
              >
                <ImageDown className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                <span>Gerar Bilhete Cinematográfico (PNG)</span>
              </button>
            )}
          </div>
        ) : (
          quotes.map((quote) => {
            const isGenerating = generatingId === quote.id;
            const isDownloaded = downloadedId === quote.id;

            return (
              <article
                key={quote.id}
                className="space-y-2.5 rounded-2xl border border-line bg-app p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Quote className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.5} />
                    {quote.location && (
                      <span className="rounded-full border border-accent/40 bg-accent/15 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-accent">
                        {quote.location}
                      </span>
                    )}
                    {quote.createdAt && (
                      <span className="text-[10px] text-subtle">
                        {formatQuoteDate(quote.createdAt)}
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteQuote(quote.id)}
                    aria-label="Excluir cena"
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-1 text-subtle hover:bg-rose-500/10 hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>

                <blockquote className="border-l-2 border-accent/60 pl-3 text-xs leading-relaxed text-ink">
                  {quote.text}
                </blockquote>

                {quote.note && (
                  <p className="rounded-xl border border-line bg-card px-3 py-2 text-[11px] leading-relaxed text-muted">
                    {quote.note}
                  </p>
                )}

                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={() => handleGenerateCard(quote)}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-accent/40 bg-accent/15 py-2 text-[11px] font-semibold text-ink transition-colors hover:bg-accent/25 disabled:opacity-50"
                >
                  {isDownloaded ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                      Bilhete 1080x1350 baixado
                    </>
                  ) : (
                    <>
                      <ImageDown className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                      {isGenerating ? 'Gerando bilhete...' : 'Gerar Bilhete de Cinema (PNG)'}
                    </>
                  )}
                </button>
              </article>
            );
          })
        )}
      </section>

      {/* Crítica & Notas de Direção (Modo Leitura com Edição Sob Demanda) */}
      <section className="rounded-2xl border border-line bg-card p-4 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-ink">
            Crítica Pessoal &amp; Notas de Direção
          </span>
          <button
            type="button"
            onClick={() => {
              setNotesDraft(item.notes || item.fichamento || '');
              setEditingNotesOpen((v) => !v);
            }}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line bg-app px-3 py-1.5 text-[11px] font-medium text-ink transition-colors hover:border-accent hover:text-accent"
          >
            <Edit3 className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
            <span>{item.notes || item.fichamento ? 'Editar Crítica' : '+ Escrever Crítica'}</span>
          </button>
        </div>

        {item.notes || item.fichamento ? (
          <div className="space-y-2 text-xs leading-relaxed text-ink max-w-[68ch]">
            {item.notes && <p className="whitespace-pre-line">{item.notes}</p>}
            {item.fichamento && item.fichamento !== item.notes && (
              <p className="whitespace-pre-line text-muted border-t border-line pt-2">
                {item.fichamento}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted">
            Nenhuma anotação crítica registrada ainda sobre direção, fotografia, montagem ou trilha sonora.
          </p>
        )}

        {editingNotesOpen && (
          <div className="space-y-2 border-t border-line pt-3">
            <textarea
              rows={4}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="Observações técnicas sobre direção, montagem, paleta de cores, referências visuais e simbolismos..."
              className="w-full resize-none rounded-xl border border-line bg-app px-3 py-2.5 text-xs leading-relaxed text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingNotesOpen(false)}
                className="min-h-[38px] rounded-xl border border-line bg-app px-3 text-xs font-medium text-muted hover:text-ink"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdate({ notes: notesDraft.trim(), fichamento: notesDraft.trim() });
                  setEditingNotesOpen(false);
                  showToast({ message: 'Crítica salva na ficha da obra', type: 'success' });
                }}
                className="min-h-[38px] rounded-xl bg-accent px-3.5 text-xs font-semibold text-accent-ink"
              >
                Salvar Crítica
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
