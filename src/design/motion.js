export const MOTION_TOKENS = {
  fastMs: 150,
  normalMs: 240,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
};

export function prefersReducedMotion() {
  if (typeof window === 'undefined') return true;
  if (document?.documentElement?.getAttribute('data-motion') === 'reduced') {
    return true;
  }
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

export function runSafeViewTransition(callback, motionPref = 'system') {
  if (typeof callback !== 'function') return;
  const skip =
    motionPref === 'reduced' ||
    prefersReducedMotion() ||
    typeof document === 'undefined' ||
    typeof document.startViewTransition !== 'function';
  if (skip) {
    callback();
    return;
  }
  document.startViewTransition(() => {
    callback();
  });
}

export function captureFlipRects(elementsByKey) {
  const rects = new Map();
  if (!elementsByKey || typeof elementsByKey.forEach !== 'function') return rects;
  elementsByKey.forEach((el, key) => {
    if (el && typeof el.getBoundingClientRect === 'function') {
      const r = el.getBoundingClientRect();
      rects.set(key, { left: r.left, top: r.top, width: r.width, height: r.height });
    }
  });
  return rects;
}

export function playFlipTransitions(prevRects, elementsByKey, durationMs = MOTION_TOKENS.normalMs) {
  if (!prevRects || !elementsByKey || prefersReducedMotion()) return 0;
  let animated = 0;
  elementsByKey.forEach((el, key) => {
    const first = prevRects.get(key);
    if (!first || !el || typeof el.getBoundingClientRect !== 'function') return;
    const last = el.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    if (typeof el.animate === 'function') {
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: 'translate(0px, 0px)' },
        ],
        {
          duration: durationMs,
          easing: MOTION_TOKENS.easing,
        }
      );
      animated += 1;
    }
  });
  return animated;
}
