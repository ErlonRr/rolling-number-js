/**
 * Inter-module contracts of the v1.3 implementation (docs/design/v1.3.md §3.3).
 * Frozen: a change here is a change to the spec. Types only, internal (not
 * re-exported by any entry point).
 *
 * @internal
 * @module
 */
import type {
  RollingNumberEasing, RollingNumberFormat, RollingNumberLabelInfo, RollingNumberLive,
  RollingNumberMode, RollingNumberOptions, RollingNumberSetValueOptions, RollingNumberTrigger
} from '../types';

// ── options.ts ────────────────────────────────────────────────────────
/** Fully normalized options. `null` = "auto/unset" where the public API allows it. */
export interface NormalizedOptions {
  value: number; pad: number; max: number | null; interpolate: boolean;
  duration: number | null;                 // null = auto (count 400 / roll CSS)
  easing: RollingNumberEasing | null;      // null = auto
  decimals: number | null;                 // null = auto (currency digits or 0)
  locale: readonly string[] | null;
  format: RollingNumberFormat | null;
  prefixText: string; suffixText: string; overflowSuffix: string;
  mode: RollingNumberMode; from: number | null; trigger: RollingNumberTrigger;
  label: string | ((info: RollingNumberLabelInfo) => string) | null;
  live: RollingNumberLive; injectStyles: boolean;
}
export type OptionKey = keyof RollingNumberOptions;
// options.ts exports (all internal):
// RN_DEFAULTS_13: Readonly<NormalizedOptions>     (frozen; duration/easing/decimals/locale/format/label = null)
// OPTION_KEYS (§2.7);  OPTION_ATTRIBUTES: Readonly<Record<OptionKey, string>>   // prefixText → 'prefix-text', …; used by element.ts and ssr.ts
// resolveOptions(o: RollingNumberUpdate | null | undefined): NormalizedOptions   // constructor semantics; non-finite duration → null
// normalizeField<K extends OptionKey>(key: K, raw: unknown, current: NormalizedOptions): NormalizedOptions[K]   // update() semantics
// LAYOUT_KEYS = ['pad','max','decimals','locale','format','prefixText','suffixText','overflowSuffix','mode'] as const
// core.ts keeps exporting the 1.2 RN_DEFAULTS (5 fields, frozen) and normalizeOptions(o): RollingNumberOptions-shaped 5 fields
// (non-finite duration → 400) unchanged, as compatibility shims; no 1.3 code calls them.

// ── core.ts (internal accessor; stubbed by WP0, implemented by WP6) ──
// getResolved(core: RollingNumberCore): Readonly<NormalizedOptions> & { readonly f: number }
//   f = the formatter's resolved fraction digits. Used by element getters (duration ?? 400, decimals = f) and adapters.

// ── engine/easing.ts ──────────────────────────────────────────────────
export type EasingFn = (p: number) => number;
export interface Easing { fn: EasingFn; /** max |E'| sampled at 65 points */ peak: number; }
// exports: PRESETS: Record<RollingNumberEasingName, EasingFn>; cubicBezier(x1,y1,x2,y2): EasingFn;
// parseEasing(s: string): EasingFn | null   (keywords, presets, cubic-bezier(), linear(), steps(); else null)
// toEasing(e: RollingNumberEasing): Easing | null; hermite(s: number): EasingFn; slopeAt(E, p): number; peakSlope(E): number

// ── engine/odometer.ts ────────────────────────────────────────────────
/** Channels currently on screen. pos values are in [0, 10). Arrays are indexed by place k (0 = last displayed digit). */
export interface DisplayState {
  pos: ArrayLike<number>; inn: ArrayLike<number>; sigma: number; ovf: number;
  /** place k is currently a reel (count plans only) */ reel: ArrayLike<boolean>;
}
export interface PlanInput {
  kind: 'count' | 'roll';
  A0: number;            // signed display scalar at start (float allowed), last-digit units, UNclamped
  A1: number;            // signed target (integer), UNclamped
  Amax: number;          // max·10^f, Infinity when no max
  f: number; pad: number;
  D: number;             // ms, > 0
  E: Easing;
  display: DisplayState | null;   // null = at rest on A0 (restState is used)
  prevKind: 'count' | 'roll' | null;  // kind of the motion being replaced (retarget), null from rest
}
export interface Plan {
  readonly kind: 'count' | 'roll';
  readonly n: number;              // places involved = max(cols(A0), cols(A1), display.pos.length)
  readonly D: number; readonly E: Easing;
  readonly A0: number; readonly A1: number;   // clamped scalars actually animated
  readonly o0: 0 | 1; readonly o1: 0 | 1;     // overflow presence at the endpoints
  /* + opaque per-place constants (W, reel, anchors) */
}
export interface FrameState {
  q: number;                       // eased progress
  A: number;                       // signed clamped display scalar (last-digit units)
  pos: Float64Array;               // unbounded positions (renderer applies mod 10)
  inn: Float64Array;               // 0..1 presence per place
  lead: Uint8Array;                // 1 = place is a leading zero (hide cell 0 and the wrap cell)
  reel: Uint8Array;
  sigma: number;                   // 0..1 sign presence
  ovf: number;                     // 0..1 overflow-suffix presence
}
// exports: plan(input: PlanInput): Plan; sample(plan: Plan, p: number, out?: FrameState): FrameState;
// velocity(plan: Plan, p: number): number  (dA/dt, units/ms; 0 for roll);
// retargetCurve(prev: Plan, pPrev: number, Anow: number, A1: number, D: number): { E: Easing; D: number };
//   A1 is clamped inside (ΔA = cl(A1) − Anow, §5.6); |ΔA| < 1e−9 or v = 0 → s = 0
// count plans sample q = clamp(E(p), 0, 1) (overshooting easings never leave [A0, A1], §5.1); roll plans keep the raw E(p) for pos
// restState(A: number, Amax: number, f: number, pad: number, n: number): DisplayState; colCount(M, f, pad): number

// ── engine/timing.ts ──────────────────────────────────────────────────
export interface Timing { kind: 'count' | 'roll'; D: number; E: Easing; instant: boolean; }
export interface TimingProbe {
  /** computed animation-duration / animation-timing-function of the core's .rn-sizer, or the raw custom properties in text mode */
  durationCss: string; easingCss: string; fromCustomProperties: boolean;
}
// exports: resolveTiming(opts: Pick<NormalizedOptions,'duration'|'easing'|'interpolate'>, animate: boolean | RollingNumberSetValueOptions | undefined,
//                        probe: () => TimingProbe | null, reducedMotion: boolean, hasRaf: boolean): Timing
// parseCssTime(s: string): number | null;  DEFAULT_CSS_EASING = 'cubic-bezier(0.2, 1, 0.3, 1)'; DEFAULT_CSS_DURATION_MS = 500

// ── engine/ticker.ts ──────────────────────────────────────────────────
export interface Tickable {
  /** read phase: layout/style reads only */ read?(now: number): void;
  /** write phase: DOM writes only; return true when this motion just settled */ write(now: number): boolean;
  /** after the single style flush of the frame (only called when write returned true) */ settled?(): void;
  /** after every write and settle of the frame: events, promise resolution */ post?(): void;
}
// exports: schedule(view: Window, t: Tickable): void; cancel(view: Window, t: Tickable): void
// one rAF loop per Window; a Tickable stays scheduled until write() returns true or cancel()
// cancel() of the last Tickable calls view.cancelAnimationFrame on the pending frame (destroy/finish leave raf.pending() === 0);
// re-scheduling an already scheduled Tickable (retarget) neither cancels nor requests a new frame

// ── format.ts ─────────────────────────────────────────────────────────
export type TokenRole = 'prefix' | 'suffix' | 'overflow' | 'group' | 'decimal' | 'currency' | 'unit' | 'percent' | 'literal';
/**
 * `place` is always k: the index into FrameState / DisplayState arrays (0 = last displayed digit, §5.1).
 * key 'i{j}' (integer, j from the right, units = i0)  → place = j + f
 * key 'f{j}' (fraction, j from the left, tenths = f1) → place = f − j   (the last fraction digit has place 0)
 * Example f = 2: f2 → 0, f1 → 1, i0 → 2, i1 → 3.  `Tie.place` uses the same k.
 */
export type Token =
  | { kind: 'digit'; key: string; place: number }
  | { kind: 'sign'; key: 'sign'; text: string }
  | { kind: 'static'; key: string; role: TokenRole; text: string };
export interface NumberLayout { readonly key: string; readonly tokens: readonly Token[]; }
export type Tie = { kind: 'place'; place: number } | { kind: 'sign' } | { kind: 'overflow' } | null;
export interface MotionToken { token: Token; presence: 'both' | 'enter' | 'leave'; tie: Tie; }
export interface MotionLayout { readonly tokens: readonly MotionToken[]; }
/** `zero`: the value is 0 (layouts for 0 are built from 0 itself, so `signDisplay: 'exceptZero'` gets no sign token). */
export interface LayoutShape { intDigits: number; negative: boolean; overflow: boolean; zero: boolean; }
export interface Formatter {
  readonly key: string;                       // changes iff the output shape/format changes
  readonly plain: boolean;                    // no Intl (1.x path)
  readonly f: number;                         // fraction digits (resolved)
  readonly scale: 1 | 100;                    // percent → 100
  readonly glyphs: readonly string[] | null;  // 10 digit glyphs (code points), null = ASCII
  /** value → signed scaled integer A, always a finite safe integer (Intl path: parts of a `numberingSystem: 'latn'` twin formatter, §7.3; plain path sign·round(|v|·10^f)). −0 → 0. */
  quantize(value: number): number;
  maxA(max: number | null): number;            // floor(max·10^f) or Infinity
  shapeOf(A: number, Amax: number): LayoutShape;
  /** shape of what is on screen mid-motion (retarget `from`, §5.5): intDigits = (highest k with inn > 0) − f + 1 (min 1), negative = sigma > 0, overflow = ovf > 0, zero = false */
  shapeOfDisplay(d: DisplayState): LayoutShape;
  layout(shape: LayoutShape): NumberLayout;    // cached by shape
  motionLayout(from: LayoutShape, to: LayoutShape): MotionLayout;
  /** display text of a (clamped) A: prefix + format + overflow + suffix; formats A/10^f (never the raw value), so −0 never shows. */
  text(A: number, overflow: boolean): string;
  /** ASCII text for input[type=number]: "-1234.50". */
  numericText(A: number): string;
  /** default accessible text of the UNclamped target, formatted from quantize(value)/10^f; plain path without 1.3 options = String(toDisplayInteger(value)). */
  labelText(value: number): string;
}
// exports: createFormatter(o: NormalizedOptions): Formatter   (cached by key)
//          resolveLabel(o: NormalizedOptions, f: Formatter, value: number, overflow: boolean): string   // used by core, ssr.ts and Vue getSSRProps

// ── renderers ─────────────────────────────────────────────────────────
/** `text` = formatter.text(A, overflow) (label base, SSR, getText); `numericText` = formatter.numericText(A). */
export interface RestState { A: number; overflow: boolean; layout: NumberLayout; text: string; numericText: string; glyphs: readonly string[] | null; }
export interface Renderer {
  readonly kind: 'columns' | 'text';
  /** first render; `adopt` = hide a direct [data-rn-ssr] child (restored on destroy) */
  mount(rest: RestState, adopt: boolean): void;
  /** called on layout-option changes (after finish()), before the next rest() */
  setFormatter(fmt: Formatter): void;
  /** false when an animation must not run now: a focused form control in text mode (§6). Always true in columns mode. */
  canAnimate(): boolean;
  /**
   * synchronous, from setValue: create entering nodes collapsed, pin current positions inline (H4).
   * Owned nodes absent from `motion` are never removed here: they stay keyed, frame() fades them as leaving
   * (--rn-in = their value at begin × (1 − fs.q)), and only rest() removes them.
   */
  begin(motion: MotionLayout, kind: 'count' | 'roll', target: RestState): void;
  /** read phase (first frame of a motion and whenever begin() added nodes): measure --rn-w */
  measure(): void;
  /**
   * write phase. Text mode builds its own string from fs: overflow = fs.ovf >= 0.5;
   * input[type=number] → fmt.numericText(round(fs.A)), other hosts → fmt.text(round(fs.A), overflow).
   * Columns mode never formats text per frame.
   */
  frame(fs: FrameState): void;
  /** final exact DOM; removes inline styles, leaving nodes, lead/in markers. Text mode on a focused control defers the write to its guarded blur handler (§6). */
  rest(rest: RestState): void;
  /** channels on screen, for retargets; null for text */
  displayed(): DisplayState | null;
  /** probe for timing (columns: first .rn-sizer; text: null → custom properties) */
  probe(): Element | null;
  destroy(): void;
}
export type RendererFactory = (host: Element, doc: Document, fmt: Formatter) => Renderer;
// columns.ts exports createColumnsRenderer; text.ts exports createTextRenderer and resolveMode(host, mode): 'columns' | 'text' | 'unsupported'

// ── styles.ts / a11y.ts / visibility.ts ───────────────────────────────
// styles.ts: ensureStyles(host: Element, perInstance: boolean): void   // O(1) when already present
// a11y.ts:   retainAnnouncer(host: Element): () => void
//            announce(host: Element, text: string, politeness: 'polite' | 'assertive'): void
//              debounced 300 ms per host inside a11y.ts (the last text wins); the core calls it on every rn-end
// visibility.ts: observeVisibility(el: Element, cb: (visible: boolean) => void): { stop(): void; readonly visible: boolean | null }
//   shared IO per Document, threshold 0.25. `visible` is null until the first callback; null counts as NOT visible.
//   Without IntersectionObserver or defaultView, cb(true) is called synchronously and `visible` is true.

/** Re-exported so every module can import the per-call options type from one place. */
export type { RollingNumberSetValueOptions };
