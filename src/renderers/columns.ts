/**
 * Keyed digit-columns renderer (docs/design/v1.3.md §4, §3.3). Owned by WP3.
 *
 * Owns one contiguous block of nodes appended after the host's pre-existing
 * children: an optional `.rn-sign`, one `.rn-col` per digit place and
 * `.rn-static` nodes for affixes, separators and literals. Nodes are keyed by
 * `data-rn-key`, so a column keeps its identity across layout changes (B18).
 *
 * - At rest the position comes from the 1.2 `data-digit` rules; while moving
 *   an inline `transform` on `.rn-scale` is the only per-frame write per column.
 * - Entering and leaving nodes are driven by `--rn-in` × `--rn-w`; entering
 *   nodes are inserted collapsed, widths are measured in the read phase only.
 * - Text is never formatted per frame: sizer text and token text are written at
 *   rest (the sign text only swaps between two known strings).
 *
 * DOM access is realm-safe: nodes come from the `doc` given to the factory,
 * element checks use `nodeType`, and the module touches no DOM at import time.
 *
 * @internal
 * @module
 */
import type {
  DisplayState, Formatter, FrameState, MotionLayout, NumberLayout, Renderer, RestState, Tie, Token, TokenRole
} from '../internal/contracts';

type Presence = 'both' | 'enter' | 'leave' | 'absent';

/** Presence state shared by every owned node. */
interface Base {
  key: string;
  el: HTMLElement;
  /** presence in the current motion; `absent` = owned but missing from the motion layout */
  presence: Presence;
  tie: Tie;
  /** presence (0..1) on screen */
  inn: number;
  /** presence when the current motion began (fade origin for `absent` and untied tokens) */
  inn0: number;
  /** `data-rn-in` is set */
  collapsed: boolean;
  /** last `--rn-in` written */
  innText: string;
  /** measured full width in px (read phase), text tokens only */
  w: number | null;
  /** last `--rn-w` written */
  wText: string;
}

interface ColumnNode extends Base {
  kind: 'digit';
  place: number;
  sizer: HTMLElement;
  scale: HTMLElement;
  /** current `data-digit` */
  digit: string;
  /** current sizer text */
  sizerText: string;
  /** glyph set of the cells (null = ASCII) */
  glyphs: readonly string[] | null;
  /** position on screen, in [0, 10) */
  pos: number;
  /** inline transform written on the scale, null = none (rest) */
  transform: string | null;
  lead: boolean;
  reel: boolean;
}

interface SignNode extends Base {
  kind: 'sign';
  text: string;
  /** the text on screen is a negative sign (feeds `DisplayState.sigma`) */
  negative: boolean;
}

interface StaticNode extends Base {
  kind: 'static';
  role: TokenRole;
  text: string;
}

type OwnedNode = ColumnNode | SignNode | StaticNode;

const clamp01 = (x: number): number => (x > 0 ? (x < 1 ? x : 1) : 0);
const mod10 = (x: number): number => {
  const m = ((x % 10) + 10) % 10;
  return m < 10 ? m : 0;
};
const sameGlyphs = (a: readonly string[] | null, b: readonly string[] | null): boolean => {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
/** Decimal digits of |A| (a safe integer, so `String` never uses exponents). */
const magnitudeDigits = (A: number): string => String(Math.abs(Math.round(A)) || 0);
/** Digit at place k of the string `s` returned by `magnitudeDigits`. */
const digitAt = (s: string, k: number): number => (k < s.length ? s.charCodeAt(s.length - 1 - k) - 48 : 0);
const pxText = (w: number): string => String(Math.round(w * 1000) / 1000) + 'px';

/** The direct `[data-rn-ssr]` child of `host` (an SSR fallback to adopt, §8.3), if any. Shared with the text renderer. */
export function ssrChild(host: Element): Element | null {
  for (let el = host.firstElementChild; el; el = el.nextElementSibling) if (el.hasAttribute('data-rn-ssr')) return el;
  return null;
}

/** Removes inline properties and the `style` attribute once it is empty. */
function removeStyle(el: HTMLElement, ...props: string[]): void {
  const style = el.style;
  for (const p of props) style.removeProperty(p);
  if (style.length === 0 && el.hasAttribute('style')) el.removeAttribute('style');
}

/**
 * Creates the columns renderer for `host` (docs/design/v1.3.md §4).
 *
 * Written with closures (not a class) so the minifier can mangle the
 * internals: this module ships in every DOM bundle.
 *
 * @param host - the element the counter renders into; its other children are never touched.
 * @param doc - the host's owner document (every node is created from it).
 * @param fmt - the current formatter (its glyphs seed new cells until the first `RestState`).
 */
export function createColumnsRenderer(host: Element, doc: Document, fmt: Formatter): Renderer {
  let glyphs: readonly string[] | null = fmt.glyphs;
  /** owned nodes in DOM order */
  let seq: OwnedNode[] = [];
  const byKey = new Map<string, OwnedNode>();
  const owned = new Set<Node>();
  let mounted = false;
  let destroyed = false;

  /** adopted SSR fallback and whether it already had `hidden` */
  let adopted: Element | null = null;
  let adoptedWasHidden = false;
  /** mount() asked for adoption: a fallback added later is adopted too, until the first one */
  let adoptWanted = false;
  /** watches the host's children while the document is still being parsed */
  let watcher: MutationObserver | null = null;

  /** motion state (between begin() and rest()) */
  let moving = false;
  let motionKind: 'count' | 'roll' = 'count';
  /** reference column width in layout px (read phase) */
  let colW: number | null = null;
  /** begin() ran and measure() has not read the widths from a rendered box yet */
  let unmeasured = false;
  /** sign interpolation: `sigma` (negative-only sign) or `lerp` (a positive sign is shown at an endpoint) */
  let signMode: 'sigma' | 'lerp' = 'sigma';
  let signNegText: string | null = null;
  let signPosText: string | null = null;

  // ── nodes ─────────────────────────────────────────────────────────────

  const unwatch = (): void => watcher?.disconnect();

  /**
   * Hides a direct `[data-rn-ssr]` child (restored on destroy) and keeps the
   * owned block after it. Runs at mount, then (until a fallback is adopted)
   * from begin()/rest() and while the parser may still append children: a
   * parsed `<rolling-number>` is connected, and its core created, before its
   * fallback child exists.
   */
  const adopt = (): void => {
    const el = adoptWanted && !adopted ? ssrChild(host) : null;
    if (!el) return;
    adopted = el;
    adoptedWasHidden = el.hasAttribute('hidden');
    if (!adoptedWasHidden) el.setAttribute('hidden', '');
    unwatch();
    let ref = el.nextSibling;
    while (ref && owned.has(ref)) ref = ref.nextSibling;
    reorder(seq, ref);
  };

  const glyph = (d: number): string => (glyphs ? glyphs[d] : String(d));

  const create = (token: Token, digit: number, collapsed: boolean): OwnedNode => {
    const el = doc.createElement('span');
    let node: OwnedNode;
    if (token.kind === 'digit') {
      el.className = 'rn-col';
      const d = String(digit);
      el.setAttribute('data-digit', d);
      el.setAttribute('data-rn-key', token.key);
      const sizer = doc.createElement('span');
      sizer.className = 'rn-sizer';
      sizer.setAttribute('aria-hidden', 'true');
      const sizerText = glyph(digit);
      sizer.textContent = sizerText;
      const scale = doc.createElement('span');
      scale.className = 'rn-scale';
      scale.setAttribute('aria-hidden', 'true');
      if (glyphs) scale.setAttribute('data-rn-zero', glyphs[0]);
      for (let i = 0; i <= 9; i++) {
        const cell = doc.createElement('span');
        cell.className = 'rn-cell';
        cell.textContent = glyph(i);
        scale.appendChild(cell);
      }
      el.appendChild(sizer);
      el.appendChild(scale);
      node = {
        kind: 'digit', key: token.key, el, place: token.place, sizer, scale, digit: d, sizerText,
        glyphs, pos: digit, transform: null, lead: false, reel: false,
        presence: 'both', tie: null, inn: 1, inn0: 1, collapsed: false, innText: '', w: null, wText: ''
      };
    } else {
      if (token.kind === 'sign') {
        el.className = 'rn-sign';
      } else {
        el.className = 'rn-static';
        el.setAttribute('data-rn-part', token.role);
      }
      el.setAttribute('data-rn-key', token.key);
      el.setAttribute('aria-hidden', 'true');
      el.textContent = token.text;
      const base = {
        key: token.key, el, text: token.text, presence: 'both' as Presence, tie: null, inn: 1, inn0: 1,
        collapsed: false, innText: '', w: null, wText: ''
      };
      node = token.kind === 'sign'
        ? { ...base, kind: 'sign', negative: true }
        : { ...base, kind: 'static', role: token.role };
    }
    if (collapsed) {
      node.presence = 'enter';
      node.inn = 0;
      node.inn0 = 0;
      node.collapsed = true;
      node.innText = '0';
      el.setAttribute('data-rn-in', '');
      el.style.setProperty('--rn-in', '0');
    }
    byKey.set(token.key, node);
    owned.add(el);
    return node;
  };

  /** Removes an owned node from the DOM and from the maps. */
  const drop = (node: OwnedNode): void => {
    node.el.remove();
    owned.delete(node.el);
    if (byKey.get(node.key) === node) byKey.delete(node.key);
    const i = seq.indexOf(node);
    if (i >= 0) seq.splice(i, 1);
  };

  /** The node of `token`'s key, created when missing or of another kind (a different kind is dropped first). */
  const nodeFor = (token: Token, digit: number, collapsed: boolean): { node: OwnedNode; created: boolean } => {
    let node = byKey.get(token.key);
    if (node && node.kind !== token.kind) {
      drop(node);
      node = undefined;
    }
    return node ? { node, created: false } : { node: create(token, digit, collapsed), created: true };
  };

  /** The node right after the owned block (null = end of the host). */
  const endAnchor = (): Node | null => {
    for (let i = seq.length - 1; i >= 0; i--) {
      const el = seq[i].el;
      if (el.parentNode !== host) continue;
      let ref = el.nextSibling;
      while (ref && owned.has(ref)) ref = ref.nextSibling;
      return ref;
    }
    return null;
  };

  /** Puts `order` in the DOM as one contiguous block, moving a node only when its nextSibling differs. */
  const reorder = (order: OwnedNode[], end: Node | null): void => {
    let ref = end;
    for (let i = order.length - 1; i >= 0; i--) {
      const el = order[i].el;
      if (el.parentNode !== host || el.nextSibling !== ref) host.insertBefore(el, ref);
      ref = el;
    }
    seq = order;
  };

  // ── writes ────────────────────────────────────────────────────────────

  const writeDigit = (node: ColumnNode, d: number): void => {
    const s = String(d);
    if (s === node.digit) return;
    node.digit = s;
    node.el.setAttribute('data-digit', s);
  };

  const writeTransform = (node: ColumnNode, pos: number): void => {
    node.pos = pos;
    const t = 'translateY(' + (-10 * pos).toFixed(3) + '%)';
    if (t === node.transform) return;
    node.transform = t;
    node.scale.style.setProperty('transform', t);
  };

  const writeGlyphs = (node: ColumnNode): void => {
    if (sameGlyphs(node.glyphs, glyphs)) return;
    node.glyphs = glyphs;
    let i = 0;
    for (let cell = node.scale.firstChild; cell; cell = cell.nextSibling) cell.textContent = glyph(i++);
    if (glyphs) node.scale.setAttribute('data-rn-zero', glyphs[0]);
    else node.scale.removeAttribute('data-rn-zero');
  };

  const writeLead = (node: ColumnNode, lead: boolean): void => {
    if (lead === node.lead) return;
    node.lead = lead;
    if (lead) node.el.setAttribute('data-rn-lead', '');
    else node.el.removeAttribute('data-rn-lead');
  };

  /** Back to full presence: no `data-rn-in`, no `--rn-in`/`--rn-w`, no empty `style`. */
  const clearIn = (node: OwnedNode): void => {
    node.inn = 1;
    if (!node.collapsed && node.innText === '' && node.wText === '') return;
    node.collapsed = false;
    node.innText = '';
    node.wText = '';
    node.el.removeAttribute('data-rn-in');
    removeStyle(node.el, '--rn-in', '--rn-w');
  };

  /** Writes presence `v` (clamped): collapsed state, `--rn-in` and, once measured, `--rn-w`. */
  const setIn = (node: OwnedNode, v: number, w: number | null): void => {
    v = clamp01(v);
    node.inn = v;
    if (v >= 1) {
      clearIn(node);
      return;
    }
    const el = node.el;
    if (!node.collapsed) {
      node.collapsed = true;
      el.setAttribute('data-rn-in', '');
    }
    if (w !== null) {
      const wText = pxText(w);
      if (wText !== node.wText) {
        node.wText = wText;
        el.style.setProperty('--rn-w', wText);
      }
    }
    const innText = v.toFixed(4);
    if (innText !== node.innText) {
      node.innText = innText;
      el.style.setProperty('--rn-in', innText);
    }
  };

  // ── channels ──────────────────────────────────────────────────────────

  /** Presence of a node without a channel: from its value at begin toward its end presence. */
  const lerpPresence = (node: OwnedNode, q: number): number => {
    const end = node.presence === 'leave' || node.presence === 'absent' ? 0 : 1;
    return node.inn0 + (end - node.inn0) * q;
  };

  const staticPresence = (node: StaticNode, fs: FrameState, q: number, signInn: number): number => {
    if (node.role === 'overflow') return fs.ovf;
    const tie = node.tie;
    if (tie) {
      if (tie.kind === 'place') return tie.place < fs.inn.length ? fs.inn[tie.place] : lerpPresence(node, q);
      if (tie.kind === 'sign') return signInn;
      return fs.ovf;
    }
    return lerpPresence(node, q);
  };

  /** True when the node's presence can change during the current motion (it needs a width). */
  const mayCollapse = (node: SignNode | StaticNode): boolean =>
    node.collapsed || node.presence !== 'both' || node.tie !== null || node.kind === 'sign' || node.role === 'overflow';

  /** Screen width of a Range over `el`'s text (includes ancestor transforms and zoom). */
  const rangeWidth = (el: Element): number | null => {
    const range = typeof doc.createRange === 'function' ? doc.createRange() : null;
    if (!range || typeof range.getBoundingClientRect !== 'function') return null;
    range.selectNodeContents(el);
    const w = range.getBoundingClientRect().width;
    return Number.isFinite(w) ? w : null;
  };

  const signNode = (): SignNode | undefined => {
    const sign = byKey.get('sign');
    return sign && sign.kind === 'sign' ? sign : undefined;
  };

  // ── Renderer ──────────────────────────────────────────────────────────

  const rest = (r: RestState): void => {
    if (destroyed) return;
    adopt();
    glyphs = r.glyphs;
    moving = unmeasured = false;
    signMode = 'sigma';
    signNegText = null;
    signPosText = null;

    const layout: NumberLayout = r.layout;
    const digits = magnitudeDigits(r.A);
    const order: OwnedNode[] = [];
    const keep = new Set<string>();
    for (const token of layout.tokens) {
      order.push(nodeFor(token, token.kind === 'digit' ? digitAt(digits, token.place) : 0, false).node);
      keep.add(token.key);
    }
    const end = endAnchor();
    for (const node of seq.slice()) if (!keep.has(node.key)) drop(node);
    reorder(order, end);

    let ti = 0;
    for (const node of order) {
      const token = layout.tokens[ti++];
      node.presence = 'both';
      node.tie = null;
      clearIn(node);
      if (node.kind === 'digit') {
        if (token.kind === 'digit') node.place = token.place;
        const d = digitAt(digits, node.place);
        writeDigit(node, d);
        writeGlyphs(node);
        const sizerText = glyph(d);
        if (sizerText !== node.sizerText) {
          node.sizer.textContent = sizerText;
          node.sizerText = sizerText;
        }
        if (node.transform !== null) {
          node.transform = null;
          removeStyle(node.scale, 'transform');
        }
        writeLead(node, false);
        node.pos = d;
        node.reel = false;
      } else if (token.kind !== 'digit') {
        if (token.text !== node.text) {
          node.el.textContent = token.text;
          node.text = token.text;
        }
        if (node.kind === 'sign') node.negative = r.A < 0;
        else if (token.kind === 'static' && token.role !== node.role) {
          node.role = token.role;
          node.el.setAttribute('data-rn-part', token.role);
        }
      }
    }
  };

  return {
    kind: 'columns',

    mount(r: RestState, adoptFallback: boolean): void {
      if (destroyed) return;
      if (!mounted) {
        mounted = true;
        adoptWanted = adoptFallback;
        adopt();
        const MO = doc.defaultView?.MutationObserver;
        if (adoptWanted && !adopted && doc.readyState === 'loading' && MO) {
          watcher = new MO(() => {
            adopt();
            if (doc.readyState !== 'loading') unwatch();
          });
          watcher.observe(host, { childList: true });
        }
      }
      rest(r);
    },

    setFormatter(f: Formatter): void {
      if (destroyed) return;
      glyphs = f.glyphs;
    },

    canAnimate: () => true,

    begin(motion: MotionLayout, kind: 'count' | 'roll', target: RestState): void {
      if (destroyed) return;
      adopt();
      glyphs = target.glyphs;
      const roll = kind === 'roll';
      const prevSign = signNode();
      const startPositiveSign = !!prevSign && !prevSign.negative;

      // Pin what is on screen before any data-digit changes (H4): the inline
      // transform overrides the data-digit rule from here until rest().
      for (const node of seq) {
        if (node.kind === 'digit' && node.transform === null) writeTransform(node, node.pos);
        node.inn0 = node.inn;
      }

      const targetDigits = magnitudeDigits(target.A);
      const inMotion = new Set<string>();
      const motionNodes: OwnedNode[] = [];
      for (const mt of motion.tokens) {
        const token = mt.token;
        const { node, created } = nodeFor(token, token.kind === 'digit' && roll ? digitAt(targetDigits, token.place) : 0, true);
        if (node.kind === 'digit') {
          if (created) {
            writeTransform(node, 0);
            writeLead(node, true);
          } else if (token.kind === 'digit') {
            node.place = token.place;
          }
        }
        node.presence = mt.presence;
        node.tie = mt.tie;
        inMotion.add(token.key);
        motionNodes.push(node);
      }

      // Owned nodes missing from the motion layout stay keyed and fade as leaving
      // (only rest() removes them); they keep their place next to their neighbors.
      const before: OwnedNode[] = [];
      const after = new Map<string, OwnedNode[]>();
      let lastPresent: string | null = null;
      for (const node of seq) {
        if (inMotion.has(node.key)) {
          lastPresent = node.key;
          continue;
        }
        node.presence = 'absent';
        node.tie = null;
        if (lastPresent === null) before.push(node);
        else {
          const list = after.get(lastPresent);
          if (list) list.push(node);
          else after.set(lastPresent, [node]);
        }
      }
      const order: OwnedNode[] = before;
      for (const node of motionNodes) {
        order.push(node);
        const list = after.get(node.key);
        if (list) order.push(...list);
      }
      reorder(order, endAnchor());

      // Roll path: surviving (and entering) columns show the target digit
      // synchronously, as in 1.2 (S3). Count path: frame() writes round(pos).
      if (roll) {
        for (const node of motionNodes) {
          if (node.kind === 'digit' && node.presence !== 'leave') writeDigit(node, digitAt(targetDigits, node.place));
        }
      }

      // Sign: a negative-only sign follows sigma; a positive sign shown at an
      // endpoint (signDisplay 'always'/'exceptZero') fades by presence and its
      // text swaps at A = 0.
      let targetSign: Token | null = null;
      for (const token of target.layout.tokens) if (token.kind === 'sign') targetSign = token;
      signMode = startPositiveSign || (targetSign !== null && target.A >= 0) ? 'lerp' : 'sigma';
      signNegText = null;
      signPosText = null;
      if (prevSign) {
        if (prevSign.negative) signNegText = prevSign.text;
        else signPosText = prevSign.text;
      }
      if (targetSign && targetSign.kind === 'sign') {
        if (target.A < 0) signNegText = targetSign.text;
        else signPosText = targetSign.text;
      }
      const sign = signNode();
      if (sign) sign.negative = signMode === 'sigma' || (signNegText !== null && sign.text === signNegText);

      motionKind = kind;
      moving = unmeasured = true;
    },

    // O(1) once the current motion is measured: callable in every read phase.
    measure(): void {
      if (destroyed || !unmeasured) return;
      // Every column has the same width (inline-grid: widest of sizer and cells),
      // so any column that is not collapsed is the reference for entering ones.
      // --rn-w is a layout width, while client rects (boxes and Ranges) include
      // ancestor transforms and zoom: the reference column gives the scale k
      // (screen px per layout px) that converts the Range widths.
      let w: number | null = null;
      let k = 1;
      let fallback: ColumnNode | null = null;
      for (const node of seq) {
        if (node.kind !== 'digit') continue;
        if (!node.collapsed) {
          // The computed width is the layout width; `auto` (no stylesheet) → NaN → the box.
          const box = node.el.getBoundingClientRect().width;
          const css = doc.defaultView ? parseFloat(doc.defaultView.getComputedStyle(node.el).width) : NaN;
          w = css >= 0 ? css : box;
          if (box > 0 && css > 0) k = box / css;
          break;
        }
        if (!fallback) fallback = node;
      }
      if (w === null) w = colW ?? (fallback ? rangeWidth(fallback.sizer) : null);
      // A host without a box (display: none) measures 0: keep the motion
      // unmeasured, so the next read phase measures it again.
      if (w === 0) return;
      colW = w;
      unmeasured = false;

      for (const node of seq) {
        if (node.kind === 'digit' || !mayCollapse(node)) continue;
        // A collapsed box measures 0: use a Range over its text, which keeps the
        // glyph width (§14.2). A leaving node measures its own box first.
        const screen = node.collapsed ? rangeWidth(node.el) : node.el.getBoundingClientRect().width;
        node.w = screen === null ? null : screen / k;
      }
    },

    frame(fs: FrameState): void {
      if (destroyed || !moving) return;
      const q = clamp01(fs.q);
      const count = motionKind === 'count';
      let signInn = signMode === 'sigma' ? clamp01(fs.sigma) : 1;

      // The sign first: tokens tied to it follow its presence.
      const sign = signNode();
      if (sign) {
        if (sign.presence === 'absent') signInn = sign.inn0 * (1 - q);
        else if (signMode === 'lerp') {
          signInn = lerpPresence(sign, q);
          const text = fs.A < 0 ? signNegText : fs.A > 0 ? signPosText : null;
          if (text !== null) {
            if (text !== sign.text) {
              sign.el.textContent = text;
              sign.text = text;
            }
            sign.negative = fs.A < 0;
          }
        }
        setIn(sign, signInn, sign.w);
      }

      const n = fs.pos.length;
      for (const node of seq) {
        if (node.kind === 'sign') continue;
        if (node.presence === 'absent') {
          setIn(node, node.inn0 * (1 - q), node.kind === 'digit' ? colW : node.w);
          continue;
        }
        if (node.kind === 'digit') {
          const k = node.place;
          if (k >= n) {
            setIn(node, lerpPresence(node, q), colW);
            continue;
          }
          const pos = mod10(fs.pos[k]);
          writeTransform(node, pos);
          if (count) writeDigit(node, Math.round(pos) % 10);
          writeLead(node, fs.lead[k] === 1);
          node.reel = fs.reel[k] === 1;
          setIn(node, fs.inn[k], colW);
          continue;
        }
        setIn(node, staticPresence(node, fs, q, signInn), node.w);
      }
    },

    rest,

    displayed(): DisplayState | null {
      if (destroyed) return null;
      let n = 0;
      for (const node of seq) if (node.kind === 'digit' && node.place + 1 > n) n = node.place + 1;
      const pos: number[] = new Array<number>(n).fill(0);
      const inn: number[] = new Array<number>(n).fill(0);
      const reel: boolean[] = new Array<boolean>(n).fill(false);
      let sigma: number | null = null;
      let ovf: number | null = null;
      // Without a sign / overflow node (e.g. accounting parentheses), the tokens
      // tied to that channel carry it.
      let tiedSigma = 0;
      let tiedOvf = 0;
      for (const node of seq) {
        if (node.kind === 'digit') {
          pos[node.place] = node.pos;
          inn[node.place] = node.inn;
          reel[node.place] = node.reel;
        } else if (node.kind === 'sign') {
          sigma = node.negative ? node.inn : 0;
        } else if (node.role === 'overflow') {
          ovf = node.inn;
        } else if (node.tie && node.presence !== 'absent') {
          if (node.tie.kind === 'sign') tiedSigma = Math.max(tiedSigma, node.inn);
          else if (node.tie.kind === 'overflow') tiedOvf = Math.max(tiedOvf, node.inn);
        }
      }
      return { pos, inn, sigma: sigma ?? tiedSigma, ovf: ovf ?? tiedOvf, reel };
    },

    probe(): Element | null {
      if (destroyed) return null;
      for (const node of seq) if (node.kind === 'digit') return node.sizer;
      return null;
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      moving = false;
      unwatch();
      for (const node of seq) node.el.remove();
      seq = [];
      byKey.clear();
      owned.clear();
      const fallback = adopted;
      adopted = null;
      if (fallback && !adoptedWasHidden) fallback.removeAttribute('hidden');
    }
  };
}
