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

/**
 * Creates the columns renderer for `host` (docs/design/v1.3.md §4).
 *
 * @param host - the element the counter renders into; its other children are never touched.
 * @param doc - the host's owner document (every node is created from it).
 * @param fmt - the current formatter (its glyphs seed new cells until the first `RestState`).
 */
export function createColumnsRenderer(host: Element, doc: Document, fmt: Formatter): Renderer {
  return new ColumnsRenderer(host, doc, fmt);
}

class ColumnsRenderer implements Renderer {
  readonly kind = 'columns' as const;

  private readonly host: Element;
  private readonly doc: Document;
  private glyphs: readonly string[] | null;
  /** owned nodes in DOM order */
  private seq: OwnedNode[] = [];
  private readonly byKey = new Map<string, OwnedNode>();
  private readonly owned = new Set<Node>();
  private mounted = false;
  private destroyed = false;

  /** adopted SSR fallback and whether it already had `hidden` */
  private adopted: Element | null = null;
  private adoptedWasHidden = false;

  /** motion state (between begin() and rest()) */
  private moving = false;
  private motionKind: 'count' | 'roll' = 'count';
  /** reference column width in px (read phase) */
  private colW: number | null = null;
  /** sign interpolation: `sigma` (negative-only sign) or `lerp` (a positive sign is shown at an endpoint) */
  private signMode: 'sigma' | 'lerp' = 'sigma';
  private signNegText: string | null = null;
  private signPosText: string | null = null;

  constructor(host: Element, doc: Document, fmt: Formatter) {
    this.host = host;
    this.doc = doc;
    this.glyphs = fmt.glyphs;
  }

  // ── Renderer ──────────────────────────────────────────────────────────

  mount(rest: RestState, adopt: boolean): void {
    if (this.destroyed) return;
    if (!this.mounted) {
      this.mounted = true;
      if (adopt) this.adopt();
    }
    this.rest(rest);
  }

  setFormatter(fmt: Formatter): void {
    if (this.destroyed) return;
    this.glyphs = fmt.glyphs;
  }

  canAnimate(): boolean {
    return true;
  }

  begin(motion: MotionLayout, kind: 'count' | 'roll', target: RestState): void {
    if (this.destroyed) return;
    this.glyphs = target.glyphs;
    const roll = kind === 'roll';
    const prevSign = this.byKey.get('sign');
    const startPositiveSign = prevSign !== undefined && prevSign.kind === 'sign' && !prevSign.negative;

    // Pin what is on screen before any data-digit changes (H4): the inline
    // transform overrides the data-digit rule from here until rest().
    for (const node of this.seq) {
      if (node.kind === 'digit' && node.transform === null) this.writeTransform(node, node.pos);
      node.inn0 = node.inn;
    }

    const targetDigits = magnitudeDigits(target.A);
    const inMotion = new Set<string>();
    const motionNodes: OwnedNode[] = [];
    for (const mt of motion.tokens) {
      const token = mt.token;
      let node = this.byKey.get(token.key);
      if (node && node.kind !== token.kind) {
        this.drop(node);
        node = undefined;
      }
      if (!node) {
        const digit = token.kind === 'digit' && roll ? digitAt(targetDigits, token.place) : 0;
        node = this.create(token, digit, true);
        if (node.kind === 'digit') {
          this.writeTransform(node, 0);
          node.lead = true;
          node.el.setAttribute('data-rn-lead', '');
        }
      } else if (node.kind === 'digit' && token.kind === 'digit') {
        node.place = token.place;
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
    for (const node of this.seq) {
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
      if (list) for (const n of list) order.push(n);
    }
    this.reorder(order);

    // Roll path: surviving (and entering) columns show the target digit
    // synchronously, as in 1.2 (S3). Count path: frame() writes round(pos).
    if (roll) {
      for (const node of motionNodes) {
        if (node.kind === 'digit' && node.presence !== 'leave') this.writeDigit(node, digitAt(targetDigits, node.place));
      }
    }

    // Sign: a negative-only sign follows sigma; a positive sign shown at an
    // endpoint (signDisplay 'always'/'exceptZero') fades by presence and its
    // text swaps at A = 0.
    let targetSign: Token | null = null;
    for (const token of target.layout.tokens) if (token.kind === 'sign') targetSign = token;
    const endPositiveSign = targetSign !== null && target.A >= 0;
    this.signMode = startPositiveSign || endPositiveSign ? 'lerp' : 'sigma';
    this.signNegText = null;
    this.signPosText = null;
    if (prevSign && prevSign.kind === 'sign') {
      if (prevSign.negative) this.signNegText = prevSign.text;
      else this.signPosText = prevSign.text;
    }
    if (targetSign && targetSign.kind === 'sign') {
      if (target.A < 0) this.signNegText = targetSign.text;
      else this.signPosText = targetSign.text;
    }
    const sign = this.byKey.get('sign');
    if (sign && sign.kind === 'sign') {
      sign.negative = this.signMode === 'sigma' || (this.signNegText !== null && sign.text === this.signNegText);
    }

    this.motionKind = kind;
    this.moving = true;
  }

  measure(): void {
    if (this.destroyed) return;
    // Every column has the same width (inline-grid: widest of sizer and cells),
    // so any column that is not collapsed is the reference for entering ones.
    let colW: number | null = null;
    let fallback: ColumnNode | null = null;
    for (const node of this.seq) {
      if (node.kind !== 'digit') continue;
      if (!node.collapsed) {
        colW = node.el.getBoundingClientRect().width;
        break;
      }
      if (!fallback) fallback = node;
    }
    if (colW === null) colW = this.colW ?? (fallback ? this.rangeWidth(fallback.sizer) : null);
    this.colW = colW;

    for (const node of this.seq) {
      if (node.kind === 'digit' || !this.mayCollapse(node)) continue;
      // A collapsed box measures 0: use a Range over its text, which keeps the
      // glyph width (§14.2). A leaving node measures its own box first.
      node.w = node.collapsed ? this.rangeWidth(node.el) : node.el.getBoundingClientRect().width;
    }
  }

  frame(fs: FrameState): void {
    if (this.destroyed || !this.moving) return;
    const q = clamp01(fs.q);
    const count = this.motionKind === 'count';
    let signInn = this.signMode === 'sigma' ? clamp01(fs.sigma) : 1;

    // The sign first: tokens tied to it follow its presence.
    const sign = this.byKey.get('sign');
    if (sign && sign.kind === 'sign') {
      if (sign.presence === 'absent') signInn = sign.inn0 * (1 - q);
      else if (this.signMode === 'lerp') {
        signInn = this.lerpPresence(sign, q);
        const text = fs.A < 0 ? this.signNegText : fs.A > 0 ? this.signPosText : null;
        if (text !== null && text !== sign.text) {
          sign.el.textContent = text;
          sign.text = text;
        }
        if (text !== null) sign.negative = fs.A < 0;
      }
      this.setIn(sign, signInn, sign.w);
    }

    const n = fs.pos.length;
    for (const node of this.seq) {
      if (node.kind === 'sign') continue;
      if (node.presence === 'absent') {
        this.setIn(node, node.inn0 * (1 - q), node.kind === 'digit' ? this.colW : node.w);
        continue;
      }
      if (node.kind === 'digit') {
        const k = node.place;
        if (k >= n) {
          this.setIn(node, this.lerpPresence(node, q), this.colW);
          continue;
        }
        const pos = mod10(fs.pos[k]);
        this.writeTransform(node, pos);
        if (count) this.writeDigit(node, Math.round(pos) % 10);
        const lead = fs.lead[k] === 1;
        if (lead !== node.lead) {
          node.lead = lead;
          if (lead) node.el.setAttribute('data-rn-lead', '');
          else node.el.removeAttribute('data-rn-lead');
        }
        node.reel = fs.reel[k] === 1;
        this.setIn(node, fs.inn[k], this.colW);
        continue;
      }
      this.setIn(node, this.staticPresence(node, fs, q, signInn), node.w);
    }
  }

  rest(rest: RestState): void {
    if (this.destroyed) return;
    this.glyphs = rest.glyphs;
    this.moving = false;
    this.signMode = 'sigma';
    this.signNegText = null;
    this.signPosText = null;

    const layout: NumberLayout = rest.layout;
    const digits = magnitudeDigits(rest.A);
    const order: OwnedNode[] = [];
    const keep = new Set<string>();
    for (const token of layout.tokens) {
      let node = this.byKey.get(token.key);
      if (node && node.kind !== token.kind) {
        this.drop(node);
        node = undefined;
      }
      if (!node) node = this.create(token, token.kind === 'digit' ? digitAt(digits, token.place) : 0, false);
      keep.add(token.key);
      order.push(node);
    }
    const end = this.endAnchor();
    for (const node of this.seq.slice()) if (!keep.has(node.key)) this.drop(node);
    this.reorder(order, end);

    let ti = 0;
    for (const node of order) {
      const token = layout.tokens[ti++];
      node.presence = 'both';
      node.tie = null;
      this.clearIn(node);
      if (node.kind === 'digit') {
        if (token.kind === 'digit') node.place = token.place;
        const d = digitAt(digits, node.place);
        this.writeDigit(node, d);
        this.writeGlyphs(node);
        const sizerText = this.glyph(d);
        if (sizerText !== node.sizerText) {
          node.sizer.textContent = sizerText;
          node.sizerText = sizerText;
        }
        if (node.transform !== null) {
          node.transform = null;
          removeStyle(node.scale, 'transform');
        }
        if (node.lead) {
          node.lead = false;
          node.el.removeAttribute('data-rn-lead');
        }
        node.pos = d;
        node.reel = false;
      } else if (token.kind !== 'digit') {
        if (token.text !== node.text) {
          node.el.textContent = token.text;
          node.text = token.text;
        }
        if (node.kind === 'sign') node.negative = rest.A < 0;
        else if (token.kind === 'static' && token.role !== node.role) {
          node.role = token.role;
          node.el.setAttribute('data-rn-part', token.role);
        }
      }
    }
  }

  displayed(): DisplayState | null {
    if (this.destroyed) return null;
    let n = 0;
    for (const node of this.seq) if (node.kind === 'digit' && node.place + 1 > n) n = node.place + 1;
    const pos: number[] = new Array<number>(n).fill(0);
    const inn: number[] = new Array<number>(n).fill(0);
    const reel: boolean[] = new Array<boolean>(n).fill(false);
    let sigma: number | null = null;
    let ovf: number | null = null;
    // Without a sign / overflow node (e.g. accounting parentheses), the tokens
    // tied to that channel carry it.
    let tiedSigma = 0;
    let tiedOvf = 0;
    for (const node of this.seq) {
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
  }

  probe(): Element | null {
    if (this.destroyed) return null;
    for (const node of this.seq) if (node.kind === 'digit') return node.sizer;
    return null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.moving = false;
    for (const node of this.seq) node.el.remove();
    this.seq = [];
    this.byKey.clear();
    this.owned.clear();
    const fallback = this.adopted;
    this.adopted = null;
    if (fallback && !this.adoptedWasHidden) fallback.removeAttribute('hidden');
  }

  // ── nodes ─────────────────────────────────────────────────────────────

  /** Hides a direct `[data-rn-ssr]` child (restored on destroy). */
  private adopt(): void {
    let child: Node | null = this.host.firstChild;
    while (child) {
      if (child.nodeType === 1 && (child as Element).hasAttribute('data-rn-ssr')) {
        const el = child as Element;
        this.adopted = el;
        this.adoptedWasHidden = el.hasAttribute('hidden');
        if (!this.adoptedWasHidden) el.setAttribute('hidden', '');
        return;
      }
      child = child.nextSibling;
    }
  }

  private glyph(d: number): string {
    const g = this.glyphs;
    return g ? g[d] : String(d);
  }

  private create(token: Token, digit: number, collapsed: boolean): OwnedNode {
    const doc = this.doc;
    let node: OwnedNode;
    if (token.kind === 'digit') {
      const el = doc.createElement('span');
      el.className = 'rn-col';
      const d = String(digit);
      el.setAttribute('data-digit', d);
      el.setAttribute('data-rn-key', token.key);
      const sizer = doc.createElement('span');
      sizer.className = 'rn-sizer';
      sizer.setAttribute('aria-hidden', 'true');
      const sizerText = this.glyph(digit);
      sizer.textContent = sizerText;
      const scale = doc.createElement('span');
      scale.className = 'rn-scale';
      scale.setAttribute('aria-hidden', 'true');
      if (this.glyphs) scale.setAttribute('data-rn-zero', this.glyphs[0]);
      for (let i = 0; i <= 9; i++) {
        const cell = doc.createElement('span');
        cell.className = 'rn-cell';
        cell.textContent = this.glyph(i);
        scale.appendChild(cell);
      }
      el.appendChild(sizer);
      el.appendChild(scale);
      node = {
        kind: 'digit', key: token.key, el, place: token.place, sizer, scale, digit: d, sizerText,
        glyphs: this.glyphs, pos: digit, transform: null, lead: false, reel: false,
        presence: 'both', tie: null, inn: 1, inn0: 1, collapsed: false, innText: '', w: null, wText: ''
      };
    } else {
      const el = doc.createElement('span');
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
      node.el.setAttribute('data-rn-in', '');
      node.el.style.setProperty('--rn-in', '0');
    }
    this.byKey.set(token.key, node);
    this.owned.add(node.el);
    return node;
  }

  /** Removes an owned node from the DOM and from the maps. */
  private drop(node: OwnedNode): void {
    node.el.remove();
    this.owned.delete(node.el);
    if (this.byKey.get(node.key) === node) this.byKey.delete(node.key);
    const i = this.seq.indexOf(node);
    if (i >= 0) this.seq.splice(i, 1);
  }

  /** The node right after the owned block (null = end of the host). */
  private endAnchor(): Node | null {
    for (let i = this.seq.length - 1; i >= 0; i--) {
      const el = this.seq[i].el;
      if (el.parentNode !== this.host) continue;
      let ref = el.nextSibling;
      while (ref && this.owned.has(ref)) ref = ref.nextSibling;
      return ref;
    }
    return null;
  }

  /** Puts `order` in the DOM as one contiguous block, moving a node only when its nextSibling differs. */
  private reorder(order: OwnedNode[], end: Node | null = this.endAnchor()): void {
    const host = this.host;
    let ref = end;
    for (let i = order.length - 1; i >= 0; i--) {
      const el = order[i].el;
      if (el.parentNode !== host || el.nextSibling !== ref) host.insertBefore(el, ref);
      ref = el;
    }
    this.seq = order;
  }

  // ── writes ────────────────────────────────────────────────────────────

  private writeDigit(node: ColumnNode, d: number): void {
    const s = String(d);
    if (s === node.digit) return;
    node.digit = s;
    node.el.setAttribute('data-digit', s);
  }

  private writeTransform(node: ColumnNode, pos: number): void {
    node.pos = pos;
    const t = 'translateY(' + (-10 * pos).toFixed(3) + '%)';
    if (t === node.transform) return;
    node.transform = t;
    node.scale.style.setProperty('transform', t);
  }

  private writeGlyphs(node: ColumnNode): void {
    const glyphs = this.glyphs;
    if (sameGlyphs(node.glyphs, glyphs)) return;
    node.glyphs = glyphs;
    let i = 0;
    for (let cell = node.scale.firstChild; cell; cell = cell.nextSibling) cell.textContent = this.glyph(i++);
    if (glyphs) node.scale.setAttribute('data-rn-zero', glyphs[0]);
    else node.scale.removeAttribute('data-rn-zero');
  }

  /** Writes presence `v` (clamped): collapsed state, `--rn-in` and, once measured, `--rn-w`. */
  private setIn(node: OwnedNode, v: number, w: number | null): void {
    v = clamp01(v);
    node.inn = v;
    if (v >= 1) {
      this.clearIn(node);
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
  }

  /** Back to full presence: no `data-rn-in`, no `--rn-in`/`--rn-w`, no empty `style`. */
  private clearIn(node: OwnedNode): void {
    node.inn = 1;
    if (!node.collapsed && node.innText === '' && node.wText === '') return;
    node.collapsed = false;
    node.innText = '';
    node.wText = '';
    node.el.removeAttribute('data-rn-in');
    removeStyle(node.el, '--rn-in', '--rn-w');
  }

  // ── channels ──────────────────────────────────────────────────────────

  /** Presence of a node without a channel: from its value at begin toward its end presence. */
  private lerpPresence(node: OwnedNode, q: number): number {
    const end = node.presence === 'leave' || node.presence === 'absent' ? 0 : 1;
    return node.inn0 + (end - node.inn0) * q;
  }

  private staticPresence(node: StaticNode, fs: FrameState, q: number, signInn: number): number {
    if (node.role === 'overflow') return fs.ovf;
    const tie = node.tie;
    if (tie) {
      if (tie.kind === 'place') return tie.place < fs.inn.length ? fs.inn[tie.place] : this.lerpPresence(node, q);
      if (tie.kind === 'sign') return signInn;
      return fs.ovf;
    }
    return this.lerpPresence(node, q);
  }

  /** True when the node's presence can change during the current motion (it needs a width). */
  private mayCollapse(node: SignNode | StaticNode): boolean {
    return node.collapsed || node.presence !== 'both' || node.tie !== null || node.kind === 'sign' || node.role === 'overflow';
  }

  private rangeWidth(el: Element): number | null {
    const range = typeof this.doc.createRange === 'function' ? this.doc.createRange() : null;
    if (!range || typeof range.getBoundingClientRect !== 'function') return null;
    range.selectNodeContents(el);
    const w = range.getBoundingClientRect().width;
    return Number.isFinite(w) ? w : null;
  }
}

/** Removes inline properties and the `style` attribute once it is empty. */
function removeStyle(el: HTMLElement, ...props: string[]): void {
  const style = el.style;
  for (const p of props) style.removeProperty(p);
  if (style.length === 0 && el.hasAttribute('style')) el.removeAttribute('style');
}
