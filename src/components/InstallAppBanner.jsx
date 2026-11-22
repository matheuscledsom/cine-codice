import { CheckCircle2, Download, Laptop, Smartphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';

const DISMISS_KEY = 'cine_codice_pwa_banner_dismissed_v1';

let globalDeferredPrompt = null;
const promptSubscribers = new Set();

function notifyPromptSubscribers() {
  for (const fn of promptSubscribers) {
    try {
      fn(globalDeferredPrompt);
    } catch {
      // ignore subscriber errors
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    globalDeferredPrompt = event;
    notifyPromptSubscribers();
  });

  window.addEventListener('appinstalled', () => {
    globalDeferredPrompt = null;
    notifyPromptSubscribers();
  });
}

export function isRunningStandalonePwa() {
  if (typeof window === 'undefined') return false;
  const mediaStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone = Boolean(window.navigator?.standalone);
  return Boolean(mediaStandalone || iosStandalone);
}

export function InstallAppBanner({ variant = 'home' }) {
  const [deferredPrompt, setDeferredPrompt] = useState(() => globalDeferredPrompt);
  const [isInstalled, setIsInstalled] = useState(() => isRunningStandalonePwa());
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [showManualHint, setShowManualHint] = useState(false);

  useEffect(() => {
    const onPromptChange = (promptEvent) => {
      setDeferredPrompt(promptEvent);
      setIsInstalled(isRunningStandalonePwa());
    };
    promptSubscribers.add(onPromptChange);
    return () => {
      promptSubscribers.delete(onPromptChange);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt && typeof deferredPrompt.prompt === 'function') {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice?.outcome === 'accepted') {
          globalDeferredPrompt = null;
          setDeferredPrompt(null);
          setIsInstalled(true);
        }
      } catch {
        setShowManualHint(true);
      }
      return;
    }
    setShowManualHint((prev) => !prev);
  };

  const handleDismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore storage restrictions
    }
  };

  if (variant === 'home') {
    if (isInstalled || dismissed || !deferredPrompt) {
      return null;
    }

    return (
      <div
        role="region"
        aria-label="Instalar aplicativo no dispositivo"
        className="flex flex-wrap items-center justify-between gap-2.5 rounded-[4px] border border-accent/40 bg-card px-3.5 py-2.5"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <Download className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-ink">
              Instalar Cine Códice no Dispositivo
            </p>
            <p className="text-[11px] text-muted">
              Acesso instantâneo na área de trabalho ou Android com cache inteligente (teto 80 MB LRU).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleInstallClick}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-[4px] border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span>Instalar App</span>
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dispensar aviso de instalação"
            className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-[4px] border border-line text-muted hover:text-ink"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-[4px] border border-line bg-app p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {isInstalled ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
          ) : (
            <Download className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
          )}
          <div className="min-w-0">
            <p className="text-xs font-semibold text-ink">
              {isInstalled
                ? 'Aplicativo Instalado no Dispositivo'
                : 'Instalar Cine Códice no Dispositivo'}
            </p>
            <p className="text-[11px] text-muted">
              PWA nativo para PC (Windows/Linux) e Android · Cache de pôsteres LRU (máx. 80 MB).
            </p>
          </div>
        </div>

        {!isInstalled && (
          <button
            type="button"
            onClick={handleInstallClick}
            className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-[4px] border border-accent bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span>{deferredPrompt ? 'Instalar agora' : 'Como instalar'}</span>
          </button>
        )}
      </div>

      {showManualHint && !isInstalled && (
        <div className="space-y-1.5 border-t border-line pt-2 text-[11px] text-muted">
          <p className="flex items-center gap-1.5">
            <Laptop className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.5} />
            <span>
              <strong className="text-ink">PC (Chrome / Edge / Brave):</strong> clique no ícone de instalação na barra de endereço (canto direito) → <em>Instalar</em>.
            </span>
          </p>
          <p className="flex items-center gap-1.5">
            <Smartphone className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.5} />
            <span>
              <strong className="text-ink">Android:</strong> abra o menu ⋮ do navegador → <em>Instalar aplicativo</em> ou <em>Adicionar à tela inicial</em>.
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
