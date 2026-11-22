import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { playTactileSound } from '../utils/soundEffects';

const ToastContext = createContext({
  showToast: () => {},
});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timerId) => clearTimeout(timerId));
      timers.clear();
    };
  }, []);

  const dismissToast = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({
      message,
      type = 'success',
      sound = true,
      duration = 3200,
      action = null,
    } = {}) => {
      if (!message) return;
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      if (sound) {
        playTactileSound(
          type === 'error' ? 'error' : type === 'info' ? 'page' : 'success'
        );
      }

      setToasts((prev) => [...prev.slice(-2), { id, message, type, action }]);

      if (duration > 0) {
        const timer = setTimeout(() => {
          dismissToast(id);
        }, duration);
        timersRef.current.set(id, timer);
      }
    },
    [dismissToast]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] mx-auto flex max-w-md flex-col gap-2 px-4"
        >
          {toasts.map((toast) => {
            const isError = toast.type === 'error';
            const Icon = isError
              ? AlertCircle
              : toast.type === 'info'
                ? Info
                : CheckCircle2;

            return (
              <div
                key={toast.id}
                className={`pointer-events-auto flex items-center justify-between gap-2.5 rounded-2xl border bg-card/95 px-3.5 py-2.5 shadow-2xl backdrop-blur-md ${
                  isError ? 'border-rose-500/40' : 'border-accent/50'
                }`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      isError ? 'text-rose-400' : 'text-accent'
                    }`}
                    strokeWidth={1.5}
                  />
                  <span className="truncate text-xs font-medium text-ink">
                    {toast.message}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {toast.action?.label && (
                    <button
                      type="button"
                      onClick={() => {
                        toast.action.onClick?.();
                        dismissToast(toast.id);
                      }}
                      className="rounded-lg border border-accent/40 bg-accent/15 px-2.5 py-1 text-[11px] font-semibold text-accent hover:bg-accent hover:text-accent-ink"
                    >
                      {toast.action.label}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => dismissToast(toast.id)}
                    aria-label="Fechar notificação"
                    className="rounded-full p-1 text-subtle hover:text-ink"
                  >
                    <X className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
