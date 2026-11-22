import { Activity, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export function PerfOverlay() {
  const [visible, setVisible] = useState(true);
  const [metrics, setMetrics] = useState({
    fcpMs: null,
    lcpMs: null,
    longTasks: 0,
    maxTaskMs: 0,
    heapMb: null,
  });

  useEffect(() => {
    if (!visible || typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
      return undefined;
    }

    const observers = [];
    const register = (entryTypes, cb) => {
      try {
        const obs = new PerformanceObserver(cb);
        entryTypes.forEach((type) => {
          obs.observe({ type, buffered: true });
        });
        observers.push(obs);
      } catch {
        // Navegador pode não suportar determinado observer
      }
    };

    register(['paint'], (list) => {
      const fcp = list.getEntries().find((e) => e.name === 'first-contentful-paint');
      if (fcp) {
        setMetrics((prev) => ({ ...prev, fcpMs: Math.round(fcp.startTime) }));
      }
    });

    register(['largest-contentful-paint'], (list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) {
        setMetrics((prev) => ({ ...prev, lcpMs: Math.round(last.startTime) }));
      }
    });

    register(['longtask'], (list) => {
      const entries = list.getEntries();
      if (!entries.length) return;
      setMetrics((prev) => ({
        ...prev,
        longTasks: prev.longTasks + entries.length,
        maxTaskMs: Math.max(
          prev.maxTaskMs,
          ...entries.map((e) => Math.round(e.duration))
        ),
      }));
    });

    const heapTimer = setInterval(() => {
      const mem = performance?.memory;
      if (mem?.usedJSHeapSize) {
        setMetrics((prev) => ({
          ...prev,
          heapMb: (mem.usedJSHeapSize / (1024 * 1024)).toFixed(1),
        }));
      }
    }, 1500);

    return () => {
      clearInterval(heapTimer);
      observers.forEach((o) => o.disconnect());
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <aside
      aria-label="Monitor de performance"
      className="fixed right-3 top-3 z-50 w-56 rounded-[6px] border border-line bg-card p-2.5 text-[11px] text-ink"
      style={{ boxShadow: 'var(--elev-3)' }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line pb-1.5">
        <span className="inline-flex items-center gap-1 font-semibold text-accent">
          <Activity className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span>Perf (?perf=1)</span>
        </span>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Fechar monitor de performance"
          className="text-muted hover:text-ink"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>
      <dl className="mt-1.5 grid grid-cols-2 gap-y-1 tabular-nums">
        <dt className="text-muted">FCP</dt>
        <dd className="text-right font-medium">
          {metrics.fcpMs !== null ? `${metrics.fcpMs}ms` : '—'}
        </dd>
        <dt className="text-muted">LCP</dt>
        <dd className="text-right font-medium">
          {metrics.lcpMs !== null ? `${metrics.lcpMs}ms` : '—'}
        </dd>
        <dt className="text-muted">Long tasks</dt>
        <dd className="text-right font-medium">
          {metrics.longTasks} ({metrics.maxTaskMs}ms)
        </dd>
        <dt className="text-muted">JS Heap</dt>
        <dd className="text-right font-medium">
          {metrics.heapMb ? `${metrics.heapMb} MB` : 'n/d'}
        </dd>
      </dl>
    </aside>
  );
}
