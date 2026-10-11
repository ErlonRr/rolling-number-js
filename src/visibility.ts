/**
 * Shared IntersectionObserver per Document (threshold 0.25) for
 * `trigger: 'visible'` (docs/design/v1.3.md §8.3, §3.3). Owned by WP4.
 *
 * One observer per Document, created from `doc.defaultView.IntersectionObserver`
 * (realm-safe) on the first observation and disconnected when its last
 * element is unobserved. Callbacks are kept per element; each watcher is
 * notified only when its own state changes.
 *
 * @internal
 * @module
 */

const THRESHOLD = 0.25;
/** Tolerance for ratios reported a hair under the threshold at the crossing. */
const EPSILON = 1e-3;

interface Watcher {
  readonly cb: (visible: boolean) => void;
  visible: boolean | null;
  stopped: boolean;
}

interface Shared {
  readonly io: IntersectionObserver;
  readonly targets: Map<Element, Set<Watcher>>;
}

const observers = new WeakMap<Document, Shared>();

/** At least 25% of the element is in the viewport (a zero-area element: any intersection). */
function isVisible(entry: IntersectionObserverEntry): boolean {
  if (!entry.isIntersecting) return false;
  if (entry.intersectionRatio >= THRESHOLD - EPSILON) return true;
  const rect = entry.boundingClientRect;
  return !!rect && rect.width * rect.height === 0;
}

function createShared(IO: typeof IntersectionObserver): Shared | null {
  const targets = new Map<Element, Set<Watcher>>();
  const onEntries = (entries: IntersectionObserverEntry[]): void => {
    // Entries are in time order: the last one per target wins.
    const latest = new Map<Element, boolean>();
    for (const entry of entries) latest.set(entry.target, isVisible(entry));
    latest.forEach((visible, target) => {
      const watchers = targets.get(target);
      if (!watchers) return;
      for (const w of Array.from(watchers)) {
        if (w.stopped || w.visible === visible) continue;
        w.visible = visible;
        w.cb(visible);
      }
    });
  };
  try {
    return { io: new IO(onEntries, { threshold: THRESHOLD }), targets };
  } catch {
    return null;
  }
}

/** A handle that is visible from the start (no IntersectionObserver or no defaultView). */
function alwaysVisible(cb: (visible: boolean) => void): { stop(): void; readonly visible: boolean | null } {
  cb(true);
  return { stop() {}, visible: true };
}

/**
 * Observes `el`. `visible` is null until the first callback (null counts as
 * not visible). Without IntersectionObserver or a defaultView, `cb(true)` is
 * called synchronously and `visible` is true.
 */
export function observeVisibility(
  el: Element,
  cb: (visible: boolean) => void
): { stop(): void; readonly visible: boolean | null } {
  const doc = el.ownerDocument;
  const view = doc ? doc.defaultView : null;
  const IO = view ? (view as Window & typeof globalThis).IntersectionObserver : undefined;
  if (!doc || typeof IO !== 'function') return alwaysVisible(cb);

  let shared = observers.get(doc);
  if (!shared) {
    const created = createShared(IO);
    if (!created) return alwaysVisible(cb);
    shared = created;
    observers.set(doc, shared);
  }
  const s = shared;
  const watcher: Watcher = { cb, visible: null, stopped: false };

  const watchers = s.targets.get(el);
  if (watchers) {
    // Already observed: observe() again would be a no-op, so re-observe to
    // get a fresh initial notification for the new watcher.
    watchers.add(watcher);
    s.io.unobserve(el);
    s.io.observe(el);
  } else {
    s.targets.set(el, new Set([watcher]));
    s.io.observe(el);
  }

  return {
    stop(): void {
      if (watcher.stopped) return;
      watcher.stopped = true;
      const current = s.targets.get(el);
      if (!current || !current.delete(watcher) || current.size > 0) return;
      s.targets.delete(el);
      s.io.unobserve(el);
      if (s.targets.size === 0) {
        s.io.disconnect();
        if (observers.get(doc) === s) observers.delete(doc);
      }
    },
    get visible(): boolean | null {
      return watcher.visible;
    }
  };
}
