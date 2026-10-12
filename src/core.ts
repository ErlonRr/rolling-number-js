import './rolling-number.css';
import type {
  RollingNumberEventDetail,
  RollingNumberOptions,
  RollingNumberSetValueOptions,
  RollingNumberSettled,
  RollingNumberUpdate
} from './types';
import type {
  Formatter, FrameState, NormalizedOptions, Plan, Renderer, RestState, Tickable, TimingProbe
} from './internal/contracts';
import {
  OPTION_KEYS,
  normalizeField,
  normalizeInterpolate,
  normalizeMax,
  normalizePad,
  normalizeValue,
  resolveOptions,
  toNumber
} from './options';
import { createFormatter, resolveLabel } from './format';
import { plan as makePlan, retargetCurve, sample } from './engine/odometer';
import { resolveTiming } from './engine/timing';
import { cancel, schedule } from './engine/ticker';
import { createColumnsRenderer } from './renderers/columns';
import { createTextRenderer, resolveMode } from './renderers/text';
import { ensureStyles } from './styles';
import { announce, retainAnnouncer } from './a11y';
import { observeVisibility } from './visibility';

export type { RollingNumberOptions, RollingNumberUpdate } from './types';

/**
 * Default values of the five 1.x options:
 * `{ value: 0, pad: 1, max: null, interpolate: true, duration: 400 }`.
 *
 * Compatibility shim kept with its 1.2 shape; 1.3 code uses the internal
 * `RN_DEFAULTS_13` (every option, `null` = auto).
 */
export const RN_DEFAULTS: Readonly<{
  value: number;
  pad: number;
  max: number | null;
  interpolate: boolean;
  duration: number;
}> = Object.freeze({ value: 0, pad: 1, max: null, interpolate: true, duration: 400 });

/** Root class of a columns host. */
const ROOT_CLASS = 'rn-rolling-number';
/** Legacy animating class (columns hosts). */
const ANIM_CLASS = 'rn-interpolating';
/** Animating attribute (`data-rn-state="animating"`). */
const STATE = 'data-rn-state';
/** Marker of server-rendered content (a fallback child, or a host rendered by `renderStaticHTML` / Vue `getSSRProps`). */
const SSR = 'data-rn-ssr';

/** Live core instance per host element (one core per host). */
const instances = new WeakMap<Element, RollingNumberCore>();

/** Hosts that already received the unsupported-host warning. */
const warnedHosts = new WeakSet<Element>();

/** Runs `fn` in a microtask (Promise fallback for old engines). */
const microtask: (fn: () => void) => void =
  typeof queueMicrotask === 'function' ? (fn) => queueMicrotask(fn) : (fn) => void Promise.resolve().then(fn);

/** Clamped display scalar `sgn(A)·min(|A|, Amax)` (§5.1). */
const clampA = (A: number, Amax: number): number => Math.sign(A) * Math.min(Math.abs(A), Amax);

/** Writes `value` to the attribute `name`, or removes it when `null`. */
function restoreAttr(el: Element, name: string, value: string | null): void {
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

/**
 * Normalizes the five 1.x options of a (possibly partial or loosely typed)
 * options object. Missing, undefined or null fields fall back to `RN_DEFAULTS`.
 *
 * - `value`: non-finite → 0, magnitude clamped to `Number.MAX_SAFE_INTEGER`.
 * - `pad`: non-finite or < 1 → 1, floored, clamped to 64.
 * - `max`: null, '', non-finite or negative → null, otherwise floored.
 * - `interpolate`: null/undefined → true, the string 'false' → false, otherwise Boolean.
 * - `duration`: non-finite → 400, negative → 0 (no interpolation).
 *
 * Compatibility shim kept with its 1.2 signature; the 1.3 options are not
 * part of its result.
 *
 * @param o Options to normalize; `null`/`undefined` yield the defaults.
 * @returns A new object with the five 1.x options set to valid values.
 *
 * @example
 * ```ts
 * normalizeOptions({ pad: '3' as unknown as number, max: -1 });
 * // → { value: 0, pad: 3, max: null, interpolate: true, duration: 400 }
 * ```
 */
export function normalizeOptions(o: RollingNumberOptions | undefined | null): {
  value: number;
  pad: number;
  max: number | null;
  interpolate: boolean;
  duration: number;
} {
  const src = (o ?? {}) as Record<string, unknown>;
  const duration = toNumber(src.duration);
  return {
    value: normalizeValue(src.value),
    pad: normalizePad(src.pad),
    max: normalizeMax(src.max),
    interpolate: normalizeInterpolate(src.interpolate, RN_DEFAULTS.interpolate),
    duration: Number.isFinite(duration) ? Math.max(0, duration) : RN_DEFAULTS.duration
  };
}

/**
 * Normalized options of a core plus `f`, the resolved fraction digits. Used by
 * the element getters and the adapters. Not part of the public package API.
 * @internal
 */
export function getResolved(core: RollingNumberCore): Readonly<NormalizedOptions> & { readonly f: number } {
  return Object.freeze({ ...core['opts'], value: core['value'], f: core['fmt'].f });
}

/** A promise waiting for a target to settle. */
interface Waiter {
  /** quantized target it waits for */
  A: number;
  value: number;
  resolve: (settled: RollingNumberSettled) => void;
}

/**
 * Framework-agnostic engine that renders an animated, odometer-style number
 * inside a host element. All framework adapters, the `rollingNumber()` action
 * and the `<rolling-number>` custom element are thin wrappers around it.
 *
 * Container hosts (`span`, `div`, badges, …) get digit columns: the core
 * appends its own nodes (`.rn-col` per digit, `.rn-sign`, `.rn-static`
 * affixes and separators) and leaves other children alone. It also sets
 * `role="img"`, an `aria-label` with the target value and the
 * `rn-rolling-number` class on the host. Text-like `<input>`, `<textarea>`,
 * `<option>` and SVG text get text mode (see {@link RollingNumberOptions.mode}).
 * While a motion runs the host carries `data-rn-state="animating"` (and the
 * legacy `rn-interpolating` class in columns mode).
 *
 * Every change dispatches `rn-start` and `rn-end` on the host
 * ({@link RollingNumberEventMap}); `setValue()` returns a promise that
 * resolves when the target settles.
 *
 * Only one core can drive a given host: constructing a second one on the same
 * element destroys the first. Call {@link RollingNumberCore.destroy} when the
 * host goes away.
 *
 * @example
 * ```ts
 * import { RollingNumberCore } from 'rolling-number';
 *
 * const el = document.querySelector<HTMLElement>('#counter')!;
 * const counter = new RollingNumberCore(el, { value: 0, pad: 3 });
 *
 * await counter.setValue(250);   // counts 0 → 250, resolves when settled
 * counter.setValue(10, false);   // rolls each digit straight to 10
 * counter.update({ max: 99, duration: 800 });
 * el.addEventListener('rn-end', (e) => console.log(e.detail.value));
 * counter.destroy();             // restores the host as it was
 * ```
 */
export class RollingNumberCore {
  // Fields are `declare`d and assigned in the constructor or later (unset = undefined):
  // initializers would compile to one defineProperty helper call each.
  private declare readonly host: HTMLElement | SVGElement;
  private declare readonly doc: Document;
  private declare readonly view: (Window & typeof globalThis) | null;
  private declare opts: NormalizedOptions;
  private declare fmt: Formatter;
  /** `max` in last-digit units (Infinity: no limit). */
  private declare Amax: number;
  private declare renderer?: Renderer;
  /** Resolved mode. */
  private declare res: 'columns' | 'text' | 'unsupported';

  /** Normalized target value. */
  private declare value: number;
  /** Quantized target. */
  private declare A1: number;
  /** Quantized value the renderer last rested on (unclamped). */
  private declare restA: number;
  /** Clamped display scalar on screen. */
  private declare shown: number;

  /** The renderer is between `begin()` and `rest()` (mid-motion, possibly paused). */
  private declare mid?: boolean;
  /** A motion is scheduled on the ticker. */
  private declare moving?: boolean;
  /** `trigger: 'visible'`: a change waits for the host to become visible. */
  private declare waiting?: boolean;
  private declare dead?: boolean;

  /** `animate` argument of the current change. */
  private declare call?: boolean | RollingNumberSetValueOptions;
  /** Kind of the current motion. */
  private declare kind?: 'count' | 'roll';
  /** Plan of the current motion (unset until its first read phase, and for a read-phase instant change). */
  private declare plan?: Plan;
  /** Plan replaced by a retarget and its progress, for the velocity carry (§5.6). */
  private declare prev?: { plan: Plan; p: number };
  /** The motion starts from the displayed channels (retarget, resume), not from rest. */
  private declare fromDisplay?: boolean;
  /** Start scalar of the current motion. */
  private declare A0: number;
  /** First frame timestamp and last progress. */
  private declare t0: number;
  private declare p: number;
  private declare fs?: FrameState;
  /** The motion settled in this frame's write phase. */
  private declare done?: boolean;
  /** Watchdog timer. */
  private declare dog?: number;

  /** Promises waiting for the current target. */
  private declare waiters: Waiter[];
  /** Display value when the current session started (unset: no session). */
  private declare from?: number;
  /** `rn-start` of the current session was dispatched. */
  private declare started?: boolean;
  /** Incremented by every change: stale microtasks compare it. */
  private declare epoch: number;

  /** Current accessible label, and the last one written to `aria-label`. */
  private declare label: string;
  private declare lastLabel?: string;
  /** Host state captured before initialization, restored by destroy(). */
  private declare prevRole: string | null;
  private declare prevLabel: string | null;
  private declare addedClass: boolean;

  /** Last visibility reported for `trigger: 'visible'` (unset: unknown). */
  private declare seen?: boolean;
  private declare vis?: { stop(): void };
  private declare release?: () => void;
  /** Shared-ticker hooks (§5.9). */
  private declare readonly tick: Tickable;

  /**
   * Attaches a rolling number to `container` and renders the initial value
   * synchronously. The initial render dispatches no event, except the
   * `from` → `value` intro.
   *
   * @param container Host element. Container elements (`<span>`, `<div>`, …)
   *   get digit columns; text-like `<input>`, `<textarea>`, `<option>` and SVG
   *   `<text>` get text mode. Other void/replaced elements (`<img>`, `<select>`,
   *   `<svg>`, `<input type="checkbox">`, …) cannot display the value and only
   *   trigger a console warning.
   * @param options Initial options; missing or `null` fields use the defaults
   *   (`value 0`, `pad 1`, `max null`, `interpolate true`, `duration` auto).
   * @throws {Error} When `container` is not an element.
   */
  constructor(container: HTMLElement | SVGElement, options: RollingNumberUpdate = {}) {
    const host = container as unknown as Partial<Element> | null | undefined;
    // Realm-safe check: works for elements coming from iframes or other windows.
    if (
      host === null ||
      typeof host !== 'object' ||
      host.nodeType !== 1 ||
      typeof host.setAttribute !== 'function'
    ) {
      throw new Error('[RollingNumber] Target container must be a valid HTMLElement.');
    }

    // A host can only be driven by one core: tear down the previous one first.
    instances.get(container)?.destroy();
    instances.set(container, this);
    this.waiters = [];
    this.epoch = 0;
    this.tick = {
      read: (now) => {
        const r = this.renderer;
        if (this.plan || !r) return;
        this.t0 = now;
        const t = resolveTiming(this.opts, this.call, () => this.probe(), false, true);
        // A CSS-derived duration of 0 (roll with `--rn-duration: 0s`): the write phase lands now (§5.8).
        if (t.instant) return;
        let { D, E } = t;
        const prev = this.prev;
        const call = this.call;
        // Count → count retarget: velocity-continuous curve, unless this call sets its own easing (§5.6).
        if (prev && prev.plan.kind === 'count' && t.kind === 'count' && !(typeof call === 'object' && call?.easing !== undefined)) {
          ({ D, E } = retargetCurve(prev.plan, prev.p, this.shown, this.A1, D));
        }
        this.plan = makePlan({
          kind: t.kind, A0: this.A0, A1: this.A1, Amax: this.Amax, f: this.fmt.f, pad: this.opts.pad, D, E,
          display: this.fromDisplay ? r.displayed() : null,
          prevKind: prev ? prev.plan.kind : null
        });
        this.arm(D);
        r.measure();
      },
      write: (now) => {
        const plan = this.plan;
        this.mark(true);
        const p = plan ? Math.max(0, (now - this.t0) / plan.D) : 1;
        if (!(p < 1)) {
          this.land();
          return (this.done = true);
        }
        const fs = (this.fs = sample(plan as Plan, (this.p = p), this.fs));
        (this.renderer as Renderer).frame(fs);
        this.shown = fs.A;
        return false;
      },
      settled: () => this.mark(false),
      post: () => {
        if (this.done) {
          this.done = false;
          this.end(!!this.plan);
        } else if (!this.started) {
          this.started = true;
          this.emit('rn-start', this.detail(true));
        }
      }
    };

    const o = (this.opts = resolveOptions(options));
    this.host = container;
    this.doc = container.ownerDocument;
    this.view = this.doc.defaultView as (Window & typeof globalThis) | null;
    this.fmt = createFormatter(o);
    this.Amax = this.fmt.maxA(o.max);
    this.value = o.value;

    // Server-rendered content: a host rendered by renderStaticHTML / getSSRProps, or a fallback child.
    const adopted = container.hasAttribute(SSR) || !!container.querySelector(':scope>[' + SSR + ']');
    this.setup();
    ensureStyles(container, o.injectStyles);
    if (o.live !== 'off') this.release = retainAnnouncer(container);
    if (o.trigger === 'visible') this.observe();

    const A1 = (this.A1 = this.fmt.quantize(this.value));
    this.writeLabel();
    // `from` intro (§8.3): skipped under reduced motion, and when visible server content was adopted.
    const fromA = o.from === null ? A1 : this.fmt.quantize(o.from);
    const intro =
      fromA !== A1 &&
      !this.reduced() &&
      !(adopted && this.res === 'columns' && (o.trigger !== 'visible' || this.seen === true));
    this.restA = intro ? fromA : A1;
    this.shown = clampA(this.restA, this.Amax);
    this.renderer?.mount(this.restOf(this.restA), true);
    if (intro) void this.change(undefined);
  }

  /**
   * Resolves the mode, warns once for hosts that cannot show columns, creates
   * the renderer and (columns mode) sets the host markers, remembering their
   * previous state so destroy() can restore it.
   */
  private setup(): void {
    const h = this.host;
    const res = (this.res = resolveMode(h, this.opts.mode));
    if (res !== 'text' && resolveMode(h, 'auto') !== 'columns' && !warnedHosts.has(h)) {
      warnedHosts.add(h);
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(
          `[RollingNumber] <${(h.localName || '').toLowerCase()}> is not a supported host in 1.x: the digit columns are ` +
            'inserted as child nodes, which this element does not render. Use a container ' +
            'element such as <span> or <div> instead.'
        );
      }
    }
    if (res === 'unsupported') return;
    this.renderer = (res === 'text' ? createTextRenderer : createColumnsRenderer)(h, this.doc, this.fmt);
    if (res === 'columns') {
      // Role and label of a server-rendered host are core-owned: removed (not restored) on destroy.
      const ssr = h.hasAttribute(SSR);
      this.prevRole = ssr ? null : h.getAttribute('role');
      this.prevLabel = ssr ? null : h.getAttribute('aria-label');
      this.addedClass = !h.classList.contains(ROOT_CLASS);
      h.removeAttribute(SSR);
      this.mark(false);
      h.setAttribute('role', 'img');
    }
  }

  /** Destroys the renderer and restores the host markers (inverse of setup()). */
  private teardown(): void {
    const h = this.host;
    this.renderer?.destroy();
    this.renderer = undefined;
    h.removeAttribute(STATE);
    if (this.res === 'columns') {
      h.classList.remove(ANIM_CLASS);
      restoreAttr(h, 'role', this.prevRole);
      restoreAttr(h, 'aria-label', this.prevLabel);
      if (this.addedClass) h.classList.remove(ROOT_CLASS);
      this.lastLabel = undefined;
    }
  }

  /**
   * Host markers: `data-rn-state="animating"` while moving; in columns mode
   * also the root class (re-added when a framework clobbered `className`) and
   * the legacy `rn-interpolating` class. Writes only what differs. `flush`
   * reads a computed style before the markers go away, so user or pinned-1.2
   * transitions never replay from the intermediate digits (the ticker flushes
   * once per frame itself).
   */
  private mark(on: boolean, flush?: boolean): void {
    const h = this.host;
    const list = h.classList;
    if (!this.renderer) return;
    if (!on && flush && h.hasAttribute(STATE)) void this.view?.getComputedStyle(h).opacity;
    if (this.res === 'columns') {
      if (!list.contains(ROOT_CLASS)) list.add(ROOT_CLASS);
      if (list.contains(ANIM_CLASS) !== on) list.toggle(ANIM_CLASS);
    }
    if (on && h.getAttribute(STATE) !== 'animating') h.setAttribute(STATE, 'animating');
    else if (!on && h.hasAttribute(STATE)) h.removeAttribute(STATE);
  }

  /** Recomputes the label and writes `aria-label` when it changed (columns mode only). */
  private writeLabel(): void {
    const label = (this.label = resolveLabel(this.opts, this.fmt, this.value, Math.abs(this.A1) > this.Amax));
    if (this.res === 'columns' && label !== this.lastLabel) this.host.setAttribute('aria-label', (this.lastLabel = label));
  }

  /** Rest state of the quantized value `A` (§3.3): the renderer gets the clamped scalar. */
  private restOf(A: number): RestState {
    const f = this.fmt;
    const Amax = this.Amax;
    const c = clampA(A, Amax);
    const overflow = Math.abs(A) > Amax;
    return {
      A: c, overflow, layout: f.layout(f.shapeOf(A, Amax)), text: f.text(c, overflow), numericText: f.numericText(c), glyphs: f.glyphs
    };
  }

  /** Whether the user asked the OS/browser to minimize non-essential motion. */
  private reduced(): boolean {
    try {
      return !!this.view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  /** Synchronous part of the timing (no CSS probe, §5.8). */
  private timing(animate: boolean | RollingNumberSetValueOptions | undefined) {
    const view = this.view;
    return resolveTiming(this.opts, animate, () => null, this.reduced(), !!view && typeof view.requestAnimationFrame === 'function');
  }

  /** CSS timing probe (read phase): the sizer's computed animation timing, or the host's raw custom properties in text mode. */
  private probe(): TimingProbe | null {
    const r = this.renderer;
    const view = this.view;
    if (!r || !view) return null;
    const el = r.probe();
    const cs = view.getComputedStyle(el || this.host);
    return el
      ? { durationCss: cs.animationDuration, easingCss: cs.animationTimingFunction, fromCustomProperties: false }
      : { durationCss: cs.getPropertyValue('--rn-duration'), easingCss: cs.getPropertyValue('--rn-easing'), fromCustomProperties: true };
  }

  /** Watchdog: finishes a motion whose frames never come (background tab, `display:none` iframe). */
  private arm(D: number): void {
    this.disarm();
    if (this.view) this.dog = this.view.setTimeout(() => this.finish(), D + 1000) as unknown as number;
  }

  private disarm(): void {
    this.view?.clearTimeout(this.dog);
    this.dog = undefined;
  }

  /** Stops the ticker and the watchdog. */
  private halt(): void {
    if (this.view) cancel(this.view, this.tick);
    this.disarm();
    this.moving = false;
  }

  /** Final DOM of the target. */
  private land(): void {
    this.renderer?.rest(this.restOf(this.A1));
    this.restA = this.A1;
    this.shown = clampA(this.A1, this.Amax);
    this.mid = this.moving = false;
    this.disarm();
  }

  /** Observes the host for `trigger: 'visible'`; a waiting change starts once it is visible. */
  private observe(): void {
    this.seen = undefined;
    // The no-IO fallback calls back before returning: the handle is not used in the callback.
    this.vis = observeVisibility(this.host, (visible) => {
      this.seen = visible;
      if (visible && this.waiting && !this.dead) this.go();
    });
  }

  /** A promise for `value` (at the current target) that resolves with the next settle (or supersede/destroy). */
  private wait(value: number): Promise<RollingNumberSettled> {
    return new Promise((resolve) => {
      this.waiters.push({ A: this.A1, value, resolve });
    });
  }

  /** Event detail of the current session. */
  private detail(animated: boolean): RollingNumberEventDetail {
    return { value: this.value, from: this.from ?? this.getDisplayValue(), animated };
  }

  /** Dispatches `rn-start` / `rn-end` on the host with the host realm's CustomEvent (bubbles, composed). */
  private emit(type: 'rn-start' | 'rn-end', detail: RollingNumberEventDetail): void {
    const Ctor = this.view?.CustomEvent ?? (typeof CustomEvent === 'function' ? CustomEvent : null);
    if (Ctor) this.host.dispatchEvent(new Ctor(type, { detail, bubbles: true, composed: true }));
  }

  /**
   * Ends the session: `rn-start` if it never fired, `rn-end`, then the
   * promises and the live announcement. State is committed before dispatch,
   * so handlers may call setValue().
   */
  private end(animated: boolean): void {
    const detail = this.detail(animated);
    const waiters = this.waiters;
    const start = !this.started;
    this.waiters = [];
    this.from = undefined;
    this.started = false;
    if (start) this.emit('rn-start', detail);
    this.emit('rn-end', { ...detail });
    for (const w of waiters) w.resolve({ value: w.value, completed: true });
    if (!this.dead && this.opts.live !== 'off') announce(this.host, this.label, this.opts.live);
  }

  /** Ends the session in a microtask (instant changes; never inside setValue()/update()). */
  private later(animated: boolean): void {
    const epoch = ++this.epoch;
    microtask(() => {
      if (!this.dead && epoch === this.epoch) this.end(animated);
    });
  }

  /** Jumps to the target (see finish()); `defer` dispatches the events in a microtask. */
  private jump(defer?: boolean): void {
    if (this.dead || !(this.moving || this.waiting)) return;
    const animated = !!this.started;
    this.halt();
    this.waiting = false;
    this.land();
    this.mark(false, true);
    if (defer) this.later(animated);
    else {
      this.epoch++;
      this.end(animated);
    }
  }

  /**
   * Starts the change to the current target (§8.2 steps 5–7): instant (final
   * DOM now, events in a microtask) or animated (begin, markers, ticker,
   * watchdog). A running motion is retargeted from the display.
   */
  private go(): void {
    const r = this.renderer;
    const t = this.timing(this.call);
    this.waiting = false;
    this.from ??= this.getDisplayValue();
    if (!r || t.instant || !r.canAnimate()) {
      this.halt();
      this.land();
      this.mark(false, true);
      this.later(false);
      return;
    }
    this.epoch++;
    const f = this.fmt;
    const Amax = this.Amax;
    const display = this.mid ? r.displayed() : null;
    this.prev = this.moving ? (this.plan ? { plan: this.plan, p: this.p } : this.prev) : undefined;
    this.fromDisplay = this.mid;
    this.A0 = this.mid ? this.shown : this.restA;
    r.begin(
      f.motionLayout(display ? f.shapeOfDisplay(display) : f.shapeOf(this.restA, Amax), f.shapeOf(this.A1, Amax)),
      t.kind,
      this.restOf(this.A1)
    );
    this.kind = t.kind;
    this.plan = undefined;
    this.done = false;
    this.mid = this.moving = true;
    this.mark(true);
    schedule(this.view as Window, this.tick);
    this.arm(t.D);
  }

  /**
   * Re-applies the host class and the animating markers, re-checks the style
   * injection and re-paints the value at rest. Writes nothing when nothing
   * changed.
   *
   * Setters already render when needed; call it yourself only to re-apply the
   * host class after a framework overwrote `className`. No-op after
   * {@link RollingNumberCore.destroy}.
   */
  public render(): void {
    const r = this.renderer;
    if (this.dead || !r) return;
    this.mark(!!this.moving, true);
    ensureStyles(this.host, this.opts.injectStyles);
    if (!this.mid) r.rest(this.restOf(this.restA));
  }

  /**
   * Sets the target and resolves when it settles. Loose input is normalized
   * (non-finite → 0); `aria-label` switches to the new target immediately.
   * Every change is instant when the user prefers reduced motion.
   *
   * A call during a running motion retargets it from the value on screen.
   * Setting the target already in flight with no explicit motion change
   * joins that motion (same promise outcome, no events); an explicit instant
   * request (`motion: 'none'`, `duration: 0`) finishes it, and an explicit
   * kind/duration/easing change re-plans it.
   *
   * @param value New target value (see {@link RollingNumberOptions.value}).
   * @param animate `true`: count through the intermediate values; `false`:
   *   roll each digit straight to its new digit; or per-call options
   *   ({@link RollingNumberSetValueOptions}). Defaults to the `interpolate` option.
   * @returns Resolves `{ value, completed: true }` when the display settles on
   *   `value`, `{ completed: false }` when superseded by another target or
   *   destroyed. Never rejects.
   *
   * @example
   * ```ts
   * counter.setValue(1200);                          // animated if interpolate is true
   * counter.setValue(0, false);                      // rolls straight to 0
   * counter.setValue(5, { motion: 'none' });         // instant (DOM final now, events in a microtask)
   * const { completed } = await counter.setValue(42, { duration: 1200, easing: 'ease-out-expo' });
   * ```
   */
  public setValue(value: number, animate?: boolean | RollingNumberSetValueOptions): Promise<RollingNumberSettled> {
    const v = normalizeValue(value);
    this.value = v;
    if (this.dead) return Promise.resolve({ value: v, completed: false });

    const A1 = this.fmt.quantize(v);
    const same = A1 === this.A1;
    this.A1 = A1;
    this.writeLabel();

    if (this.moving || this.waiting) {
      if (same) {
        // Same target in flight (§8.2 step 2): join, finish or re-plan.
        if (animate === undefined) return this.wait(v);
        const t = this.timing(animate);
        if (t.instant || !this.renderer?.canAnimate()) {
          const p = this.wait(v);
          this.jump(true);
          return p;
        }
        const call = typeof animate === 'object' ? animate : null;
        if (t.kind === this.kind && !(call && (call.duration !== undefined || call.easing !== undefined))) return this.wait(v);
      }
    } else if (same) {
      return Promise.resolve({ value: v, completed: true });
    }
    return this.change(animate);
  }

  /** §8.2 steps 3–7 for the current target: supersede other promises, then wait for visibility or start. */
  private change(animate: boolean | RollingNumberSetValueOptions | undefined): Promise<RollingNumberSettled> {
    const A1 = this.A1;
    const stale = this.waiters.filter((w) => w.A !== A1);
    this.waiters = this.waiters.filter((w) => w.A === A1);
    for (const w of stale) w.resolve({ value: w.value, completed: false });
    const promise = this.wait(this.value);

    ensureStyles(this.host, this.opts.injectStyles);
    this.call = animate;
    if (this.opts.trigger === 'visible' && this.seen !== true) {
      // Waiting for visibility: the label is up to date, the display is frozen.
      if (this.moving) {
        this.halt();
        this.mark(false, true);
      }
      this.waiting = true;
    } else {
      this.go();
    }
    return promise;
  }

  /**
   * Resolves when the current motion settles (immediately when idle).
   *
   * @returns `{ value, completed }` as for {@link RollingNumberCore.setValue}.
   */
  public whenSettled(): Promise<RollingNumberSettled> {
    if (this.dead) return Promise.resolve({ value: this.value, completed: false });
    if (this.moving || this.waiting || this.waiters.length > 0) return this.wait(this.value);
    return Promise.resolve({ value: this.value, completed: true });
  }

  /**
   * Jumps to the target now: final DOM, `rn-end` (preceded by `rn-start` when
   * the motion had not started yet), pending promises resolve
   * `{ completed: true }`. No-op when idle.
   */
  public finish(): void {
    this.jump();
  }

  /**
   * Gets the current numeric target value (normalized, not rounded): during a
   * motion this is already the final value, not the one on screen
   * (see {@link RollingNumberCore.getDisplayValue}).
   *
   * @returns The target value.
   */
  public getValue(): number {
    return this.value;
  }

  /**
   * Value on screen: signed, in user units (percent: the fraction), clamped by
   * `max`, rounded to the displayed precision at rest and fractional mid-count.
   *
   * @returns The displayed value.
   */
  public getDisplayValue(): number {
    const f = this.fmt;
    return this.shown / 10 ** f.f / f.scale || 0;
  }

  /**
   * Displayed text of the target at rest: clamped by `max`, with
   * `overflowSuffix` and affixes, e.g. `"$1,234.50"`, `"99+"` (what text mode
   * shows). The unclamped text is in the default label.
   *
   * @returns The text of the target.
   */
  public getText(): string {
    return this.restOf(this.A1).text;
  }

  /**
   * Renderer in use after `mode: 'auto'` resolution (`'columns'` for hosts
   * that cannot display the value).
   *
   * @returns `'columns'` or `'text'`.
   */
  public getMode(): 'columns' | 'text' {
    return this.res === 'text' ? 'text' : 'columns';
  }

  /**
   * Returns the host element this instance renders into.
   *
   * @returns The `container` passed to the constructor (typed `HTMLElement`
   *   for 1.x compatibility; see {@link RollingNumberCore.getHost}).
   */
  public getElement(): HTMLElement {
    return this.host as HTMLElement;
  }

  /**
   * Returns the host as passed to the constructor (accurately typed).
   *
   * @returns The `container` passed to the constructor.
   */
  public getHost(): HTMLElement | SVGElement {
    return this.host;
  }

  /**
   * Whether a motion is running, counting or rolling (the host then carries
   * `data-rn-state="animating"`).
   *
   * @returns `true` from an animated `setValue()` until the motion settles.
   */
  public isAnimating(): boolean {
    return !!this.moving;
  }

  /**
   * Updates whether value changes count through the intermediate values
   * (`false`: digits roll straight to the new value). `null`/`undefined` →
   * `true` (the default), the string 'false' → false, other values use
   * `Boolean()`. Applies to the next {@link RollingNumberCore.setValue} call.
   *
   * @param interpolate See {@link RollingNumberOptions.interpolate}.
   */
  public setInterpolate(interpolate: boolean): void {
    this.apply({ interpolate: interpolate ?? null });
  }

  /**
   * Updates the animation duration in milliseconds. `null` resets it to
   * unset (auto); non-finite input keeps the current duration; negative
   * values become 0. Applies to the next {@link RollingNumberCore.setValue} call.
   *
   * @param duration Duration in ms (`0` disables counting), or `null` for auto.
   */
  public setDuration(duration: number | null): void {
    this.apply({ duration });
  }

  /**
   * Updates the minimum number of integer digits (leading zeros, 1..64) and
   * re-renders (a running motion finishes first).
   *
   * @param pad See {@link RollingNumberOptions.pad}.
   */
  public setPad(pad: number): void {
    this.apply({ pad: pad ?? null });
  }

  /**
   * Updates the maximum displayed magnitude. null, undefined, '', negative or
   * non-finite values remove the limit. A running motion finishes first.
   *
   * @param max Display clamp, or `null` for none (see {@link RollingNumberOptions.max}).
   */
  public setMax(max: number | null): void {
    this.apply({ max: max ?? null });
  }

  /**
   * Updates multiple options at once. Fields left `undefined` are unchanged;
   * `null` resets a field to its default. A layout change (`pad`, `max`,
   * `decimals`, `locale`, `format`, affixes, `mode`) finishes a running motion
   * (its `rn-end` follows in a microtask) and re-renders. Timing options apply
   * to the next motion; `label`, `live`, `trigger` and `injectStyles` apply
   * immediately. A changed `value` goes through {@link RollingNumberCore.setValue}
   * last (animated according to the new options). `from` is creation-only
   * and ignored here.
   *
   * @param options Partial options; each field is normalized like its setter.
   *
   * @example
   * ```ts
   * counter.update({ value: 7, pad: 2 }); // the other options are unchanged
   * counter.update({ duration: null });   // back to the automatic duration
   * ```
   */
  public update(options: RollingNumberUpdate): void {
    this.apply(options);
  }

  /** update() logic, shared by the 1.x setters. */
  private apply(options: RollingNumberUpdate | null | undefined): void {
    if (this.dead) return;
    const o = (options ?? {}) as Record<string, unknown>;
    const prev = this.opts;
    const next = { ...prev };
    let value: unknown;
    for (const key of OPTION_KEYS) {
      let raw: unknown;
      try {
        raw = o[key];
      } catch {
        raw = undefined;
      }
      // `from` is stored (getResolved) but creation-only: it never replays the intro.
      if (key === 'value') value = raw;
      else (next as Record<string, unknown>)[key] = normalizeField(key, raw, prev);
    }

    // Layout change (§8.3): the formatter output, the effective max or the resolved mode.
    const fmt = createFormatter(next);
    const res = resolveMode(this.host, next.mode);
    if (fmt.key !== this.fmt.key || fmt.maxA(next.max) !== this.Amax || res !== this.res) {
      this.jump(true);
      this.opts = next;
      this.fmt = fmt;
      this.Amax = fmt.maxA(next.max);
      this.A1 = this.restA = fmt.quantize(this.value);
      this.shown = clampA(this.A1, this.Amax);
      const rest = this.restOf(this.A1);
      if (res !== this.res) {
        this.teardown();
        this.setup();
        this.renderer?.mount(rest, true);
      } else {
        this.renderer?.setFormatter(fmt);
        this.renderer?.rest(rest);
      }
    }
    this.opts = next;
    this.writeLabel();

    if (next.live === 'off') {
      this.release?.();
      this.release = undefined;
    } else if (!this.release) {
      this.release = retainAnnouncer(this.host);
    }
    if (next.trigger !== prev.trigger) {
      this.vis?.stop();
      this.vis = this.seen = undefined;
      if (next.trigger === 'visible') this.observe();
      else if (this.waiting) this.go();
    }

    if (value !== undefined && normalizeValue(value) !== this.value) {
      void this.setValue(value as number);
    } else {
      this.render();
    }
  }

  /**
   * Destroys the instance: cancels any running animation, removes only the
   * nodes created by the core and restores the host's previous role,
   * aria-label and class (form controls keep their last value). Pending
   * promises resolve `{ completed: false }`; no event is dispatched. The
   * instance is inert afterwards. Calling it more than once is safe.
   */
  public destroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.epoch++;
    this.halt();
    this.waiting = this.mid = false;
    this.vis?.stop();
    this.release?.();
    this.vis = this.release = undefined;
    this.teardown();
    if (instances.get(this.host) === this) instances.delete(this.host);
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w.resolve({ value: w.value, completed: false });
  }
}
