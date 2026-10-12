/**
 * Style injection (docs/design/v1.3.md §9, §11 WP5).
 *
 * happy-dom 20 support, checked when this file was written:
 * - `new window.CSSStyleSheet()`, `replaceSync` and `adoptedStyleSheets` on
 *   Document and ShadowRoot work (assignment is validated with `instanceof`
 *   the window's own `CSSStyleSheet`, a per-window subclass);
 * - `CSSLayerBlockRule` is not defined and `@layer` blocks parse to zero rules,
 *   so the default path here is the unlayered one; the layered path is tested
 *   by defining a stub `CSSLayerBlockRule` and reading the text given to
 *   `replaceSync`;
 * - `document.implementation.createHTMLDocument()` has `defaultView === null`;
 * - adoption is checked per window, not per document: a sheet of the same
 *   window adopted by another document is accepted (browsers throw
 *   `NotAllowedError`), so "one sheet per Document" is asserted on identities;
 * - no fakes are needed except the stubs above; the fallback tests remove
 *   `window.CSSStyleSheet` (or make its constructor throw).
 *
 * Most tests use a fresh happy-dom `Window`, because sheets are cached per
 * Document for the lifetime of the module.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window as HappyWindow } from 'happy-dom';
import RULES from '../src/css/rules.css?inline';
import { configureRollingNumber, ensureStyles, getConfig, injectRollingNumberStyles } from '../src/styles';
import type { RollingNumberConfig } from '../src/types';

type View = Window & typeof globalThis;

const CONFIG_KEY = Symbol.for('rolling-number.config');
const slotHolder = globalThis as unknown as Record<symbol, Required<RollingNumberConfig> | undefined>;

const windows: HappyWindow[] = [];

/** A new, isolated window (own Document, own CSSStyleSheet class). */
function freshWindow(): View {
  const win = new HappyWindow({ url: 'https://example.test/' });
  windows.push(win);
  return win as unknown as View;
}

/** A host attached to `parent` (default: the body of `view`'s document). */
function hostIn(view: View, parent: Node = view.document.body): HTMLElement {
  const el = view.document.createElement('span');
  parent.appendChild(el);
  return el;
}

/** A shadow root attached to a new `div` in `view`'s body. */
function shadowIn(view: View): ShadowRoot {
  return hostIn(view).attachShadow({ mode: 'open' });
}

/** Pretends the engine supports cascade layers (happy-dom does not). */
function stubLayers(view: View): void {
  (view as { CSSLayerBlockRule?: unknown }).CSSLayerBlockRule = class CSSLayerBlockRule {};
}

/** Removes constructable stylesheets from `view` (or replaces the constructor). */
function stubSheetConstructor(view: View, value: unknown = undefined): void {
  (view as { CSSStyleSheet?: unknown }).CSSStyleSheet = value;
}

/** Spy on `replaceSync` of `view`'s CSSStyleSheet class (defined on the shared base prototype). */
function spyReplaceSync(view: View) {
  return vi.spyOn(view.CSSStyleSheet.prototype, 'replaceSync');
}

/** `<style data-rn-style>` children of `parent`. */
function fallbackStyles(parent: ParentNode): HTMLStyleElement[] {
  return Array.from(parent.querySelectorAll('style[data-rn-style]'));
}

/** Text of every rule of a sheet. */
function sheetCss(sheet: CSSStyleSheet): string {
  return Array.from(sheet.cssRules, (r) => r.cssText).join('\n');
}

afterEach(async () => {
  configureRollingNumber({ injectStyles: true, nonce: null });
  for (const win of windows.splice(0)) await win.happyDOM.close();
});

describe('injected stylesheet text', () => {
  it('is non-empty in unit tests (guards test.css.include in vitest.config.ts)', () => {
    expect(RULES.length).toBeGreaterThan(200);
    expect(RULES).toContain('.rn-col');
    expect(RULES).toContain('.rn-scale');
  });

  it('never contains the :root defaults (they live in var() fallbacks)', () => {
    expect(RULES).not.toMatch(/:root\s*\{/);
  });

  it('is what the constructed sheet receives', () => {
    const view = freshWindow();
    const replaceSync = spyReplaceSync(view);
    ensureStyles(hostIn(view), true);
    expect(replaceSync).toHaveBeenCalledTimes(1);
    expect(replaceSync.mock.calls[0][0]).toBe(RULES);
    const [sheet] = view.document.adoptedStyleSheets;
    expect(sheetCss(sheet)).toContain('.rn-col');
  });
});

describe('ensureStyles: constructable stylesheets', () => {
  it('adopts one sheet per Document, once, whatever the number of hosts and calls', () => {
    const view = freshWindow();
    const replaceSync = spyReplaceSync(view);
    const a = hostIn(view);
    const b = hostIn(view);
    ensureStyles(a, true);
    ensureStyles(b, true);
    ensureStyles(a, true);
    expect(view.document.adoptedStyleSheets).toHaveLength(1);
    expect(replaceSync).toHaveBeenCalledTimes(1);
  });

  it('works in the test environment document', () => {
    const host = document.createElement('span');
    document.body.appendChild(host);
    ensureStyles(host, true);
    const sheets = document.adoptedStyleSheets.filter((s) => sheetCss(s).includes('.rn-col'));
    expect(sheets).toHaveLength(1);
    ensureStyles(host, true);
    expect(document.adoptedStyleSheets.filter((s) => s === sheets[0])).toHaveLength(1);
    host.remove();
  });

  it('adopts the Document sheet once per ShadowRoot, without touching the Document', () => {
    const view = freshWindow();
    const replaceSync = spyReplaceSync(view);
    const root1 = shadowIn(view);
    const root2 = shadowIn(view);
    const inner1 = hostIn(view, root1);
    ensureStyles(inner1, true);
    ensureStyles(hostIn(view, root1), true);
    ensureStyles(hostIn(view, root2), true);
    ensureStyles(inner1, true);
    expect(root1.adoptedStyleSheets).toHaveLength(1);
    expect(root2.adoptedStyleSheets).toHaveLength(1);
    expect(root1.adoptedStyleSheets[0]).toBe(root2.adoptedStyleSheets[0]);
    // Shadow-only counters do not style the light DOM.
    expect(view.document.adoptedStyleSheets).toHaveLength(0);
    // The light DOM then reuses the same sheet.
    ensureStyles(hostIn(view), true);
    expect(view.document.adoptedStyleSheets[0]).toBe(root1.adoptedStyleSheets[0]);
    expect(replaceSync).toHaveBeenCalledTimes(1);
  });

  it('re-adds the sheet after adoptedStyleSheets is reassigned, keeping the other sheets', () => {
    const view = freshWindow();
    const host = hostIn(view);
    ensureStyles(host, true);
    const [ours] = view.document.adoptedStyleSheets;

    view.document.adoptedStyleSheets = [];
    ensureStyles(host, true);
    expect(view.document.adoptedStyleSheets).toEqual([ours]);

    const app = new view.CSSStyleSheet();
    view.document.adoptedStyleSheets = [app];
    ensureStyles(host, true);
    expect(view.document.adoptedStyleSheets).toEqual([app, ours]);

    // Same in a shadow root (Lit/HMR reassignments).
    const root = shadowIn(view);
    const inner = hostIn(view, root);
    ensureStyles(inner, true);
    root.adoptedStyleSheets = [app];
    ensureStyles(inner, true);
    expect(root.adoptedStyleSheets).toEqual([app, ours]);
  });

  it('wraps the rules in @layer rolling-number when cascade layers are supported', () => {
    const view = freshWindow();
    stubLayers(view);
    const replaceSync = spyReplaceSync(view);
    ensureStyles(hostIn(view), true);
    expect(replaceSync).toHaveBeenCalledWith('@layer rolling-number{' + RULES + '}');
    expect(view.document.adoptedStyleSheets).toHaveLength(1);
  });

  it('injects the rules unlayered without CSSLayerBlockRule', () => {
    const view = freshWindow();
    expect('CSSLayerBlockRule' in view).toBe(false);
    const replaceSync = spyReplaceSync(view);
    ensureStyles(hostIn(view), true);
    const text = replaceSync.mock.calls[0][0];
    expect(text).toBe(RULES);
    expect(text).not.toContain('@layer');
  });
});

describe('ensureStyles: documents and realms', () => {
  it('creates distinct sheets for two documents sharing a window identity', () => {
    // Same-origin iframe navigation keeps the WindowProxy but replaces the
    // Document; a constructed sheet only belongs to its constructor document.
    const view = freshWindow();
    const docA = view.document;
    const docB = docA.implementation.createHTMLDocument('next page');
    Object.defineProperty(docB, 'defaultView', { configurable: true, get: () => view });
    const replaceSync = spyReplaceSync(view);

    ensureStyles(hostIn(view), true);
    const hostB = docB.createElement('span');
    docB.body.appendChild(hostB);
    ensureStyles(hostB, true);

    expect(docA.adoptedStyleSheets).toHaveLength(1);
    expect(docB.adoptedStyleSheets).toHaveLength(1);
    expect(docA.adoptedStyleSheets[0]).not.toBe(docB.adoptedStyleSheets[0]);
    expect(replaceSync).toHaveBeenCalledTimes(2);
  });

  it('creates the sheet with the constructor of the host document window (iframes, other windows)', () => {
    const view = freshWindow();
    const iframe = view.document.createElement('iframe');
    view.document.body.appendChild(iframe);
    const frameView = iframe.contentWindow as unknown as View;
    const frameDoc = iframe.contentDocument as Document;

    ensureStyles(hostIn(view), true);
    const frameHost = frameDoc.createElement('span');
    frameDoc.body.appendChild(frameHost);
    ensureStyles(frameHost, true);

    const outer = view.document.adoptedStyleSheets[0];
    const inner = frameDoc.adoptedStyleSheets[0];
    expect(inner).toBeInstanceOf(frameView.CSSStyleSheet);
    expect(outer).toBeInstanceOf(view.CSSStyleSheet);
    expect(inner).not.toBe(outer);

    const other = freshWindow();
    ensureStyles(hostIn(other), true);
    expect(other.document.adoptedStyleSheets[0]).toBeInstanceOf(other.CSSStyleSheet);
    expect(other.document.adoptedStyleSheets[0]).not.toBe(outer);
  });

  it('skips a document without a window, without throwing, and re-checks on the next call', () => {
    const view = freshWindow();
    const doc = view.document.implementation.createHTMLDocument('inert');
    expect(doc.defaultView).toBeNull();
    const host = doc.createElement('span');
    doc.body.appendChild(host);

    expect(() => ensureStyles(host, true)).not.toThrow();
    expect(() => injectRollingNumberStyles(doc)).not.toThrow();
    expect(doc.adoptedStyleSheets).toHaveLength(0);
    expect(fallbackStyles(doc)).toHaveLength(0);

    // The miss is not cached: once the document has a window, it is styled.
    Object.defineProperty(doc, 'defaultView', { configurable: true, get: () => view });
    ensureStyles(host, true);
    expect(doc.adoptedStyleSheets).toHaveLength(1);
  });

  it('styles the owner document of a detached host, then its shadow root once attached there', () => {
    const view = freshWindow();
    const host = view.document.createElement('span');
    ensureStyles(host, true);
    expect(view.document.adoptedStyleSheets).toHaveLength(1);

    const root = shadowIn(view);
    root.appendChild(host);
    ensureStyles(host, true);
    expect(root.adoptedStyleSheets).toEqual(view.document.adoptedStyleSheets);
  });

  it('treats a host inside a plain DocumentFragment as detached', () => {
    const view = freshWindow();
    const fragment = view.document.createDocumentFragment();
    const host = hostIn(view, fragment);
    ensureStyles(host, true);
    expect(view.document.adoptedStyleSheets).toHaveLength(1);
  });

  it('works with SVG hosts', () => {
    const view = freshWindow();
    const svg = view.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const text = view.document.createElementNS('http://www.w3.org/2000/svg', 'text');
    svg.appendChild(text);
    view.document.body.appendChild(svg);
    ensureStyles(text, true);
    expect(view.document.adoptedStyleSheets).toHaveLength(1);
  });
});

describe('ensureStyles: <style> fallback', () => {
  it('prepends one <style data-rn-style nonce> to <head> without constructable stylesheets', () => {
    const view = freshWindow();
    stubSheetConstructor(view);
    const existing = view.document.createElement('link');
    view.document.head.appendChild(existing);
    configureRollingNumber({ nonce: 'r4nd0m' });

    ensureStyles(hostIn(view), true);
    ensureStyles(hostIn(view), true);

    const styles = fallbackStyles(view.document);
    expect(styles).toHaveLength(1);
    const [style] = styles;
    expect(style.parentNode).toBe(view.document.head);
    expect(view.document.head.firstChild).toBe(style);
    expect(style.getAttribute('nonce')).toBe('r4nd0m');
    expect(style.textContent).toBe(RULES);
    expect(style.textContent).toContain('.rn-col');
    expect(view.document.adoptedStyleSheets).toHaveLength(0);
  });

  it('prepends one <style> per ShadowRoot', () => {
    const view = freshWindow();
    stubSheetConstructor(view);
    const root = shadowIn(view);
    const first = view.document.createElement('b');
    root.appendChild(first);
    ensureStyles(hostIn(view, root), true);
    ensureStyles(hostIn(view, root), true);
    expect(fallbackStyles(root)).toHaveLength(1);
    expect(root.firstChild).toBe(fallbackStyles(root)[0]);
    // The light DOM is not styled by a shadow-only counter.
    expect(fallbackStyles(view.document)).toHaveLength(0);
  });

  it('has no nonce attribute when no nonce is configured, and follows cascade-layer support', () => {
    const view = freshWindow();
    stubSheetConstructor(view);
    stubLayers(view);
    ensureStyles(hostIn(view), true);
    const [style] = fallbackStyles(view.document);
    expect(style.hasAttribute('nonce')).toBe(false);
    expect(style.textContent).toBe('@layer rolling-number{' + RULES + '}');
  });

  it('falls back when the CSSStyleSheet constructor throws (old engines)', () => {
    const view = freshWindow();
    stubSheetConstructor(view, function CSSStyleSheet() {
      throw new TypeError('Illegal constructor');
    });
    expect(() => ensureStyles(hostIn(view), true)).not.toThrow();
    expect(fallbackStyles(view.document)).toHaveLength(1);
  });

  it('falls back when adoption throws', () => {
    const view = freshWindow();
    Object.defineProperty(view.document, 'adoptedStyleSheets', {
      configurable: true,
      get: () => [],
      set: () => {
        throw new DOMException('not allowed', 'NotAllowedError');
      }
    });
    expect(() => ensureStyles(hostIn(view), true)).not.toThrow();
    expect(fallbackStyles(view.document)).toHaveLength(1);
  });

  it('re-inserts the <style> after it was removed (a shadow root re-rendered with innerHTML, a head rewrite)', () => {
    const view = freshWindow();
    stubSheetConstructor(view);
    const root = shadowIn(view);
    ensureStyles(hostIn(view, root), true);
    const [style] = fallbackStyles(root);
    root.innerHTML = '<p>re-rendered</p>';
    expect(fallbackStyles(root)).toHaveLength(0);
    ensureStyles(hostIn(view, root), true);
    expect(fallbackStyles(root)).toEqual([style]);
    expect(root.firstChild).toBe(style);

    ensureStyles(hostIn(view), true);
    const [docStyle] = fallbackStyles(view.document);
    docStyle.remove();
    ensureStyles(hostIn(view), true);
    expect(fallbackStyles(view.document)).toEqual([docStyle]);
    expect(view.document.head.firstChild).toBe(docStyle);
    ensureStyles(hostIn(view), true);
    expect(fallbackStyles(view.document)).toHaveLength(1);
  });

  it('never writes markup: the rules are set as textContent', () => {
    const view = freshWindow();
    stubSheetConstructor(view);
    ensureStyles(hostIn(view), true);
    const [style] = fallbackStyles(view.document);
    expect(style.childNodes).toHaveLength(1);
    expect(style.firstChild?.nodeType).toBe(3);
  });
});

describe('opt-outs and configuration', () => {
  it('global opt-out: configureRollingNumber({ injectStyles: false }) disables ensureStyles', () => {
    const view = freshWindow();
    configureRollingNumber({ injectStyles: false });
    ensureStyles(hostIn(view), true);
    expect(view.document.adoptedStyleSheets).toHaveLength(0);
    configureRollingNumber({ injectStyles: true });
    ensureStyles(hostIn(view), true);
    expect(view.document.adoptedStyleSheets).toHaveLength(1);
  });

  it('per-instance opt-out: ensureStyles(host, false) does nothing', () => {
    const view = freshWindow();
    const replaceSync = spyReplaceSync(view);
    ensureStyles(hostIn(view), false);
    expect(view.document.adoptedStyleSheets).toHaveLength(0);
    expect(replaceSync).not.toHaveBeenCalled();
  });

  it('opt-outs also apply to the <style> fallback', () => {
    const view = freshWindow();
    stubSheetConstructor(view);
    configureRollingNumber({ injectStyles: false });
    ensureStyles(hostIn(view), true);
    configureRollingNumber({ injectStyles: true });
    ensureStyles(hostIn(view), false);
    expect(fallbackStyles(view.document)).toHaveLength(0);
  });

  it('configureRollingNumber keeps unspecified fields and ignores invalid input', () => {
    configureRollingNumber({ nonce: 'abc' });
    configureRollingNumber({ injectStyles: false });
    expect(getConfig()).toEqual({ injectStyles: false, nonce: 'abc' });
    configureRollingNumber({ nonce: null });
    expect(getConfig().nonce).toBeNull();
    configureRollingNumber(null as unknown as RollingNumberConfig);
    expect(getConfig()).toEqual({ injectStyles: false, nonce: null });
  });

  it('keeps the configuration in the Symbol.for slot shared by every copy of the package', () => {
    configureRollingNumber({ injectStyles: false, nonce: 'n1' });
    // What another copy (CJS next to ESM) reads:
    expect(slotHolder[CONFIG_KEY]).toEqual({ injectStyles: false, nonce: 'n1' });
    expect(slotHolder[CONFIG_KEY]).toBe(getConfig());
  });

  it('honors a slot written by another copy of the package', () => {
    const view = freshWindow();
    const saved = slotHolder[CONFIG_KEY];
    try {
      // Another copy loaded first and was configured with injection off.
      slotHolder[CONFIG_KEY] = { injectStyles: false, nonce: null };
      ensureStyles(hostIn(view), true);
      expect(view.document.adoptedStyleSheets).toHaveLength(0);

      // ...and later turned it back on, with a nonce for the fallback.
      slotHolder[CONFIG_KEY]!.injectStyles = true;
      slotHolder[CONFIG_KEY]!.nonce = 'from-other-copy';
      stubSheetConstructor(view);
      ensureStyles(hostIn(view), true);
      expect(fallbackStyles(view.document)[0].getAttribute('nonce')).toBe('from-other-copy');
    } finally {
      slotHolder[CONFIG_KEY] = saved;
    }
  });

  // An ESM copy next to a CJS or IIFE copy (or two bundles) must not inject twice.
  it('shares the per-Document sheet and the <style> fallback with another copy of the module', async () => {
    const view = freshWindow();
    vi.resetModules();
    const copy = await import('../src/styles');
    expect(copy.ensureStyles).not.toBe(ensureStyles);
    ensureStyles(hostIn(view), true);
    copy.ensureStyles(hostIn(view), true);
    const root = shadowIn(view);
    copy.ensureStyles(hostIn(view, root), true);
    expect(view.document.adoptedStyleSheets).toHaveLength(1);
    expect(root.adoptedStyleSheets).toEqual(view.document.adoptedStyleSheets);

    const other = freshWindow();
    stubSheetConstructor(other);
    copy.ensureStyles(hostIn(other), true);
    ensureStyles(hostIn(other), true);
    expect(fallbackStyles(other.document)).toHaveLength(1);
  });

  it('creates the slot lazily with the defaults', () => {
    const saved = slotHolder[CONFIG_KEY];
    try {
      delete slotHolder[CONFIG_KEY];
      expect(getConfig()).toEqual({ injectStyles: true, nonce: null });
      expect(slotHolder[CONFIG_KEY]).toBe(getConfig());
    } finally {
      slotHolder[CONFIG_KEY] = saved;
    }
  });
});

describe('injectRollingNumberStyles', () => {
  it('injects into a Document and a ShadowRoot, ignoring the opt-outs, idempotently', () => {
    const view = freshWindow();
    configureRollingNumber({ injectStyles: false });
    const root = shadowIn(view);
    injectRollingNumberStyles(view.document);
    injectRollingNumberStyles(view.document);
    injectRollingNumberStyles(root);
    injectRollingNumberStyles(root);
    expect(view.document.adoptedStyleSheets).toHaveLength(1);
    expect(root.adoptedStyleSheets).toEqual(view.document.adoptedStyleSheets);
  });

  it('pre-warms a ShadowRoot before any counter exists, and ensureStyles does not duplicate it', () => {
    const view = freshWindow();
    const root = shadowIn(view);
    injectRollingNumberStyles(root);
    ensureStyles(hostIn(view, root), true);
    expect(root.adoptedStyleSheets).toHaveLength(1);
  });

  it('uses the <style> fallback idempotently', () => {
    const view = freshWindow();
    stubSheetConstructor(view);
    injectRollingNumberStyles(view.document);
    injectRollingNumberStyles(view.document);
    expect(fallbackStyles(view.document)).toHaveLength(1);
  });

  it('ignores anything that is not a Document or a ShadowRoot, without throwing', () => {
    const view = freshWindow();
    const bad = [null, undefined, 42, {}, view.document.createElement('div'), view.document.createDocumentFragment()];
    for (const value of bad) {
      expect(() => injectRollingNumberStyles(value as unknown as Document)).not.toThrow();
    }
    expect(view.document.adoptedStyleSheets).toHaveLength(0);
    expect(fallbackStyles(view.document)).toHaveLength(0);
  });
});

describe('robustness', () => {
  it('never throws, even when the DOM misbehaves', () => {
    const view = freshWindow();
    const host = hostIn(view);
    Object.defineProperty(host, 'getRootNode', {
      configurable: true,
      value: () => {
        throw new Error('boom');
      }
    });
    expect(() => ensureStyles(host, true)).not.toThrow();

    const view2 = freshWindow();
    stubSheetConstructor(view2);
    Object.defineProperty(view2.document, 'head', { configurable: true, get: () => null });
    expect(() => ensureStyles(hostIn(view2), true)).not.toThrow();
    expect(fallbackStyles(view2.document)).toHaveLength(0);
  });

  it('falls back to the owner document for a host without getRootNode', () => {
    const view = freshWindow();
    const host = hostIn(view);
    Object.defineProperty(host, 'getRootNode', { configurable: true, value: undefined });
    ensureStyles(host, true);
    expect(view.document.adoptedStyleSheets).toHaveLength(1);
  });
});
