import { vi } from 'vitest';

/**
 * Mocked IntersectionObserver for happy-dom tests (`trigger: 'visible'`,
 * src/visibility.ts). Nothing is delivered on its own: the test decides when
 * an element enters or leaves the viewport with `IoController.intersect`.
 *
 * Installed with `vi.stubGlobal`, so `unstubGlobals: true` (vitest.config.ts)
 * restores the previous constructor after each test. In vitest's happy-dom
 * environment `document.defaultView === globalThis`, so the library sees the
 * mock through `doc.defaultView.IntersectionObserver`.
 */

/** Overrides for a delivered entry (defaults derive from `ratio`). */
export interface MockEntryInit {
  isIntersecting?: boolean;
  /** Width × height of `boundingClientRect` (default 10 × 10). */
  width?: number;
  height?: number;
}

/** Observers created since the last `installIntersectionObserver()`. */
let created: MockIntersectionObserver[] = [];

/** Every mock observer that is not disconnected, across installs (a test that forgot to stop still gets entries). */
const live = new Set<MockIntersectionObserver>();

/** IntersectionObserver double: records observe/unobserve/disconnect and its options. */
export class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds: ReadonlyArray<number>;
  readonly targets = new Set<Element>();
  readonly options: IntersectionObserverInit | undefined;
  disconnected = false;
  observeCalls = 0;
  unobserveCalls = 0;

  constructor(
    readonly callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit
  ) {
    this.options = options;
    this.root = options?.root ?? null;
    this.rootMargin = options?.rootMargin ?? '0px';
    const t = options?.threshold ?? 0;
    this.thresholds = Array.isArray(t) ? t : [t as number];
    live.add(this);
    created.push(this);
  }

  observe(target: Element): void {
    this.observeCalls++;
    this.disconnected = false;
    live.add(this);
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.unobserveCalls++;
    this.targets.delete(target);
  }

  disconnect(): void {
    this.disconnected = true;
    this.targets.clear();
    live.delete(this);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Delivers one batch of entries (only for targets this observer watches). */
  deliver(entries: IntersectionObserverEntry[]): void {
    const mine = entries.filter((e) => this.targets.has(e.target));
    if (mine.length) this.callback(mine, this);
  }
}

/** Builds an entry for `target` at `ratio` (0..1). */
export function makeEntry(target: Element, ratio: number, init: MockEntryInit = {}): IntersectionObserverEntry {
  const width = init.width ?? 10;
  const height = init.height ?? 10;
  const rect = { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON() { return this; } };
  return {
    target,
    time: 0,
    intersectionRatio: ratio,
    isIntersecting: init.isIntersecting ?? ratio > 0,
    boundingClientRect: rect as DOMRectReadOnly,
    intersectionRect: rect as DOMRectReadOnly,
    rootBounds: null
  };
}

export interface IoController {
  /** Observers constructed since install, in creation order. */
  readonly observers: readonly MockIntersectionObserver[];
  /** Number of observers that are not disconnected. */
  live(): number;
  /** Whether a live observer currently watches `el`. */
  observed(el: Element): boolean;
  /**
   * Delivers an entry for `el` to every live observer watching it. `ratio`:
   * a number in [0, 1], `true` (= 1) or `false` (= 0).
   */
  intersect(el: Element, ratio: number | boolean, init?: MockEntryInit): void;
  /** Delivers several entries in one callback batch. */
  batch(entries: IntersectionObserverEntry[]): void;
}

/** Replaces `IntersectionObserver` with the mock; returns its controller. */
export function installIntersectionObserver(): IoController {
  created = [];
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  const batch = (entries: IntersectionObserverEntry[]): void => {
    for (const io of Array.from(live)) io.deliver(entries);
  };
  return {
    get observers() {
      return created;
    },
    live: () => live.size,
    observed: (el) => Array.from(live).some((io) => io.targets.has(el)),
    intersect(el, ratio, init) {
      const r = ratio === true ? 1 : ratio === false ? 0 : ratio;
      batch([makeEntry(el, r, init)]);
    },
    batch
  };
}

/** Removes `IntersectionObserver` (the no-IO fallback); restored after the test. */
export function removeIntersectionObserver(): void {
  vi.stubGlobal('IntersectionObserver', undefined);
}
