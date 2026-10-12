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
  return core['engine'].resolved();
}

/** A promise waiting for a target to settle. */
interface Waiter {
  /** quantized target it waits for */
  A: number;
  value: number;
  resolve: (settled: RollingNumberSettled) => void;
}

/**
 * State and logic of one core. Written as a closure (its locals mangle;
 * class members do not) and driven by the public {@link RollingNumberCore}
 * methods, which document the behavior.
 */
interface Engine {
  render(): void;
  setValue(value: number, animate?: boolean | RollingNumberSetValueOptions): Promise<RollingNumberSettled>;
  whenSettled(): Promise<RollingNumberSettled>;
  finish(): void;
  getValue(): number;
  getDisplayValue(): number;
  getText(): string;
  getMode(): 'columns' | 'text';
  isAnimating(): boolean;
  /** update() logic, shared by the 1.x setters. */
  apply(options: RollingNumberUpdate | null | undefined): void;
  destroy(): void;
  /** See {@link getResolved}. */
  resolved(): Readonly<NormalizedOptions> & { readonly f: number };
}

/** Creates the engine of `self` (already validated and registered as the host's core). */
function createEngine(self: RollingNumberCore, host: HTMLElement | SVGElement, options: RollingNumberUpdate): Engine {
  const doc = host.ownerDocument;
  const view = doc.defaultView as (Window & typeof globalThis) | null;

  let opts: NormalizedOptions;
  let fmt: Formatter;
  /** `max` in last-digit units (Infinity: no limit). */
  let Amax: number;
  let renderer: Renderer | undefined;
  /** Resolved mode. */
  let res!: 'columns' | 'text' | 'unsupported'; // set by setup()

  /** Normalized target value. */
  let value: number;
  /** Quantized target. */
  let A1: number;
  /** Quantized value the renderer last rested on (unclamped). */
  let restA: number;
  /** Clamped display scalar on screen. */
  let shown: number;

  /** The renderer is between `begin()` and `rest()` (mid-motion, possibly paused). */
  let mid = false;
  /** A motion is scheduled on the ticker. */
  let moving = false;
  /** `trigger: 'visible'`: a change waits for the host to become visible. */
  let waiting = false;
  let dead = false;

  /** `animate` argument of the current change. */
  let call: boolean | RollingNumberSetValueOptions | undefined;
  /** Kind of the current motion. */
  let kind: 'count' | 'roll' | undefined;
  /** Plan of the current motion (unset until its first read phase, and for a read-phase instant change). */
  let plan: Plan | undefined;
  /** Plan replaced by a retarget and its progress, for the velocity carry (§5.6). */
  let prev: { plan: Plan; p: number } | undefined;
  /** The motion starts from the displayed channels (retarget, resume), not from rest. */
  let fromDisplay = false;
  /** Start scalar of the current motion. */
  let A0 = 0;
  /** First frame timestamp and last progress. */
  let t0 = 0;
  let p = 0;
  let fs: FrameState | undefined;
  /** The motion settled in this frame's write phase. */
  let done = false;
  /** Watchdog timer. */
  let dog: number | undefined;

  /** Promises waiting for the current target. */
  let waiters: Waiter[] = [];
  /** Display value when the current session started (unset: no session). */
  let from: number | undefined;
  /** `rn-start` of the current session was dispatched. */
  let started = false;
  /** Incremented by every change: stale microtasks compare it. */
  let epoch = 0;

  /** Current accessible label, and the last one written to `aria-label`. */
  let label = '';
  let lastLabel: string | undefined;
  /** Host state captured before initialization, restored by destroy(). */
  let prevRole: string | null = null;
  let prevLabel: string | null = null;
  let addedClass = false;

  /** Last visibility reported for `trigger: 'visible'` (unset: unknown). */
  let seen: boolean | undefined;
  let vis: { stop(): void } | undefined;
  let release: (() => void) | undefined;

  /** Shared-ticker hooks (§5.9). */
  const tick: Tickable = {
    read: (now) => {
      const r = renderer;
      if (plan || !r) return;
      t0 = now;
      const t = resolveTiming(opts, call, probe, false, true);
      // A CSS-derived duration of 0 (roll with `--rn-duration: 0s`): the write phase lands now (§5.8).
      if (t.instant) return;
      let { D, E } = t;
      // Count → count retarget: velocity-continuous curve, unless this call sets its own easing (§5.6).
      if (prev && prev.plan.kind === 'count' && t.kind === 'count' && !(typeof call === 'object' && call?.easing !== undefined)) {
        ({ D, E } = retargetCurve(prev.plan, prev.p, shown, A1, D));
      }
      plan = makePlan({
        kind: t.kind, A0, A1, Amax, f: fmt.f, pad: opts.pad, D, E,
        display: fromDisplay ? r.displayed() : null,
        prevKind: prev ? prev.plan.kind : null
      });
      arm(D);
      r.measure();
    },
    write: (now) => {
      const pl = plan;
      mark(true);
      const progress = pl ? Math.max(0, (now - t0) / pl.D) : 1;
      if (!(progress < 1)) {
        land();
        return (done = true);
      }
      fs = sample(pl as Plan, (p = progress), fs);
      (renderer as Renderer).frame(fs);
      shown = fs.A;
      return false;
    },
    settled: () => mark(false),
    post: () => {
      if (done) {
        done = false;
        end(!!plan);
      } else if (!started) {
        started = true;
        emit('rn-start', detail(true));
      }
    }
  };

  /**
   * Resolves the mode, warns once for hosts that cannot show columns, creates
   * the renderer and (columns mode) sets the host markers, remembering their
   * previous state so destroy() can restore it.
   */
  const setup = (): void => {
    res = resolveMode(host, opts.mode);
    if (res !== 'text' && resolveMode(host, 'auto') !== 'columns' && !warnedHosts.has(host)) {
      warnedHosts.add(host);
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(
          `[RollingNumber] <${(host.localName || '').toLowerCase()}> is not a supported host in 1.x: the digit columns are ` +
            'inserted as child nodes, which this element does not render. Use a container ' +
            'element such as <span> or <div> instead.'
        );
      }
    }
    if (res === 'unsupported') return;
    renderer = (res === 'text' ? createTextRenderer : createColumnsRenderer)(host, doc, fmt);
    if (res === 'columns') {
      // Role and label of a server-rendered host are core-owned: removed (not restored) on destroy.
      const ssr = host.hasAttribute(SSR);
      prevRole = ssr ? null : host.getAttribute('role');
      prevLabel = ssr ? null : host.getAttribute('aria-label');
      addedClass = !host.classList.contains(ROOT_CLASS);
      host.removeAttribute(SSR);
      mark(false);
      host.setAttribute('role', 'img');
    }
  };

  /** Destroys the renderer and restores the host markers (inverse of setup()). */
  const teardown = (): void => {
    renderer?.destroy();
    renderer = undefined;
    host.removeAttribute(STATE);
    if (res === 'columns') {
      host.classList.remove(ANIM_CLASS);
      restoreAttr(host, 'role', prevRole);
      restoreAttr(host, 'aria-label', prevLabel);
      if (addedClass) host.classList.remove(ROOT_CLASS);
      lastLabel = undefined;
    }
  };

  /**
   * Host markers: `data-rn-state="animating"` while moving; in columns mode
   * also the root class (re-added when a framework clobbered `className`) and
   * the legacy `rn-interpolating` class. Writes only what differs. `flush`
   * reads a computed style before the markers go away, so user or pinned-1.2
   * transitions never replay from the intermediate digits (the ticker flushes
   * once per frame itself).
   */
  const mark = (on: boolean, flush?: boolean): void => {
    const list = host.classList;
    if (!renderer) return;
    if (!on && flush && host.hasAttribute(STATE)) void view?.getComputedStyle(host).opacity;
    if (res === 'columns') {
      if (!list.contains(ROOT_CLASS)) list.add(ROOT_CLASS);
      if (list.contains(ANIM_CLASS) !== on) list.toggle(ANIM_CLASS);
    }
    if (on && host.getAttribute(STATE) !== 'animating') host.setAttribute(STATE, 'animating');
    else if (!on && host.hasAttribute(STATE)) host.removeAttribute(STATE);
  };

  /** Recomputes the label and writes `aria-label` when it changed (columns mode only). */
  const writeLabel = (): void => {
    label = resolveLabel(opts, fmt, value, Math.abs(A1) > Amax);
    if (res === 'columns' && label !== lastLabel) host.setAttribute('aria-label', (lastLabel = label));
  };

  /** Rest state of the quantized value `A` (§3.3): the renderer gets the clamped scalar. */
  const restOf = (A: number): RestState => {
    const c = clampA(A, Amax);
    const overflow = Math.abs(A) > Amax;
    return {
      A: c, overflow, layout: fmt.layout(fmt.shapeOf(A, Amax)), text: fmt.text(c, overflow), numericText: fmt.numericText(c), glyphs: fmt.glyphs
    };
  };

  /** Whether the user asked the OS/browser to minimize non-essential motion. */
  const reduced = (): boolean => {
    try {
      return !!view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  };

  /** Synchronous part of the timing (no CSS probe, §5.8). */
  const timing = (animate: boolean | RollingNumberSetValueOptions | undefined) =>
    resolveTiming(opts, animate, () => null, reduced(), !!view && typeof view.requestAnimationFrame === 'function');

  /** CSS timing probe (read phase): the sizer's computed animation timing, or the host's raw custom properties in text mode. */
  const probe = (): TimingProbe | null => {
    const r = renderer;
    if (!r || !view) return null;
    const el = r.probe();
    const cs = view.getComputedStyle(el || host);
    return el
      ? { durationCss: cs.animationDuration, easingCss: cs.animationTimingFunction, fromCustomProperties: false }
      : { durationCss: cs.getPropertyValue('--rn-duration'), easingCss: cs.getPropertyValue('--rn-easing'), fromCustomProperties: true };
  };

  /** Watchdog: finishes a motion whose frames never come (background tab, `display:none` iframe). */
  const arm = (D: number): void => {
    disarm();
    if (view) dog = view.setTimeout(() => self.finish(), D + 1000) as unknown as number;
  };

  const disarm = (): void => {
    view?.clearTimeout(dog);
    dog = undefined;
  };

  /** Stops the ticker and the watchdog. */
  const halt = (): void => {
    if (view) cancel(view, tick);
    disarm();
    moving = false;
  };

  /** Final DOM of the target. */
  const land = (): void => {
    renderer?.rest(restOf(A1));
    restA = A1;
    shown = clampA(A1, Amax);
    mid = moving = false;
    disarm();
  };

  /** Observes the host for `trigger: 'visible'`; a waiting change starts once it is visible. */
  const observe = (): void => {
    seen = undefined;
    // The no-IO fallback calls back before returning: the handle is not used in the callback.
    vis = observeVisibility(host, (visible) => {
      seen = visible;
      if (visible && waiting && !dead) go();
    });
  };

  /** A promise for `v` (at the current target) that resolves with the next settle (or supersede/destroy). */
  const wait = (v: number): Promise<RollingNumberSettled> =>
    new Promise((resolve) => {
      waiters.push({ A: A1, value: v, resolve });
    });

  /** Resolves and clears the waiting promises with `completed`. */
  const settle = (list: Waiter[], completed: boolean): void => {
    for (const w of list) w.resolve({ value: w.value, completed });
  };

  const getDisplayValue = (): number => shown / 10 ** fmt.f / fmt.scale || 0;

  /** Event detail of the current session. */
  const detail = (animated: boolean): RollingNumberEventDetail => ({ value, from: from ?? getDisplayValue(), animated });

  /** Dispatches `rn-start` / `rn-end` on the host with the host realm's CustomEvent (bubbles, composed). */
  const emit = (type: 'rn-start' | 'rn-end', d: RollingNumberEventDetail): void => {
    const Ctor = view?.CustomEvent ?? (typeof CustomEvent === 'function' ? CustomEvent : null);
    if (Ctor) host.dispatchEvent(new Ctor(type, { detail: d, bubbles: true, composed: true }));
  };

  /**
   * Ends the session: `rn-start` if it never fired, `rn-end`, then the
   * promises and the live announcement. State is committed before dispatch,
   * so handlers may call setValue().
   */
  const end = (animated: boolean): void => {
    const d = detail(animated);
    const list = waiters;
    const start = !started;
    waiters = [];
    from = undefined;
    started = false;
    if (start) emit('rn-start', d);
    emit('rn-end', { ...d });
    settle(list, true);
    if (!dead && opts.live !== 'off') announce(host, label, opts.live);
  };

  /** Ends the session in a microtask (instant changes; never inside setValue()/update()). */
  const later = (animated: boolean): void => {
    const e = ++epoch;
    microtask(() => {
      if (!dead && e === epoch) end(animated);
    });
  };

  /** Jumps to the target (see finish()); `defer` dispatches the events in a microtask. */
  const jump = (defer?: boolean): void => {
    if (dead || !(moving || waiting)) return;
    const animated = started;
    halt();
    waiting = false;
    land();
    mark(false, true);
    if (defer) later(animated);
    else {
      epoch++;
      end(animated);
    }
  };

  /**
   * Starts the change to the current target (§8.2 steps 5–7): instant (final
   * DOM now, events in a microtask) or animated (begin, markers, ticker,
   * watchdog). A running motion is retargeted from the display.
   */
  const go = (): void => {
    const r = renderer;
    const t = timing(call);
    waiting = false;
    from ??= getDisplayValue();
    if (!r || t.instant || !r.canAnimate()) {
      halt();
      land();
      mark(false, true);
      later(false);
      return;
    }
    epoch++;
    const display = mid ? r.displayed() : null;
    prev = moving ? (plan ? { plan, p } : prev) : undefined;
    fromDisplay = mid;
    A0 = mid ? shown : restA;
    r.begin(
      fmt.motionLayout(display ? fmt.shapeOfDisplay(display) : fmt.shapeOf(restA, Amax), fmt.shapeOf(A1, Amax)),
      t.kind,
      restOf(A1)
    );
    kind = t.kind;
    plan = undefined;
    done = false;
    mid = moving = true;
    mark(true);
    schedule(view as Window, tick);
    arm(t.D);
  };

  const render = (): void => {
    const r = renderer;
    if (dead || !r) return;
    mark(moving, true);
    ensureStyles(host, opts.injectStyles);
    if (!mid) r.rest(restOf(restA));
  };

  /** §8.2 steps 3–7 for the current target: supersede other promises, then wait for visibility or start. */
  const change = (animate: boolean | RollingNumberSetValueOptions | undefined): Promise<RollingNumberSettled> => {
    const target = A1;
    const stale = waiters.filter((w) => w.A !== target);
    waiters = waiters.filter((w) => w.A === target);
    settle(stale, false);
    const promise = wait(value);

    ensureStyles(host, opts.injectStyles);
    call = animate;
    if (opts.trigger === 'visible' && seen !== true) {
      // Waiting for visibility: the label is up to date, the display is frozen.
      if (moving) {
        halt();
        mark(false, true);
      }
      waiting = true;
    } else {
      go();
    }
    return promise;
  };

  const setValue = (input: number, animate?: boolean | RollingNumberSetValueOptions): Promise<RollingNumberSettled> => {
    const v = normalizeValue(input);
    value = v;
    if (dead) return Promise.resolve({ value: v, completed: false });

    const A = fmt.quantize(v);
    const same = A === A1;
    A1 = A;
    writeLabel();

    if (moving || waiting) {
      if (same) {
        // Same target in flight (§8.2 step 2): join, finish or re-plan.
        if (animate === undefined) return wait(v);
        const t = timing(animate);
        if (t.instant || !renderer?.canAnimate()) {
          const promise = wait(v);
          jump(true);
          return promise;
        }
        const c = typeof animate === 'object' ? animate : null;
        if (t.kind === kind && !(c && (c.duration !== undefined || c.easing !== undefined))) return wait(v);
      }
    } else if (same) {
      return Promise.resolve({ value: v, completed: true });
    }
    return change(animate);
  };

  // ── initialization ──────────────────────────────────────────────────

  const o = (opts = resolveOptions(options));
  fmt = createFormatter(o);
  Amax = fmt.maxA(o.max);
  value = o.value;

  // Server-rendered content: a host rendered by renderStaticHTML / getSSRProps, or a fallback child.
  const adopted = host.hasAttribute(SSR) || !!host.querySelector(':scope>[' + SSR + ']');
  setup();
  ensureStyles(host, o.injectStyles);
  if (o.live !== 'off') release = retainAnnouncer(host);
  if (o.trigger === 'visible') observe();

  A1 = fmt.quantize(value);
  writeLabel();
  // `from` intro (§8.3): skipped under reduced motion, and when visible server content was adopted.
  const fromA = o.from === null ? A1 : fmt.quantize(o.from);
  const intro =
    fromA !== A1 &&
    !reduced() &&
    !(adopted && res === 'columns' && (o.trigger !== 'visible' || seen === true));
  restA = intro ? fromA : A1;
  shown = clampA(restA, Amax);
  renderer?.mount(restOf(restA), true);
  if (intro) void change(undefined);

  return {
    render,
    setValue,
    whenSettled() {
      if (dead) return Promise.resolve({ value, completed: false });
      if (moving || waiting || waiters.length > 0) return wait(value);
      return Promise.resolve({ value, completed: true });
    },
    finish: () => jump(),
    getValue: () => value,
    getDisplayValue,
    getText: () => restOf(A1).text,
    getMode: () => (res === 'text' ? 'text' : 'columns'),
    isAnimating: () => moving,
    apply(input) {
      if (dead) return;
      const src = (input ?? {}) as Record<string, unknown>;
      const before = opts;
      const next = { ...before };
      let raw: unknown;
      let nextValue: unknown;
      for (const key of OPTION_KEYS) {
        try {
          raw = src[key];
        } catch {
          raw = undefined;
        }
        // `from` is stored (getResolved) but creation-only: it never replays the intro.
        if (key === 'value') nextValue = raw;
        else (next as Record<string, unknown>)[key] = normalizeField(key, raw, before);
      }

      // Layout change (§8.3): the formatter output, the effective max or the resolved mode.
      const nextFmt = createFormatter(next);
      const nextRes = resolveMode(host, next.mode);
      if (nextFmt.key !== fmt.key || nextFmt.maxA(next.max) !== Amax || nextRes !== res) {
        jump(true);
        opts = next;
        fmt = nextFmt;
        Amax = nextFmt.maxA(next.max);
        A1 = restA = nextFmt.quantize(value);
        shown = clampA(A1, Amax);
        const rest = restOf(A1);
        if (nextRes !== res) {
          teardown();
          setup();
          renderer?.mount(rest, true);
        } else {
          renderer?.setFormatter(nextFmt);
          renderer?.rest(rest);
        }
      }
      opts = next;
      writeLabel();

      if (next.live === 'off') {
        release?.();
        release = undefined;
      } else if (!release) {
        release = retainAnnouncer(host);
      }
      if (next.trigger !== before.trigger) {
        vis?.stop();
        vis = seen = undefined;
        if (next.trigger === 'visible') observe();
        else if (waiting) go();
      }

      // Through the public methods, as update() documents.
      if (nextValue !== undefined && normalizeValue(nextValue) !== value) {
        void self.setValue(nextValue as number);
      } else {
        self.render();
      }
    },
    destroy() {
      if (dead) return;
      dead = true;
      epoch++;
      halt();
      waiting = mid = false;
      vis?.stop();
      release?.();
      vis = release = undefined;
      teardown();
      if (instances.get(host) === self) instances.delete(host);
      const list = waiters;
      waiters = [];
      settle(list, false);
    },
    resolved: () => Object.freeze({ ...opts, value, f: fmt.f })
  };
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
  // `declare`d and assigned in the constructor: initializers would compile to helper calls.
  private declare readonly host: HTMLElement | SVGElement;
  /** State and logic (a closure, see createEngine). */
  private declare readonly engine: Engine;

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
    this.host = container;
    this.engine = createEngine(this, container, options);
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
    this.engine.render();
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
    return this.engine.setValue(value, animate);
  }

  /**
   * Resolves when the current motion settles (immediately when idle).
   *
   * @returns `{ value, completed }` as for {@link RollingNumberCore.setValue}.
   */
  public whenSettled(): Promise<RollingNumberSettled> {
    return this.engine.whenSettled();
  }

  /**
   * Jumps to the target now: final DOM, `rn-end` (preceded by `rn-start` when
   * the motion had not started yet), pending promises resolve
   * `{ completed: true }`. No-op when idle.
   */
  public finish(): void {
    this.engine.finish();
  }

  /**
   * Gets the current numeric target value (normalized, not rounded): during a
   * motion this is already the final value, not the one on screen
   * (see {@link RollingNumberCore.getDisplayValue}).
   *
   * @returns The target value.
   */
  public getValue(): number {
    return this.engine.getValue();
  }

  /**
   * Value on screen: signed, in user units (percent: the fraction), clamped by
   * `max`, rounded to the displayed precision at rest and fractional mid-count.
   *
   * @returns The displayed value.
   */
  public getDisplayValue(): number {
    return this.engine.getDisplayValue();
  }

  /**
   * Displayed text of the target at rest: clamped by `max`, with
   * `overflowSuffix` and affixes, e.g. `"$1,234.50"`, `"99+"` (what text mode
   * shows). The unclamped text is in the default label.
   *
   * @returns The text of the target.
   */
  public getText(): string {
    return this.engine.getText();
  }

  /**
   * Renderer in use after `mode: 'auto'` resolution (`'columns'` for hosts
   * that cannot display the value).
   *
   * @returns `'columns'` or `'text'`.
   */
  public getMode(): 'columns' | 'text' {
    return this.engine.getMode();
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
    return this.engine.isAnimating();
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
    this.engine.apply({ interpolate: interpolate ?? null });
  }

  /**
   * Updates the animation duration in milliseconds. `null` resets it to
   * unset (auto); non-finite input keeps the current duration; negative
   * values become 0. Applies to the next {@link RollingNumberCore.setValue} call.
   *
   * @param duration Duration in ms (`0` disables counting), or `null` for auto.
   */
  public setDuration(duration: number | null): void {
    this.engine.apply({ duration });
  }

  /**
   * Updates the minimum number of integer digits (leading zeros, 1..64) and
   * re-renders (a running motion finishes first).
   *
   * @param pad See {@link RollingNumberOptions.pad}.
   */
  public setPad(pad: number): void {
    this.engine.apply({ pad: pad ?? null });
  }

  /**
   * Updates the maximum displayed magnitude. null, undefined, '', negative or
   * non-finite values remove the limit. A running motion finishes first.
   *
   * @param max Display clamp, or `null` for none (see {@link RollingNumberOptions.max}).
   */
  public setMax(max: number | null): void {
    this.engine.apply({ max: max ?? null });
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
    this.engine.apply(options);
  }

  /**
   * Destroys the instance: cancels any running animation, removes only the
   * nodes created by the core and restores the host's previous role,
   * aria-label and class (form controls keep their last value). Pending
   * promises resolve `{ completed: false }`; no event is dispatched. The
   * instance is inert afterwards. Calling it more than once is safe.
   */
  public destroy(): void {
    this.engine.destroy();
  }
}
