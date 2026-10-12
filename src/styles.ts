/**
 * Automatic stylesheet injection and the global configuration
 * (docs/design/v1.3.md §9). Owned by WP5.
 *
 * - One constructed `CSSStyleSheet` per **Document** (a constructed sheet can
 *   only be adopted by its constructor document), adopted by that Document and
 *   by every ShadowRoot under it that hosts a counter.
 * - The rules are wrapped in `@layer rolling-number` where cascade layers are
 *   supported, so any unlayered author rule wins; without `@layer` they are
 *   injected unlayered.
 * - Without constructable stylesheets, a `<style data-rn-style>` element (with
 *   the configured CSP nonce) is prepended to `<head>` or to the ShadowRoot.
 * - Nothing runs at import time, and injection never throws.
 *
 * @module
 */
import RULES from './css/rules.css?inline';
import type { RollingNumberConfig } from './types';

/**
 * A value shared by every copy of the package loaded in this realm (ESM, CJS,
 * the IIFE, two bundles), kept in `globalThis[Symbol.for('rolling-number.' + name)]`
 * and created on first access.
 * @internal
 */
export function slot<T>(name: string, make: () => T): T {
  const g = globalThis as unknown as Record<symbol, T | undefined>;
  const key = Symbol.for('rolling-number.' + name);
  let value = g[key];
  if (value === undefined) g[key] = value = make();
  return value;
}

/** The live global configuration (created on first access). @internal */
export function getConfig(): Required<RollingNumberConfig> {
  return slot('config', () => ({ injectStyles: true, nonce: null }));
}

/**
 * Global configuration of rolling-number. Call it before the first counter is
 * created; later calls apply to roots injected afterwards.
 *
 * @param config `injectStyles: false` turns automatic style injection off
 *   everywhere (import `rolling-number/style.css` yourself); `nonce` is used
 *   by the `<style>` fallback under a strict CSP.
 *
 * @example
 * ```ts
 * import { configureRollingNumber } from 'rolling-number';
 * configureRollingNumber({ injectStyles: false });
 * ```
 */
export function configureRollingNumber(config: RollingNumberConfig): void {
  const current = getConfig();
  if (!config || typeof config !== 'object') return;
  if (config.injectStyles !== undefined) current.injectStyles = config.injectStyles !== false;
  if (config.nonce !== undefined) current.nonce = config.nonce ?? null;
}

/** A root that can hold stylesheets. */
type StyleRoot = Document | ShadowRoot;

/** The parts of a Window used here, all optional (older engines, foreign realms). */
interface StyleView {
  CSSStyleSheet?: { new (): CSSStyleSheet };
  CSSLayerBlockRule?: unknown;
}

/** Constructed sheet per Document (`null` = constructable stylesheets are unavailable there), shared by every copy. */
const sheets = (): WeakMap<Document, CSSStyleSheet | null> => slot('sheets', () => new WeakMap());
/** The `<style data-rn-style>` fallback of each root, shared by every copy. */
const styleEls = (): WeakMap<StyleRoot, HTMLStyleElement> => slot('styles', () => new WeakMap());

/** Realm-safe check for a Document or a ShadowRoot (a DocumentFragment with a host). */
function isStyleRoot(node: Node | null | undefined): node is StyleRoot {
  return !!node && (node.nodeType === 9 || (node.nodeType === 11 && !!(node as ShadowRoot).host));
}

/** The injected text: wrapped in `@layer rolling-number` when the engine supports cascade layers. */
function sheetText(view: StyleView): string {
  return typeof view.CSSLayerBlockRule !== 'undefined' ? '@layer rolling-number{' + RULES + '}' : RULES;
}

/** The Document's shared sheet, created on first use; `null` without constructable stylesheets. */
function sheetFor(doc: Document, view: StyleView): CSSStyleSheet | null {
  const map = sheets();
  let sheet = map.get(doc);
  if (sheet !== undefined) return sheet;
  sheet = null;
  try {
    const Sheet = view.CSSStyleSheet;
    if (typeof Sheet === 'function' && 'adoptedStyleSheets' in doc) {
      const created = new Sheet();
      if (typeof created.replaceSync === 'function') {
        created.replaceSync(sheetText(view));
        sheet = created;
      }
    }
  } catch {
    // Old engines expose CSSStyleSheet without a constructor ("Illegal constructor").
    sheet = null;
  }
  map.set(doc, sheet);
  return sheet;
}

/** Adds `sheet` to `root.adoptedStyleSheets` unless it is already there. `false` when adoption is unavailable. */
function adopt(root: StyleRoot, sheet: CSSStyleSheet): boolean {
  try {
    const list = root.adoptedStyleSheets;
    if (!list) return false;
    // Re-checked on every call: Lit, HMR and apps may reassign the whole array.
    if (!list.includes(sheet)) root.adoptedStyleSheets = [...list, sheet];
    return true;
  } catch {
    return false;
  }
}

/**
 * Fallback without constructable stylesheets: one `<style data-rn-style>` per
 * root, first child of `<head>` or of the ShadowRoot. Put back when it was
 * removed (a shadow root re-rendered with `innerHTML`, a rewritten head).
 */
function appendStyleElement(root: StyleRoot, doc: Document, view: StyleView): void {
  try {
    const parent: Node | null = root.nodeType === 9 ? (root as Document).head : root;
    if (!parent) return; // no <head> yet: retried on the next call
    const map = styleEls();
    let style = map.get(root);
    if (style && style.parentNode === parent) return;
    if (!style) {
      style = doc.createElement('style');
      style.setAttribute('data-rn-style', '');
      const nonce = getConfig().nonce;
      if (nonce) style.setAttribute('nonce', nonce);
      style.textContent = sheetText(view);
      map.set(root, style);
    }
    parent.insertBefore(style, parent.firstChild);
  } catch {
    // Never throw from injection.
  }
}

/** Puts the stylesheet into `root`. Skips documents without a window (`createHTMLDocument`, `DOMParser`, detached iframes). */
function inject(root: StyleRoot): void {
  const doc = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
  const view = doc && (doc.defaultView as (Window & StyleView) | null);
  if (!view) return;
  const sheet = sheetFor(doc, view);
  if (sheet && adopt(root, sheet)) return;
  appendStyleElement(root, doc, view);
}

/**
 * Injects the stylesheet into `root` (for `injectStyles: false` setups, or to
 * pre-warm a shadow root). Ignores the `injectStyles` opt-outs. Idempotent,
 * and does nothing for a document without a window.
 *
 * @param root A Document or a ShadowRoot.
 *
 * @example
 * ```ts
 * import { configureRollingNumber, injectRollingNumberStyles } from 'rolling-number';
 * configureRollingNumber({ injectStyles: false });
 * injectRollingNumberStyles(myShadowRoot);
 * ```
 */
export function injectRollingNumberStyles(root: Document | ShadowRoot): void {
  try {
    if (isStyleRoot(root)) inject(root);
  } catch {
    // Never throw from injection.
  }
}

/**
 * Makes sure the stylesheet is present in `host`'s root: its ShadowRoot or
 * Document, else (detached host) its owner document. No-op when injection is
 * off globally or for this instance. Nothing is cached per host, so a later
 * call re-checks the root (after the host is attached, or after the
 * root's `adoptedStyleSheets` was reassigned).
 * @internal
 */
export function ensureStyles(host: Element, perInstance: boolean): void {
  if (!perInstance || !getConfig().injectStyles) return;
  try {
    let root: Node | null = typeof host.getRootNode === 'function' ? host.getRootNode() : null;
    if (!isStyleRoot(root)) root = host.ownerDocument;
    if (isStyleRoot(root)) inject(root);
  } catch {
    // Never throw from injection.
  }
}
