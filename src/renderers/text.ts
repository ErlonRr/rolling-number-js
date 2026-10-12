/**
 * Text-mode renderer for form controls, `<option>`, SVG text and
 * `mode: 'text'` (docs/design/v1.3.md §6, §3.3). Owned by WP4.
 *
 * The renderer receives the `Formatter` from the factory (and through
 * `setFormatter`) and builds every string itself; it writes only when the
 * string differs from what the host shows. It never writes `defaultValue`,
 * never dispatches `input`/`change` events and never touches role, aria or
 * class (the core owns the host markers), so ngModel, v-model and controlled
 * inputs never loop.
 *
 * Writes skip a focused form control: the core treats the change as instant
 * (`canAnimate()` is false), and `rest()` defers the final text to a one-shot
 * `blur` listener that writes only when the control still shows the last
 * string written by the renderer (a user edit wins).
 *
 * @internal
 * @module
 */
import type {
  DisplayState, FrameState, Formatter, MotionLayout, Renderer, RestState
} from '../internal/contracts';
import type { RollingNumberMode } from '../types';
import { ssrChild } from './columns';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * `input` types of the HTML standard that are not text-like. Under `auto`
 * they resolve to unsupported; every other type (text, search, tel, url,
 * email, number, a missing or an unknown type) resolves to text, as browsers
 * render an unknown type as a text field.
 */
const NON_TEXT_INPUT_TYPES = new Set([
  'hidden', 'password', 'checkbox', 'radio', 'range', 'color', 'date', 'month',
  'week', 'time', 'datetime-local', 'file', 'image', 'submit', 'reset', 'button'
]);

/** HTML elements that cannot show columns or text: unsupported under `auto`. */
const UNSUPPORTED_HTML = new Set([
  'select', 'img', 'video', 'audio', 'canvas', 'iframe', 'br', 'hr'
]);

/** SVG elements whose text content renders (case-sensitive SVG local names). */
const SVG_TEXT = new Set(['text', 'tspan', 'textPath']);

/** Where a text renderer writes its string. */
type Target = 'input' | 'textarea' | 'option' | 'node';

/** Lower-cased, trimmed `type` attribute of an `input` (`''` when absent). */
function inputType(host: Element): string {
  return (host.getAttribute('type') ?? '').trim().toLowerCase();
}

/** HTML local name, lower-cased (HTML names are case-insensitive); `null` for SVG elements. */
function htmlName(host: Element): string | null {
  return host.namespaceURI === SVG_NS ? null : (host.localName || '').toLowerCase();
}

/**
 * Resolves `mode` for `host` (§6 table). `'columns'` and `'text'` are
 * honored on any element. `'auto'` (and any other value):
 * - text for `input` of a text-like or unknown type, `textarea`, `option`
 *   and SVG `text`/`tspan`/`textPath`;
 * - unsupported for any other `input` type, `select`, `img`, `video`,
 *   `audio`, `canvas`, `iframe`, `br`, `hr` and every SVG element other than
 *   `text`/`tspan`/`textPath`/`foreignObject` (the caller warns once);
 * - columns for SVG `foreignObject` and every other element.
 *
 * Uses `localName` and `namespaceURI` (realm-safe, no `instanceof`); HTML
 * names compare case-insensitively, SVG names case-sensitively.
 */
export function resolveMode(host: Element, mode: RollingNumberMode): 'columns' | 'text' | 'unsupported' {
  if (mode === 'columns' || mode === 'text') return mode;
  const name = htmlName(host);
  if (name === null) {
    if (SVG_TEXT.has(host.localName)) return 'text';
    return host.localName === 'foreignObject' ? 'columns' : 'unsupported';
  }
  if (name === 'input') return NON_TEXT_INPUT_TYPES.has(inputType(host)) ? 'unsupported' : 'text';
  if (name === 'textarea' || name === 'option') return 'text';
  return UNSUPPORTED_HTML.has(name) ? 'unsupported' : 'columns';
}

/** Rounds symmetrically around zero (−2.5 → −3, 2.5 → 3), as the display does; −0 and NaN → 0. */
function roundDisplay(a: number): number {
  return (a < 0 ? -Math.round(-a) : Math.round(a)) || 0;
}

/**
 * Creates the text renderer for `host`.
 *
 * - `input` (any type when `mode: 'text'` is forced; `type="number"` gets
 *   `numericText`, the others `text`) and `textarea`: `el.value`.
 * - `option`: `el.text` (the visible label; `value` is never written).
 * - Anything else (SVG text, any element in `mode: 'text'`): one owned Text
 *   node. When the host contains only text at mount, that text is detached,
 *   replaced and put back on destroy; otherwise the node is appended.
 *
 * `mount(rest, adopt)` with `adopt` (§8.3, Text-node hosts): a direct
 * `[data-rn-ssr]` child gets `hidden` (restored on destroy) and the owned
 * Text node is appended after it. Form controls have no such child (an
 * `<option>`'s children are replaced by its `.text` write).
 */
export function createTextRenderer(host: Element, doc: Document, fmt: Formatter): Renderer {
  const name = htmlName(host);
  const target: Target =
    name === 'input' || name === 'textarea' || name === 'option' ? name : 'node';
  const control = target !== 'node';

  let format = fmt;
  /** Owned Text node (`node` target), created at mount. */
  let node: Text | null = null;
  /** The host's text nodes replaced by `node`, restored on destroy. */
  let saved: Node[] | null = null;
  /** Adopted SSR fallback (`node` target), unhidden on destroy unless it was hidden already. */
  let fallback: Element | null = null;
  /** Last string written (or found on a control when a write was first deferred): the blur guard. */
  let last: string | null = null;
  /** Final string waiting for blur. */
  let deferred: string | null = null;
  let armed = false;
  let dead = false;
  /** Frames of the current motion were skipped on a focused control. */
  let skipped = false;
  /** A user edit was found after such a skip: nothing is written until the next motion. */
  let yielded = false;

  /** `input[type=number]`: read per write, so a runtime `type` change is honored. */
  const numeric = (): boolean => target === 'input' && inputType(host) === 'number';

  /** What the host currently shows, for the "write only when it changes" check and the blur guard. */
  const read = (): string => {
    if (target === 'input' || target === 'textarea') return (host as HTMLInputElement).value;
    // textContent, not `.text`: `.text` strips and collapses whitespace, so it
    // would never compare equal to an affix with leading or double spaces.
    if (target === 'option') return host.textContent ?? '';
    return node ? node.data : '';
  };

  const attach = (): Text => {
    if (node) {
      // Removed from outside (e.g. a framework replaced the children): put it back.
      if (node.parentNode !== host) host.appendChild(node);
      return node;
    }
    const kids = host.childNodes;
    let onlyText = kids.length > 0;
    for (let i = 0; i < kids.length && onlyText; i++) {
      const type = kids[i].nodeType;
      onlyText = type === 3 || type === 4; // TEXT_NODE, CDATA_SECTION_NODE
    }
    if (onlyText) {
      saved = Array.from(kids);
      for (const kid of saved) host.removeChild(kid);
    }
    node = doc.createTextNode('');
    host.appendChild(node);
    return node;
  };

  const put = (s: string): void => {
    if (target === 'node') attach();
    if (read() !== s) {
      if (target === 'option') (host as HTMLOptionElement).text = s;
      else if (target === 'node') (node as Text).data = s;
      else (host as HTMLInputElement).value = s;
    }
    last = s;
  };

  const focused = (): boolean => {
    if (!control || typeof host.getRootNode !== 'function') return false;
    // Document or ShadowRoot; a detached tree's root (an element or a
    // fragment) has no activeElement.
    const root = host.getRootNode() as Partial<DocumentOrShadowRoot>;
    return root.activeElement === host;
  };

  const onBlur = (): void => {
    const s = deferred;
    disarm();
    if (dead || s === null) return;
    // A user edit wins: write only when the control still shows our last string.
    if (read() === last) put(s);
  };

  function arm(s: string): void {
    if (last === null) last = read();
    deferred = s;
    if (!armed) {
      host.addEventListener('blur', onBlur);
      armed = true;
    }
  }

  function disarm(): void {
    deferred = null;
    if (armed) {
      host.removeEventListener('blur', onBlur);
      armed = false;
    }
  }

  /** Writes `s` now, or defers it to the guarded blur write on a focused control. */
  const write = (s: string): void => {
    if (focused()) {
      arm(s);
      return;
    }
    disarm();
    put(s);
  };

  const rest = (r: RestState): void => {
    if (dead) return;
    // The motion ended after yielding to a user edit: its final write is skipped too.
    if (yielded) yielded = false;
    else write(numeric() ? r.numericText : r.text);
  };

  return {
    kind: 'text',
    mount(r: RestState, adopt: boolean): void {
      if (dead) return;
      if (target === 'node') {
        const el = adopt ? ssrChild(host) : null;
        if (el && !el.hasAttribute('hidden')) {
          el.setAttribute('hidden', '');
          fallback = el;
        }
        attach();
      }
      rest(r);
    },
    setFormatter(f: Formatter): void {
      format = f;
    },
    canAnimate(): boolean {
      return !focused();
    },
    begin(motion: MotionLayout, kind: 'count' | 'roll', t: RestState): void {
      void motion; void kind; void t;
      skipped = yielded = false;
    },
    measure(): void {},
    frame(fs: FrameState): void {
      // Writes skip a focused control (decision 19); the final rest() defers to blur.
      if (dead || yielded) return;
      if (focused()) {
        skipped = true;
        return;
      }
      // Back from a focus mid-motion: a value other than the last one written
      // is a user edit, which wins for the rest of this motion.
      if (skipped) {
        skipped = false;
        if (read() !== last) {
          yielded = true;
          return;
        }
      }
      const a = roundDisplay(fs.A);
      disarm();
      put(numeric() ? format.numericText(a) : format.text(a, fs.ovf >= 0.5));
    },
    rest,
    displayed(): DisplayState | null {
      return null;
    },
    probe(): Element | null {
      return null;
    },
    destroy(): void {
      if (dead) return;
      dead = true;
      disarm();
      // Form controls keep the last value. Text hosts get their text back.
      const own = node;
      node = null;
      if (own) {
        const parent = own.parentNode;
        if (parent === host && saved) for (const kid of saved) host.insertBefore(kid, own);
        if (parent) parent.removeChild(own);
      }
      saved = null;
      fallback?.removeAttribute('hidden');
      fallback = null;
    }
  };
}
