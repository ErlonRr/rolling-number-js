/**
 * Shared live-region announcer: one ref-counted region per container (each
 * `dialog` / `[aria-modal="true"]`, plus `body`), per-host 300 ms debounce
 * (docs/design/v1.3.md §8.3, §3.3). Owned by WP4.
 *
 * - The region is a visually hidden `div[aria-live][aria-atomic="true"][data-rn-live]`
 *   styled through CSSOM (`style.setProperty`), so it works under a strict CSP.
 * - The container of a host is its closest `dialog` / `[aria-modal="true"]`
 *   ancestor (searched through enclosing shadow roots), else its document's
 *   `body`. Counters inside and outside a modal never share a region.
 * - Regions live in a `WeakMap` keyed by container, are created lazily (first
 *   `retainAnnouncer` or announcement), are ref-counted by the hosts retained
 *   in them, and are removed when the count reaches 0 or the container is
 *   found disconnected (checked on each announce and release).
 * - `announce` is debounced 300 ms per host (the last text and politeness
 *   win), with a 1 s max wait: a host updated faster than every 300 ms still
 *   announces about once per second. The region is cleared, then the text is
 *   set on the next task; texts flushed before that task are joined with
 *   ", ". `aria-live` follows the latest announcement.
 * - Timers use the host's `defaultView`; without one, nothing is announced.
 * - The region map lives in a global slot, so every copy of the package (ESM,
 *   CJS, IIFE) shares one region per container.
 *
 * @internal
 * @module
 */
import { slot } from './styles';

type Politeness = 'polite' | 'assertive';
type View = Window & typeof globalThis;

const DEBOUNCE_MS = 300;
const MAX_WAIT_MS = 1000;
const CONTAINER_SELECTOR = 'dialog,[aria-modal="true"]';

/** Visually hidden, still exposed to assistive technology. */
const HIDDEN_STYLES: ReadonlyArray<readonly [string, string]> = [
  ['position', 'absolute'],
  ['width', '1px'],
  ['height', '1px'],
  ['margin', '-1px'],
  ['padding', '0'],
  ['border', '0'],
  ['overflow', 'hidden'],
  ['clip', 'rect(0 0 0 0)'],
  ['clip-path', 'inset(50%)'],
  ['white-space', 'nowrap']
];

interface Region {
  readonly container: Element;
  /** The live element; created lazily, (re)appended while the container is connected. */
  el: HTMLElement | null;
  /** Hosts bound to this region. */
  count: number;
  /** Texts flushed since the last clear, written on the next task. */
  queue: string[];
  /** Pending "set text" task. */
  timer: number | null;
  view: View | null;
  dead: boolean;
}

/** A retained host and the region it currently counts in. */
interface Binding { refs: number; region: Region; }

/** A host's debounced announcement; `since` = when its burst of updates started (max wait). */
interface Pending { view: View; timer: number; since: number; }

/** Regions by container, shared by every copy of the package. */
const regionMap = (): WeakMap<Element, Region> => slot('regions', () => new WeakMap());
const bindings = new WeakMap<Element, Binding>();
const pendings = new WeakMap<Element, Pending>();

function viewOf(node: Node): View | null {
  const doc = node.ownerDocument;
  return (doc && (doc.defaultView as View | null)) || null;
}

/**
 * `host.closest('dialog,[aria-modal="true"]') ?? host.ownerDocument.body`,
 * also searching through enclosing shadow roots so a counter inside a web
 * component in a modal announces inside that modal.
 */
function containerOf(host: Element): Element | null {
  let el: Element | null = host;
  while (el) {
    const found: Element | null = typeof el.closest === 'function' ? el.closest(CONTAINER_SELECTOR) : null;
    if (found) return found;
    const root: Node | null = typeof el.getRootNode === 'function' ? el.getRootNode() : null;
    // A ShadowRoot is a DocumentFragment (nodeType 11) with a host element.
    const shadowHost: unknown = root && root.nodeType === 11 ? (root as ShadowRoot).host : null;
    el = shadowHost && (shadowHost as Node).nodeType === 1 ? (shadowHost as Element) : null;
  }
  const doc = host.ownerDocument;
  return doc ? doc.body ?? doc.documentElement : null;
}

function regionFor(container: Element): Region {
  const regions = regionMap();
  let region = regions.get(container);
  if (!region) {
    region = { container, el: null, count: 0, queue: [], timer: null, view: null, dead: false };
    regions.set(container, region);
  }
  return region;
}

function createRegionElement(doc: Document): HTMLElement {
  const el = doc.createElement('div');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.setAttribute('data-rn-live', '');
  for (const [name, value] of HIDDEN_STYLES) el.style.setProperty(name, value, 'important');
  return el;
}

/** The region's element, inserted in its container; null while the container is disconnected. */
function regionElement(region: Region): HTMLElement | null {
  const { container } = region;
  if (region.dead || !container.isConnected) return null;
  if (!region.el) region.el = createRegionElement(container.ownerDocument);
  if (region.el.parentNode !== container) {
    // Re-inserted after someone removed it: never show a stale text.
    if (region.timer === null) region.el.textContent = '';
    container.appendChild(region.el);
  }
  return region.el;
}

function dropRegion(region: Region): void {
  if (region.dead) return;
  region.dead = true;
  if (region.timer !== null && region.view) region.view.clearTimeout(region.timer);
  region.timer = null;
  region.queue = [];
  const el = region.el;
  region.el = null;
  if (el && el.parentNode) el.parentNode.removeChild(el);
  const regions = regionMap();
  if (regions.get(region.container) === region) regions.delete(region.container);
}

/** Drops the region of a container found disconnected. */
function dropStale(container: Element): void {
  const stale = regionMap().get(container);
  if (stale) dropRegion(stale);
}

/** Drops the region when its container is disconnected; returns whether it is still usable. */
function checkConnected(region: Region): boolean {
  if (!region.dead && !region.container.isConnected) dropRegion(region);
  return !region.dead;
}

function unbind(region: Region): void {
  if (region.dead) return;
  region.count--;
  if (region.count <= 0) dropRegion(region);
  else checkConnected(region);
}

/** Makes `binding` count in the region of `container` (the host moved, or its region was dropped). */
function rebind(binding: Binding, container: Element): void {
  if (!binding.region.dead && binding.region.container === container) return;
  unbind(binding.region);
  const region = regionFor(container);
  region.count++;
  binding.region = region;
}

function cancelPending(host: Element): void {
  const pending = pendings.get(host);
  if (!pending) return;
  pendings.delete(host);
  pending.view.clearTimeout(pending.timer);
}

/** Queues `text` in `region`: clear now, set on the next task (texts of that task joined with ", "). */
function deliver(region: Region, text: string, politeness: Politeness): void {
  const el = regionElement(region);
  const view = viewOf(region.container);
  if (!el || !view) return;
  el.setAttribute('aria-live', politeness);
  region.queue.push(text);
  if (region.timer !== null) return;
  el.textContent = '';
  region.view = view;
  region.timer = view.setTimeout(() => {
    region.timer = null;
    const joined = region.queue.join(', ');
    region.queue = [];
    if (region.el && !region.dead) region.el.textContent = joined;
  }, 0);
}

function flush(host: Element, text: string, politeness: Politeness): void {
  const container = containerOf(host);
  if (!container) return;
  if (!container.isConnected) {
    dropStale(container);
    return;
  }
  const binding = bindings.get(host);
  let region: Region;
  if (binding) {
    rebind(binding, container);
    region = binding.region;
  } else {
    region = regionFor(container);
  }
  deliver(region, text, politeness);
}

/**
 * Retains the region of `host`'s container (creating and inserting it now, so
 * it exists before the first announcement); returns the release function.
 * Releasing is idempotent. When a host is fully released, its pending
 * announcement is cancelled; the region is removed when no host remains in
 * it or its container is disconnected.
 */
export function retainAnnouncer(host: Element): () => void {
  const container = containerOf(host);
  let binding = bindings.get(host);
  if (binding) {
    binding.refs++;
    if (container) rebind(binding, container);
  } else if (container) {
    const region = regionFor(container);
    region.count++;
    binding = { refs: 1, region };
    bindings.set(host, binding);
  }
  if (binding) regionElement(binding.region);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = bindings.get(host);
    if (!current) return;
    if (--current.refs > 0) {
      checkConnected(current.region);
      return;
    }
    bindings.delete(host);
    cancelPending(host);
    unbind(current.region);
  };
}

/**
 * Announces `text` for `host` through its container's live region, debounced
 * 300 ms per host (the last text and politeness win) with a 1 s max wait, so
 * a host updated faster than every 300 ms still announces about once per
 * second. Empty texts announce nothing (they still replace a pending text).
 */
export function announce(host: Element, text: string, politeness: Politeness): void {
  const view = viewOf(host);
  if (!view) return;
  const container = containerOf(host);
  if (container && !container.isConnected) dropStale(container);
  const now = Date.now();
  const since = pendings.get(host)?.since ?? now;
  cancelPending(host);
  const tone: Politeness = politeness === 'assertive' ? 'assertive' : 'polite';
  const message = String(text);
  const timer = view.setTimeout(() => {
    pendings.delete(host);
    if (message) flush(host, message, tone);
  }, Math.max(0, Math.min(DEBOUNCE_MS, since + MAX_WAIT_MS - now)));
  pendings.set(host, { view, timer, since });
}
