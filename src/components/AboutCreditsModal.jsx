import { Database, ShieldCheck, Tv, X } from 'lucide-react';
import { useEffect } from 'react';
import { CODICE_RELEASE } from '../config/versioning';
import { OmniLogo } from './OmniLogo';

const DATA_SOURCES = [
  {
    name: 'TMDB (The Movie Database)',
    role: 'Filmes, séries, coleções/franquias, pôsteres, backdrops e sinopses',
    policy: 'This product uses the TMDB API but is not endorsed or certified by TMDB.',
    optionalKey: true,
  },
  {
    name: 'OMDb (The Open Movie Database)',
    role: 'Notas públicas de IMDb, Rotten Tomatoes e Metacritic para filmes e séries',
    policy: 'Uso com chave gratuita pessoal (limite de 1.000 requisições/dia com proteção automática aos 90%).',
    optionalKey: true,
  },
  {
    name: 'AniList GraphQL API',
    role: 'Animes, notas médias públicas, estúdios, relações entre temporadas e sequências',
    policy: 'Consulta pública gratuita sem exigência de chave.',
    optionalKey: false,
  },
  {
    name: 'Jikan API (MyAnimeList)',
    role: 'Lista detalhada de episódios de animes, sinalização de filler/recap e pontuação MAL',
    policy: 'API pública não oficial da MyAnimeList, sem chave.',
    optionalKey: false,
  },
  {
    name: 'TVmaze API',
    role: 'Séries, temporadas, lista completa de episódios, miniaturas e horários',
    policy: 'Dados distribuídos sob licença Creative Commons CC BY-SA 4.0, sem chave.',
    optionalKey: false,
  },
  {
    name: 'Wikidata · IMDb Suggestion · Internet Archive',
    role: 'Metadados abertos bilíngues, sugestões rápidas de busca e domínio público',
    policy: 'Fontes abertas gratuitas sem chave nem conta.',
    optionalKey: false,
  },
];

export function AboutCreditsModal({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sobre o OmniPrism, Créditos e Fontes de Dados"
    >
      <div
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-[6px] border border-line bg-card p-5 pb-8 sm:rounded-[6px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <OmniLogo size={22} className="text-ink" />
            <div>
              <h3 className="text-base font-serif font-semibold text-ink">
                Sobre &amp; Créditos de Fontes
              </h3>
              <p className="text-[11px] tabular-nums text-muted">
                OmniPrism {CODICE_RELEASE.label}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela Sobre e Créditos"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line text-muted hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-[4px] border border-line bg-app p-3 text-xs leading-relaxed text-muted">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-ink">
              <ShieldCheck className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <span>Catálogo pessoal e privada</span>
            </div>
            <p>
              Todo o catálogo, notas, diário e backups ficam armazenados exclusivamente no seu dispositivo.
              Nenhuma conta externa ou telemetria é usada; as chaves opcionais (TMDB, OMDb e IA) permanecem apenas no{' '}
              <code className="text-ink">localStorage</code> e são enviadas apenas aos respectivos serviços oficiais.
            </p>
          </div>

          <section className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">
              <Database className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              <span>Fontes Audiovisuais e Atribuições</span>
            </div>

            <div className="space-y-2">
              {DATA_SOURCES.map((source) => (
                <div
                  key={source.name}
                  className="rounded-[4px] border border-line bg-app p-3 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{source.name}</span>
                    <span className="rounded-[4px] border border-line px-2 py-0.5 text-[10px] text-muted">
                      {source.optionalKey ? 'Chave opcional' : 'Sem chave'}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted">{source.role}</p>
                  <p className="mt-1.5 text-[11px] font-medium text-ink">
                    {source.policy}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[4px] border border-line bg-app p-3 text-[11px] leading-relaxed text-muted">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-ink">
              <Tv className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              <span>Disponibilidade em Streaming (Nota de atribuição)</span>
            </div>
            <p>
              Caso o aplicativo exiba em versões futuras a relação de onde assistir fornecida via JustWatch,
              a marca JustWatch e o link direto para a plataforma serão exibidos em conjunto com as ofertas na ficha da obra.
            </p>
          </section>
        </div>

        <div className="mt-5 flex justify-end border-t border-line pt-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-[4px] bg-accent px-5 py-2 text-xs font-semibold text-accent-ink hover:opacity-90"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
