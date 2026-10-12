import { afterEach, describe, expect, it, vi } from 'vitest';
import { createColumnsRenderer } from '../src/renderers/columns';
import type {
  Formatter, FrameState, MotionLayout, MotionToken, NumberLayout, Renderer, RestState, Tie, Token
} from '../src/internal/contracts';
import { makeHost } from './helpers';

/*
 * Columns renderer (docs/design/v1.3.md §4.1, §4.2, §3.3; test plan §11 WP3).
 * WP2's formatter is not used here: the local helpers below build plain-path
 * layouts with the §4.1 keys and the §3.3 places by hand.
 */

// ── local layout helpers (plain path) ─────────────────────────────────

interface Opts {
  f?: number;
  pad?: number;
  max?: number | null;
  prefix?: string;
  suffix?: string;
  group?: string;
  overflowText?: string;
  glyphs?: readonly string[] | null;
  /** positive sign text (signDisplay 'always'-like layouts) */
  plus?: string;
}

interface Shape { intDigits: number; negative: boolean; overflow: boolean; zero: boolean }

function shapeOf(A: number, o: Opts = {}): Shape {
  const f = o.f ?? 0;
  const Amax = o.max == null ? Infinity : Math.floor(o.max * 10 ** f);
  const M = Math.min(Math.abs(A), Amax);
  const int = Math.floor(M / 10 ** f);
  return { intDigits: Math.max(o.pad ?? 1, String(int).length), negative: A < 0, overflow: Math.abs(A) > Amax, zero: A === 0 };
}

/** Plain-path layout: [pre] [sign] i{n-1} [g] … i0 [dec f1 … f{f}] [ovf] [suf]. */
function layoutOf(s: Shape, o: Opts = {}): NumberLayout {
  const f = o.f ?? 0;
  const tokens: Token[] = [];
  if (o.prefix) tokens.push({ kind: 'static', key: 'pre', role: 'prefix', text: o.prefix });
  if (s.negative) tokens.push({ kind: 'sign', key: 'sign', text: '−' });
  else if (o.plus && !s.zero) tokens.push({ kind: 'sign', key: 'sign', text: o.plus });
  for (let j = s.intDigits - 1; j >= 0; j--) {
    tokens.push({ kind: 'digit', key: 'i' + j, place: j + f });
    if (o.group && j > 0 && j % 3 === 0) tokens.push({ kind: 'static', key: 'g' + j, role: 'group', text: o.group });
  }
  if (f > 0) {
    tokens.push({ kind: 'static', key: 'dec', role: 'decimal', text: '.' });
    for (let j = 1; j <= f; j++) tokens.push({ kind: 'digit', key: 'f' + j, place: f - j });
  }
  if (s.overflow) tokens.push({ kind: 'static', key: 'ovf', role: 'overflow', text: o.overflowText ?? '+' });
  if (o.suffix) tokens.push({ kind: 'static', key: 'suf', role: 'suffix', text: o.suffix });
  return { key: JSON.stringify([s, o]), tokens };
}

function restOf(A: number, o: Opts = {}): RestState {
  const f = o.f ?? 0;
  const s = shapeOf(A, o);
  const Amax = o.max == null ? Infinity : Math.floor(o.max * 10 ** f);
  const clamped = Math.sign(A) * Math.min(Math.abs(A), Amax) || 0;
  return { A: clamped, overflow: s.overflow, layout: layoutOf(s, o), text: String(clamped), numericText: String(clamped), glyphs: o.glyphs ?? null };
}

function tieOf(t: Token, f: number): Tie {
  if (t.kind === 'sign') return { kind: 'sign' };
  if (t.kind === 'static' && t.role === 'overflow') return { kind: 'overflow' };
  if (t.kind === 'static' && t.role === 'group') return { kind: 'place', place: Number(t.key.slice(1)) + f };
  return null;
}

/** Merges two layouts by key in target order; from-only tokens keep their relative position. */
function motionOf(from: NumberLayout, to: NumberLayout, f = 0): MotionLayout {
  const toKeys = new Set(to.tokens.map((t) => t.key));
  const fromKeys = new Set(from.tokens.map((t) => t.key));
  const before: Token[] = [];
  const after = new Map<string, Token[]>();
  let last: string | null = null;
  for (const t of from.tokens) {
    if (toKeys.has(t.key)) { last = t.key; continue; }
    if (last === null) before.push(t);
    else after.set(last, [...(after.get(last) ?? []), t]);
  }
  const out: MotionToken[] = before.map((t) => ({ token: t, presence: 'leave', tie: tieOf(t, f) }));
  for (const t of to.tokens) {
    out.push({ token: t, presence: fromKeys.has(t.key) ? 'both' : 'enter', tie: tieOf(t, f) });
    for (const l of after.get(t.key) ?? []) out.push({ token: l, presence: 'leave', tie: tieOf(l, f) });
  }
  return { tokens: out };
}

const motion = (A0: number, A1: number, o: Opts = {}): MotionLayout =>
  motionOf(layoutOf(shapeOf(A0, o), o), layoutOf(shapeOf(A1, o), o), o.f ?? 0);

interface FrameInit { q?: number; A?: number; pos?: number[]; inn?: number[]; lead?: number[]; reel?: number[]; sigma?: number; ovf?: number }

function frameOf(n: number, init: FrameInit = {}): FrameState {
  const fill = (src: number[] | undefined, d: number) => Float64Array.from({ length: n }, (_, k) => src?.[k] ?? d);
  return {
    q: init.q ?? 0.5,
    A: init.A ?? 0,
    pos: fill(init.pos, 0),
    inn: fill(init.inn, 1),
    lead: Uint8Array.from({ length: n }, (_, k) => init.lead?.[k] ?? 0),
    reel: Uint8Array.from({ length: n }, (_, k) => init.reel?.[k] ?? 0),
    sigma: init.sigma ?? 0,
    ovf: init.ovf ?? 0
  };
}

const fmtOf = (glyphs: readonly string[] | null = null): Formatter => ({ glyphs } as unknown as Formatter);
const ARABIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

// ── DOM helpers ───────────────────────────────────────────────────────

const renderers: Renderer[] = [];
function setup(rest: RestState, host: HTMLElement = makeHost(), adopt = false, glyphs: readonly string[] | null = rest.glyphs) {
  const r = createColumnsRenderer(host, host.ownerDocument, fmtOf(glyphs));
  renderers.push(r);
  r.mount(rest, adopt);
  return { r, host };
}

afterEach(() => {
  for (const r of renderers.splice(0)) r.destroy();
  document.body.textContent = '';
});

const key = (host: Element, k: string): HTMLElement => host.querySelector(`:scope > [data-rn-key="${k}"]`) as HTMLElement;
const keys = (host: Element): string[] => Array.from(host.children).filter((c) => c.hasAttribute('data-rn-key')).map((c) => c.getAttribute('data-rn-key')!);
const digits = (host: Element): string => Array.from(host.querySelectorAll(':scope > .rn-col')).map((c) => c.getAttribute('data-digit')).join('');
const scaleOf = (col: Element): HTMLElement => col.querySelector(':scope > .rn-scale') as HTMLElement;
const transformOf = (col: Element): string => scaleOf(col).style.getPropertyValue('transform');
const inOf = (el: Element): string => (el as HTMLElement).style.getPropertyValue('--rn-in');
const wOf = (el: Element): string => (el as HTMLElement).style.getPropertyValue('--rn-w');

/** The 1.2 markup of a column, plus `data-rn-key`. */
function col12(digit: number, k: string): string {
  let cells = '';
  for (let i = 0; i <= 9; i++) cells += `<span class="rn-cell">${i}</span>`;
  return `<span class="rn-col" data-digit="${digit}" data-rn-key="${k}"><span class="rn-sizer" aria-hidden="true">${digit}</span>` +
    `<span class="rn-scale" aria-hidden="true">${cells}</span></span>`;
}
const SIGN12 = '<span class="rn-sign" data-rn-key="sign" aria-hidden="true">−</span>';

/** No inline style, data-rn-in or data-rn-lead anywhere in the owned nodes. */
function expectClean(host: Element): void {
  expect(host.querySelectorAll('[style]').length).toBe(0);
  expect(host.querySelectorAll('[data-rn-in]').length).toBe(0);
  expect(host.querySelectorAll('[data-rn-lead]').length).toBe(0);
}

/**
 * Stubs layout reads: boxes of `.rn-col` / tokens and Range widths over token text.
 * `scale`: screen px per layout px (an ancestor `transform: scale()` or `zoom`): client
 * rects are multiplied by it. `computed`: `getComputedStyle().width` reports the layout
 * width (as browsers do); without it the computed width is left to happy-dom.
 * `hidden`: the host is `display: none` (every box and Range measures 0, computed width `auto`).
 */
function stubGeometry(opts: { col?: number; perChar?: number; scale?: number; computed?: boolean } = {}) {
  const col = opts.col ?? 20;
  const perChar = opts.perChar ?? 10;
  const geo = { hidden: false, boxes: [] as Element[] };
  const k = opts.scale ?? 1;
  const rects = (width: number) => ({ x: 0, y: 0, top: 0, left: 0, bottom: 0, right: width, width, height: 0, toJSON() {} }) as DOMRect;
  /** Layout width of an owned box. */
  const layoutW = (el: Element): number => {
    if (geo.hidden || el.hasAttribute('data-rn-in')) return 0;
    if (el.classList.contains('rn-col')) return col;
    return (el.textContent ?? '').length * perChar + 1;
  };
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    geo.boxes.push(this);
    return rects(layoutW(this) * k);
  });
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
    return rects(geo.hidden ? 0 : (this.startContainer.textContent ?? '').length * perChar * k);
  });
  if (opts.computed) {
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      const style = real(el, pseudo);
      if (!(el as HTMLElement).hasAttribute('data-rn-key')) return style;
      const width = geo.hidden ? 'auto' : layoutW(el) + 'px';
      return new Proxy(style, { get: (t, p) => (p === 'width' ? width : Reflect.get(t, p)) });
    });
  }
  return geo;
}

// ── tests ─────────────────────────────────────────────────────────────

describe('columns renderer: the 1.2 DOM on the plain path', () => {
  it('renders the 1.2 markup plus data-rn-key (10 cells, sizer text, data-digit, no .rn-static)', () => {
    const { host } = setup(restOf(1234));
    expect(host.innerHTML).toBe(col12(1, 'i3') + col12(2, 'i2') + col12(3, 'i1') + col12(4, 'i0'));
    for (const c of host.querySelectorAll('.rn-col')) expect(c.querySelectorAll(':scope > .rn-scale > .rn-cell')).toHaveLength(10);
    expect(host.querySelector('.rn-static, [data-rn-zero]')).toBeNull();
    expectClean(host);
  });

  it('renders the sign as in 1.2 and zero-pads to pad', () => {
    expect(setup(restOf(-42)).host.innerHTML).toBe(SIGN12 + col12(4, 'i1') + col12(2, 'i0'));
    expect(setup(restOf(7, { pad: 3 })).host.innerHTML).toBe(col12(0, 'i2') + col12(0, 'i1') + col12(7, 'i0'));
    expect(setup(restOf(0)).host.innerHTML).toBe(col12(0, 'i0'));
  });

  it('keeps the 1.2 textContent', () => {
    const { host } = setup(restOf(-305));
    expect(host.textContent).toBe('−' + '30123456789' + '00123456789' + '50123456789');
  });

  it('updates in place at rest: data-digit and sizer text only change when the digit changes', () => {
    const { r, host } = setup(restOf(1234));
    const before = Array.from(host.children);
    const spy = vi.spyOn(Element.prototype, 'setAttribute');
    r.rest(restOf(1294));
    expect(Array.from(host.children)).toEqual(before);
    expect(digits(host)).toBe('1294');
    expect(key(host, 'i1').querySelector('.rn-sizer')!.textContent).toBe('9');
    expect(spy.mock.calls.filter((c) => c[0] === 'data-digit')).toHaveLength(1);
    expect(host.innerHTML).toBe(col12(1, 'i3') + col12(2, 'i2') + col12(9, 'i1') + col12(4, 'i0'));
  });
});

describe('columns renderer: ownership', () => {
  it('appends one contiguous block after the pre-existing children and never touches them', () => {
    const host = makeHost('div');
    const before = document.createElement('b');
    before.textContent = 'Total: ';
    host.appendChild(before);
    const { r } = setup(restOf(12), host);
    expect(host.firstChild).toBe(before);
    expect(keys(host)).toEqual(['i1', 'i0']);

    // a node appended after the block by someone else stays after it
    const later = document.createElement('i');
    later.textContent = ' pts';
    host.appendChild(later);
    r.rest(restOf(-1234));
    expect(Array.from(host.childNodes).map((n) => (n as Element).getAttribute?.('data-rn-key') ?? n.nodeName)).toEqual(['B', 'sign', 'i3', 'i2', 'i1', 'i0', 'I']);
    expect(before.textContent).toBe('Total: ');
    expect(later.textContent).toBe(' pts');
    r.rest(restOf(5));
    expect(Array.from(host.children).map((n) => n.getAttribute('data-rn-key') ?? n.nodeName)).toEqual(['B', 'i0', 'I']);
  });

  it('moves a node only when its nextSibling differs', () => {
    const { r, host } = setup(restOf(-123, { prefix: '≈ ', suffix: ' pts' }));
    const insert = vi.spyOn(host, 'insertBefore');
    r.rest(restOf(-456, { prefix: '≈ ', suffix: ' pts' }));
    expect(insert).not.toHaveBeenCalled();
    r.rest(restOf(-1456, { prefix: '≈ ', suffix: ' pts' }));
    // only the new column is inserted
    expect(insert).toHaveBeenCalledTimes(1);
    expect(keys(host)).toEqual(['pre', 'sign', 'i3', 'i2', 'i1', 'i0', 'suf']);
  });

  it('destroy() removes only the owned nodes, restores the host and is idempotent', () => {
    const host = makeHost('div');
    host.innerHTML = '<em>a</em>text<span class="rn-sizer">foreign</span>';
    const original = host.innerHTML;
    const { r } = setup(restOf(-1234, { suffix: ' kg' }), host);
    r.begin(motion(-1234, 99999, { suffix: ' kg' }), 'count', restOf(99999, { suffix: ' kg' }));
    r.destroy();
    expect(host.innerHTML).toBe(original);
    r.destroy();
    r.rest(restOf(5));
    r.frame(frameOf(1));
    expect(host.innerHTML).toBe(original);
    expect(r.probe()).toBeNull();
  });

  it('probe() is the first owned .rn-sizer, never a foreign one', () => {
    const host = makeHost('div');
    host.innerHTML = '<span class="rn-sizer">foreign</span>';
    const { r } = setup(restOf(-42), host);
    expect(r.probe()).toBe(key(host, 'i1').querySelector('.rn-sizer'));
    expect(r.kind).toBe('columns');
    expect(r.canAnimate()).toBe(true);
  });
});

describe('columns renderer: keyed identity (B18)', () => {
  it('99 → 100 keeps i0/i1 and inserts i2 collapsed on the left', () => {
    const { r, host } = setup(restOf(99));
    const i0 = key(host, 'i0');
    const i1 = key(host, 'i1');
    r.begin(motion(99, 100), 'count', restOf(100));
    expect(keys(host)).toEqual(['i2', 'i1', 'i0']);
    expect(key(host, 'i0')).toBe(i0);
    expect(key(host, 'i1')).toBe(i1);
    const i2 = key(host, 'i2');
    expect(i2.hasAttribute('data-rn-in')).toBe(true);
    expect(inOf(i2)).toBe('0');
    expect(wOf(i2)).toBe('');
    expect(i2.hasAttribute('data-rn-lead')).toBe(true);

    r.frame(frameOf(3, { q: 0.5, A: 99.6, pos: [9.6, 9.6, 0.6], inn: [1, 1, 0.115], lead: [0, 0, 1] }));
    expect(inOf(i2)).toBe('0.1150');
    r.rest(restOf(100));
    expect(digits(host)).toBe('100');
    expect(key(host, 'i0')).toBe(i0);
    expect(key(host, 'i1')).toBe(i1);
    expect(key(host, 'i2')).toBe(i2);
    expectClean(host);
  });

  it('100 → 99 keeps i0/i1; i2 leaves and is removed only by rest()', () => {
    const { r, host } = setup(restOf(100));
    const [i2, i1, i0] = ['i2', 'i1', 'i0'].map((k) => key(host, k));
    r.begin(motion(100, 99), 'count', restOf(99));
    expect(keys(host)).toEqual(['i2', 'i1', 'i0']);
    expect(i2.hasAttribute('data-rn-in')).toBe(false);
    r.frame(frameOf(3, { q: 0.5, pos: [9.5, 9.5, 0.2], inn: [1, 1, 0.3], lead: [0, 0, 1] }));
    expect(i2.isConnected).toBe(true);
    expect(i2.hasAttribute('data-rn-in')).toBe(true);
    expect(inOf(i2)).toBe('0.3000');
    r.frame(frameOf(3, { q: 1, pos: [9, 9, 0], inn: [1, 1, 0], lead: [0, 0, 1] }));
    expect(i2.isConnected).toBe(true);
    r.rest(restOf(99));
    expect(i2.isConnected).toBe(false);
    expect(keys(host)).toEqual(['i1', 'i0']);
    expect(key(host, 'i1')).toBe(i1);
    expect(key(host, 'i0')).toBe(i0);
    expect(digits(host)).toBe('99');
    expectClean(host);
  });

  it('keeps fraction keys and places (f = 2: f2 → 0, f1 → 1, i0 → 2)', () => {
    const { r, host } = setup(restOf(125, { f: 2 }));
    expect(keys(host)).toEqual(['i0', 'dec', 'f1', 'f2']);
    expect(digits(host)).toBe('125');
    r.begin(motion(125, 350, { f: 2 }), 'count', restOf(350, { f: 2 }));
    r.frame(frameOf(3, { pos: [3, 4, 2.5] }));
    expect(transformOf(key(host, 'f2'))).toBe('translateY(-30.000%)');
    expect(transformOf(key(host, 'f1'))).toBe('translateY(-40.000%)');
    expect(transformOf(key(host, 'i0'))).toBe('translateY(-25.000%)');
  });
});

describe('columns renderer: begin()', () => {
  it('roll: pins the current positions inline and sets the target data-digit synchronously (S3)', () => {
    const { r, host } = setup(restOf(17));
    r.begin(motion(17, 22), 'roll', restOf(22));
    expect(digits(host)).toBe('22');
    expect(transformOf(key(host, 'i1'))).toBe('translateY(-10.000%)');
    expect(transformOf(key(host, 'i0'))).toBe('translateY(-70.000%)');
    // the sizer text is written at rest only
    expect(key(host, 'i0').querySelector('.rn-sizer')!.textContent).toBe('7');
    // frames do not touch data-digit on the roll path
    r.frame(frameOf(2, { q: 0.5, pos: [9.5, 1.5] }));
    expect(digits(host)).toBe('22');
    expect(transformOf(key(host, 'i0'))).toBe('translateY(-95.000%)');
  });

  it('roll: entering columns get the target digit, leaving ones keep theirs', () => {
    const { r, host } = setup(restOf(99));
    r.begin(motion(99, 100), 'roll', restOf(100));
    expect(digits(host)).toBe('100');
    expect(transformOf(key(host, 'i2'))).toBe('translateY(0.000%)');
    r.rest(restOf(100));
    r.begin(motion(100, 5), 'roll', restOf(5));
    expect(digits(host)).toBe('105');
  });

  it('count: pins positions without changing data-digit', () => {
    const { r, host } = setup(restOf(17));
    r.begin(motion(17, 22), 'count', restOf(22));
    expect(digits(host)).toBe('17');
    expect(transformOf(key(host, 'i0'))).toBe('translateY(-70.000%)');
  });

  it('inserts entering tokens collapsed (sign, separators, overflow)', () => {
    const o = { group: ',', max: 9999, overflowText: '+' };
    const { r, host } = setup(restOf(999, o));
    r.begin(motion(999, -12000, o), 'count', restOf(-12000, o));
    expect(keys(host)).toEqual(['sign', 'i3', 'g3', 'i2', 'i1', 'i0', 'ovf']);
    for (const k of ['sign', 'i3', 'g3', 'ovf']) {
      const el = key(host, k);
      expect(el.hasAttribute('data-rn-in'), k).toBe(true);
      expect(inOf(el), k).toBe('0');
    }
    for (const k of ['i2', 'i1', 'i0']) expect(key(host, k).hasAttribute('data-rn-in'), k).toBe(false);
    expect(key(host, 'g3').outerHTML).toBe('<span class="rn-static" data-rn-part="group" data-rn-key="g3" aria-hidden="true" data-rn-in="" style="--rn-in: 0;">,</span>');
  });
});

describe('columns renderer: measure()', () => {
  it('sets --rn-w from a present column and from a Range over collapsed text tokens', () => {
    const geo = stubGeometry({ col: 20, perChar: 10 });
    const o = { suffix: ' kg' };
    const { r, host } = setup(restOf(99));
    r.begin(motionOf(layoutOf(shapeOf(99)), layoutOf(shapeOf(-100, o), o)), 'count', restOf(-100, o));
    r.measure();
    // collapsed boxes are never measured
    for (const k of ['sign', 'i2', 'suf']) expect(geo.boxes).not.toContain(key(host, k));
    r.frame(frameOf(3, { q: 0.5, pos: [0, 0, 0], inn: [1, 1, 0.5], lead: [0, 0, 1], sigma: 0.5 }));
    expect(wOf(key(host, 'i2'))).toBe('20px');
    expect(wOf(key(host, 'sign'))).toBe('10px');
    // an untied entering suffix grows with q
    expect(wOf(key(host, 'suf'))).toBe('30px');
    expect(inOf(key(host, 'suf'))).toBe('0.5000');
    // present columns never get --rn-w
    expect(wOf(key(host, 'i0'))).toBe('');
  });

  it('measures a leaving token on its own box before it collapses', () => {
    const geo = stubGeometry({ perChar: 10 });
    const o = { suffix: ' pts' };
    const { r, host } = setup(restOf(-5, o));
    const suf = key(host, 'suf');
    const sign = key(host, 'sign');
    r.begin(motionOf(layoutOf(shapeOf(-5, o), o), layoutOf(shapeOf(5))), 'count', restOf(5));
    r.measure();
    expect(geo.boxes).toContain(suf);
    expect(geo.boxes).toContain(sign);
    r.frame(frameOf(1, { q: 0.25, pos: [3], sigma: 0.4 }));
    expect(wOf(suf)).toBe('41px');
    expect(inOf(suf)).toBe('0.7500');
    expect(wOf(sign)).toBe('11px');
    expect(inOf(sign)).toBe('0.4000');
  });

  // Client rects include ancestor transforms and `zoom`; --rn-w is a layout width.
  it.each([
    ['transform: scale(2)', 2],
    ['transform: scale(0.5)', 0.5],
    ['zoom: 2', 2]
  ])('measures layout px under %s (entering column, Range over entering text)', (_, scale) => {
    stubGeometry({ col: 20, perChar: 10, scale, computed: true });
    const o = { suffix: ' kg' };
    const { r, host } = setup(restOf(99));
    r.begin(motionOf(layoutOf(shapeOf(99)), layoutOf(shapeOf(-100, o), o)), 'count', restOf(-100, o));
    r.measure();
    r.frame(frameOf(3, { q: 0.5, pos: [0, 0, 0], inn: [1, 1, 0.5], lead: [0, 0, 1], sigma: 0.5 }));
    expect(wOf(key(host, 'i2'))).toBe('20px');
    expect(wOf(key(host, 'sign'))).toBe('10px');
    expect(wOf(key(host, 'suf'))).toBe('30px');
  });

  it.each([2, 0.5])('measures a leaving token in layout px under scale(%s)', (scale) => {
    stubGeometry({ perChar: 10, scale, computed: true });
    const o = { suffix: ' pts' };
    const { r, host } = setup(restOf(-5, o));
    const suf = key(host, 'suf');
    const sign = key(host, 'sign');
    r.begin(motionOf(layoutOf(shapeOf(-5, o), o), layoutOf(shapeOf(5))), 'count', restOf(5));
    r.measure();
    r.frame(frameOf(1, { q: 0.25, pos: [3], sigma: 0.4 }));
    expect(wOf(suf)).toBe('41px');
    expect(wOf(sign)).toBe('11px');
  });

  it('a host hidden (display: none) at measure time is not measured as 0 px; the next measure() measures it', () => {
    const geo = stubGeometry({ col: 20, perChar: 10, computed: true });
    const o = { suffix: ' kg' };
    const { r, host } = setup(restOf(99));
    geo.hidden = true;
    r.begin(motionOf(layoutOf(shapeOf(99)), layoutOf(shapeOf(-100, o), o)), 'count', restOf(-100, o));
    r.measure();
    const f = frameOf(3, { q: 0.5, pos: [0, 0, 0], inn: [1, 1, 0.5], lead: [0, 0, 1], sigma: 0.5 });
    r.frame(f);
    for (const k of ['i2', 'sign', 'suf']) expect(wOf(key(host, k))).toBe('');
    geo.hidden = false;
    r.measure();
    r.frame(f);
    expect(wOf(key(host, 'i2'))).toBe('20px');
    expect(wOf(key(host, 'sign'))).toBe('10px');
    expect(wOf(key(host, 'suf'))).toBe('30px');
  });

  it('measure() reads nothing once the motion is measured, until the next begin()', () => {
    const geo = stubGeometry({ col: 20, perChar: 10, computed: true });
    const { r } = setup(restOf(-99));
    r.begin(motion(-99, 100), 'count', restOf(100));
    r.measure();
    const reads = geo.boxes.length;
    expect(reads).toBeGreaterThan(0);
    r.measure();
    r.measure();
    expect(geo.boxes.length).toBe(reads);
    r.begin(motion(100, 1000), 'count', restOf(1000));
    r.measure();
    expect(geo.boxes.length).toBeGreaterThan(reads);
  });

  it('without a measure, collapsed nodes keep the 0px fallback (no --rn-w)', () => {
    const { r, host } = setup(restOf(9));
    r.begin(motion(9, 10), 'count', restOf(10));
    r.frame(frameOf(2, { pos: [9.5, 0.5], inn: [1, 0.5], lead: [0, 1] }));
    expect(wOf(key(host, 'i1'))).toBe('');
    expect(inOf(key(host, 'i1'))).toBe('0.5000');
  });
});

describe('columns renderer: frame()', () => {
  it('writes translateY(-10·mod10(pos)%) with 3 decimals', () => {
    const { r, host } = setup(restOf(10));
    r.begin(motion(10, 30), 'count', restOf(30));
    r.frame(frameOf(2, { pos: [14.2, -0.5] }));
    expect(transformOf(key(host, 'i0'))).toBe('translateY(-42.000%)');
    expect(transformOf(key(host, 'i1'))).toBe('translateY(-95.000%)');
    r.frame(frameOf(2, { pos: [1 / 3, 20] }));
    expect(transformOf(key(host, 'i0'))).toBe('translateY(-3.333%)');
    expect(transformOf(key(host, 'i1'))).toBe('translateY(0.000%)');
  });

  it('count: data-digit = round(pos) mod 10, written only when it changes (S6)', () => {
    const { r, host } = setup(restOf(10));
    r.begin(motion(10, 30), 'count', restOf(30));
    const i0 = key(host, 'i0');
    const spy = vi.spyOn(i0, 'setAttribute');
    r.frame(frameOf(2, { pos: [0.4, 1] }));
    r.frame(frameOf(2, { pos: [0.45, 1.2] }));
    expect(spy.mock.calls.filter((c) => c[0] === 'data-digit')).toHaveLength(0);
    r.frame(frameOf(2, { pos: [9.6, 1.4] }));
    expect(i0.getAttribute('data-digit')).toBe('0');
    r.frame(frameOf(2, { pos: [0.6, 1.6] }));
    expect(i0.getAttribute('data-digit')).toBe('1');
    expect(key(host, 'i1').getAttribute('data-digit')).toBe('2');
    expect(spy.mock.calls.filter((c) => c[0] === 'data-digit')).toHaveLength(1);
  });

  it('toggles data-rn-lead from fs.lead and drives --rn-in from fs.inn', () => {
    const { r, host } = setup(restOf(5));
    r.begin(motion(5, 120), 'count', restOf(120));
    const [i2, i1] = [key(host, 'i2'), key(host, 'i1')];
    r.frame(frameOf(3, { pos: [6, 0.5, 0.1], inn: [1, 0.5, 0.1], lead: [0, 1, 1] }));
    expect(i1.hasAttribute('data-rn-lead')).toBe(true);
    expect(inOf(i1)).toBe('0.5000');
    r.frame(frameOf(3, { pos: [8, 1.2, 0.6], inn: [1, 1, 0.6], lead: [0, 0, 1] }));
    expect(i1.hasAttribute('data-rn-lead')).toBe(false);
    expect(i1.hasAttribute('data-rn-in')).toBe(false);
    expect(i1.hasAttribute('style')).toBe(false);
    expect(i2.hasAttribute('data-rn-lead')).toBe(true);
    expect(inOf(i2)).toBe('0.6000');
  });

  it('drives the sign by sigma, separators by their place and the overflow token by ovf', () => {
    const o = { group: ',', max: 9999 };
    const { r, host } = setup(restOf(999, o));
    r.begin(motion(999, -12000, o), 'count', restOf(-12000, o));
    r.frame(frameOf(4, { q: 0.5, pos: [0, 0, 0, 0.7], inn: [1, 1, 1, 0.7], lead: [0, 0, 0, 1], sigma: 0.25, ovf: 0.125 }));
    expect(inOf(key(host, 'sign'))).toBe('0.2500');
    expect(inOf(key(host, 'g3'))).toBe('0.7000');
    expect(inOf(key(host, 'ovf'))).toBe('0.1250');
    r.frame(frameOf(4, { q: 1, pos: [9, 9, 9, 9], inn: [1, 1, 1, 1], sigma: 1, ovf: 1 }));
    for (const k of ['sign', 'g3', 'ovf', 'i3']) expect(key(host, k).hasAttribute('data-rn-in'), k).toBe(false);
  });

  it('never formats text per frame', () => {
    const o = { prefix: '≈ ', suffix: ' pts', group: ',' };
    const { r, host } = setup(restOf(999, o));
    r.begin(motion(999, 1500, o), 'count', restOf(1500, o));
    const spy = vi.spyOn(Node.prototype, 'textContent', 'set');
    r.frame(frameOf(4, { pos: [0.4, 0.4, 9.4, 0.9], inn: [1, 1, 1, 0.9], lead: [0, 0, 0, 1] }));
    r.frame(frameOf(4, { pos: [0.4, 0.4, 3.4, 1], inn: [1, 1, 1, 1] }));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('columns renderer: rest()', () => {
  it('leaves the exact final DOM: no inline style, data-rn-in or data-rn-lead', () => {
    const o = { group: ',', max: 9999, prefix: '≈ ' };
    const { r, host } = setup(restOf(5, o));
    r.begin(motion(5, -12000, o), 'count', restOf(-12000, o));
    r.frame(frameOf(4, { q: 0.4, pos: [2.2, 3.3, 4.4, 0.5], inn: [1, 0.9, 0.5, 0.2], lead: [0, 1, 1, 1], reel: [1, 0, 0, 0], sigma: 0.3, ovf: 0.4 }));
    r.rest(restOf(-12000, o));
    expectClean(host);
    expect(keys(host)).toEqual(['pre', 'sign', 'i3', 'g3', 'i2', 'i1', 'i0', 'ovf']);
    expect(digits(host)).toBe('9999');
    for (const c of host.querySelectorAll('.rn-col')) {
      expect(c.querySelector('.rn-sizer')!.textContent).toBe('9');
    }
    expect(host.textContent!.startsWith('≈ −')).toBe(true);
  });

  it('removes nodes that are no longer in the layout and resets displayed()', () => {
    const { r, host } = setup(restOf(-1000));
    r.begin(motion(-1000, 5), 'count', restOf(5));
    r.frame(frameOf(4, { q: 0.5, pos: [3, 5, 5, 0.5], inn: [1, 0.5, 0.5, 0.5], lead: [0, 1, 1, 1], reel: [1, 0, 0, 0], sigma: 0.5 }));
    expect(r.displayed()).toEqual({ pos: [3, 5, 5, 0.5], inn: [1, 0.5, 0.5, 0.5], sigma: 0.5, ovf: 0, reel: [true, false, false, false] });
    r.rest(restOf(5));
    expect(keys(host)).toEqual(['i0']);
    expect(r.displayed()).toEqual({ pos: [5], inn: [1], sigma: 0, ovf: 0, reel: [false] });
    expectClean(host);
  });
});

describe('columns renderer: displayed()', () => {
  it('reports the channels on screen, at rest and mid-motion', () => {
    const o = { max: 99 };
    const { r } = setup(restOf(-150, o));
    expect(r.displayed()).toEqual({ pos: [9, 9], inn: [1, 1], sigma: 1, ovf: 1, reel: [false, false] });
    r.begin(motion(-150, 20, o), 'count', restOf(20, o));
    // before the first frame: pinned positions, nothing changed
    expect(r.displayed()).toEqual({ pos: [9, 9], inn: [1, 1], sigma: 1, ovf: 1, reel: [false, false] });
    r.frame(frameOf(2, { q: 0.3, pos: [12.5, 7.25], reel: [1, 0], sigma: 0.6, ovf: 0.2 }));
    const d = r.displayed()!;
    expect(d.pos[0]).toBeCloseTo(2.5, 12);
    expect(d.pos[1]).toBeCloseTo(7.25, 12);
    expect({ ...d, pos: undefined }).toEqual({ pos: undefined, inn: [1, 1], sigma: 0.6, ovf: 0.2, reel: [true, false] });
  });
});

describe('columns renderer: retargets', () => {
  it('owned nodes absent from the motion layout fade from their value at begin and are removed only by rest()', () => {
    const { r, host } = setup(restOf(5));
    r.begin(motion(5, -5), 'count', restOf(-5));
    const sign = key(host, 'sign');
    r.frame(frameOf(1, { q: 0.3, pos: [2], sigma: 0.4 }));
    expect(inOf(sign)).toBe('0.4000');
    // retarget: the new motion layout (from a non-negative display shape) has no sign
    r.begin(motion(2, 7), 'count', restOf(7));
    expect(sign.isConnected).toBe(true);
    expect(keys(host)).toEqual(['sign', 'i0']);
    r.frame(frameOf(1, { q: 0.5, pos: [4], sigma: 0.9 }));
    expect(inOf(sign)).toBe('0.2000');
    r.frame(frameOf(1, { q: 1, pos: [7] }));
    expect(inOf(sign)).toBe('0.0000');
    expect(sign.isConnected).toBe(true);
    r.rest(restOf(7));
    expect(sign.isConnected).toBe(false);
    expectClean(host);
  });

  it('an absent column keeps its place among its neighbors', () => {
    const { r, host } = setup(restOf(100, { suffix: '%' }));
    const i2 = key(host, 'i2');
    r.begin(motion(100, 5, { suffix: '%' }), 'count', restOf(5, { suffix: '%' }));
    r.frame(frameOf(3, { q: 0.5, pos: [3, 5, 0.5], inn: [1, 0.5, 0.5], lead: [0, 1, 1] }));
    // retarget from a display where only i1 is still counted
    r.begin(motionOf(layoutOf(shapeOf(10), { suffix: '%' }), layoutOf(shapeOf(8), { suffix: '%' })), 'count', restOf(8, { suffix: '%' }));
    expect(keys(host)).toEqual(['i2', 'i1', 'i0', 'suf']);
    r.frame(frameOf(2, { q: 0.5, pos: [6, 0.2], inn: [1, 0.2], lead: [0, 1] }));
    expect(inOf(i2)).toBe('0.2500');
    // its position stays pinned
    expect(transformOf(i2)).toBe('translateY(-5.000%)');
    r.rest(restOf(8, { suffix: '%' }));
    expect(keys(host)).toEqual(['i0', 'suf']);
  });

  it('a node that comes back in a retarget is driven by its channel again', () => {
    const { r, host } = setup(restOf(100));
    const i2 = key(host, 'i2');
    r.begin(motion(100, 5), 'count', restOf(5));
    r.frame(frameOf(3, { q: 0.5, pos: [3, 5, 0.5], inn: [1, 0.5, 0.5], lead: [0, 1, 1] }));
    r.begin(motion(50, 300), 'count', restOf(300));
    r.frame(frameOf(3, { q: 0.5, pos: [0, 0, 1.5], inn: [1, 1, 1], lead: [0, 0, 0] }));
    expect(key(host, 'i2')).toBe(i2);
    expect(i2.hasAttribute('data-rn-in')).toBe(false);
    r.rest(restOf(300));
    expect(digits(host)).toBe('300');
    expectClean(host);
  });
});

describe('columns renderer: positive signs (signDisplay "always"/"exceptZero")', () => {
  it('fades a positive sign by presence and swaps the sign text at A = 0', () => {
    const o = { plus: '+' };
    const { r, host } = setup(restOf(-5, o));
    const sign = key(host, 'sign');
    r.begin(motion(-5, 5, o), 'count', restOf(5, o));
    r.frame(frameOf(1, { q: 0.3, A: -2, pos: [2], sigma: 1 }));
    expect(sign.textContent).toBe('−');
    expect(sign.hasAttribute('data-rn-in')).toBe(false);
    expect(r.displayed()!.sigma).toBe(1);
    r.frame(frameOf(1, { q: 0.7, A: 2, pos: [2], sigma: 0 }));
    expect(sign.textContent).toBe('+');
    expect(sign.hasAttribute('data-rn-in')).toBe(false);
    expect(r.displayed()!.sigma).toBe(0);
    r.rest(restOf(5, o));
    expect(key(host, 'sign')).toBe(sign);
    expect(sign.textContent).toBe('+');

    r.begin(motion(5, 0, o), 'count', restOf(0, o));
    r.frame(frameOf(1, { q: 0.25, A: 4, pos: [4] }));
    expect(inOf(sign)).toBe('0.7500');
    r.rest(restOf(0, o));
    expect(sign.isConnected).toBe(false);
  });
});

describe('columns renderer: tokens tied to the sign (accounting)', () => {
  it('fades sign-tied literals by sigma and reports them as the sign channel', () => {
    const paren = (side: 'pre' | 'post', text: string): Token => ({ kind: 'static', key: `lit:${side}:0`, role: 'literal', text });
    const neg: NumberLayout = { key: 'neg', tokens: [paren('pre', '('), { kind: 'digit', key: 'i0', place: 0 }, paren('post', ')')] };
    const pos: NumberLayout = { key: 'pos', tokens: [{ kind: 'digit', key: 'i0', place: 0 }] };
    const rest = (A: number, layout: NumberLayout): RestState => ({ A, overflow: false, layout, text: '', numericText: '', glyphs: null });
    const { r, host } = setup(rest(-5, neg));
    expect(host.textContent!.replace(/0123456789/g, '')).toBe('(5)');
    const m: MotionLayout = {
      tokens: [
        { token: neg.tokens[0], presence: 'leave', tie: { kind: 'sign' } },
        { token: neg.tokens[1], presence: 'both', tie: null },
        { token: neg.tokens[2], presence: 'leave', tie: { kind: 'sign' } }
      ]
    };
    r.begin(m, 'count', rest(5, pos));
    r.frame(frameOf(1, { q: 0.5, A: -1, pos: [1], sigma: 0.4 }));
    expect(inOf(key(host, 'lit:pre:0'))).toBe('0.4000');
    expect(inOf(key(host, 'lit:post:0'))).toBe('0.4000');
    expect(r.displayed()!.sigma).toBe(0.4);
    r.rest(rest(5, pos));
    expect(keys(host)).toEqual(['i0']);
    expectClean(host);
  });
});

describe('columns renderer: static tokens', () => {
  it('renders .rn-static[data-rn-part][data-rn-key] tokens in layout order', () => {
    const o = { f: 2, prefix: '≈ ', suffix: ' pts', group: ',', max: 99999, overflowText: '+' };
    const { host } = setup(restOf(-12345678, o));
    expect(keys(host)).toEqual(['pre', 'sign', 'i4', 'i3', 'g3', 'i2', 'i1', 'i0', 'dec', 'f1', 'f2', 'ovf', 'suf']);
    const parts = Array.from(host.querySelectorAll(':scope > .rn-static')).map((s) => [s.getAttribute('data-rn-part'), s.textContent, s.getAttribute('aria-hidden')]);
    expect(parts).toEqual([
      ['prefix', '≈ ', 'true'], ['group', ',', 'true'], ['decimal', '.', 'true'], ['overflow', '+', 'true'], ['suffix', ' pts', 'true']
    ]);
    // clamped to max (99999.00) with the overflow suffix
    expect(host.textContent!.replace(/0123456789/g, '')).toBe('≈ −99,999.00+ pts');
  });

  it('rest() rewrites a token whose text or role changed', () => {
    const { r, host } = setup(restOf(5, { suffix: ' kg' }));
    const suf = key(host, 'suf');
    r.rest(restOf(5, { suffix: ' lb' }));
    expect(key(host, 'suf')).toBe(suf);
    expect(suf.textContent).toBe(' lb');
  });
});

describe('columns renderer: native digits', () => {
  it('uses RestState.glyphs for the cells, the sizer and the wrap cell; data-digit stays ASCII', () => {
    const { r, host } = setup(restOf(305, { glyphs: ARABIC }));
    const c = key(host, 'i2');
    expect(c.getAttribute('data-digit')).toBe('3');
    expect(c.querySelector('.rn-sizer')!.textContent).toBe('٣');
    expect(Array.from(c.querySelectorAll('.rn-cell')).map((x) => x.textContent).join('')).toBe(ARABIC.join(''));
    expect(scaleOf(c).getAttribute('data-rn-zero')).toBe('٠');

    // entering columns use the target glyphs
    r.begin(motion(305, 1305), 'count', restOf(1305, { glyphs: ARABIC }));
    expect(scaleOf(key(host, 'i3')).getAttribute('data-rn-zero')).toBe('٠');
    r.rest(restOf(1305, { glyphs: ARABIC }));

    // a layout change back to ASCII rewrites the cells
    r.setFormatter(fmtOf(null));
    r.rest(restOf(1305));
    expect(host.innerHTML).toBe(col12(1, 'i3') + col12(3, 'i2') + col12(0, 'i1') + col12(5, 'i0'));
  });
});

describe('columns renderer: SSR adoption', () => {
  it('hides a direct [data-rn-ssr] child, renders after it and restores it on destroy', () => {
    const host = makeHost('span');
    host.innerHTML = '<span class="rn-ssr" data-rn-ssr="">1,234</span>';
    const original = host.innerHTML;
    const fallback = host.firstElementChild!;
    const { r } = setup(restOf(1234), host, true);
    expect(fallback.hasAttribute('hidden')).toBe(true);
    expect(host.firstElementChild).toBe(fallback);
    expect(keys(host)).toEqual(['i3', 'i2', 'i1', 'i0']);
    expect(fallback.textContent).toBe('1,234');
    r.destroy();
    expect(host.innerHTML).toBe(original);
  });

  it('keeps an already hidden fallback hidden, ignores nested ones and adopt = false', () => {
    const a = makeHost('span');
    a.innerHTML = '<span class="rn-ssr" data-rn-ssr hidden>1</span>';
    setup(restOf(1), a, true).r.destroy();
    expect(a.firstElementChild!.hasAttribute('hidden')).toBe(true);

    const b = makeHost('span');
    b.innerHTML = '<b><span class="rn-ssr" data-rn-ssr>1</span></b>';
    setup(restOf(1), b, true);
    expect(b.querySelector('[data-rn-ssr]')!.hasAttribute('hidden')).toBe(false);

    const c = makeHost('span');
    c.innerHTML = '<span class="rn-ssr" data-rn-ssr>1</span>';
    setup(restOf(1), c, false);
    expect(c.firstElementChild!.hasAttribute('hidden')).toBe(false);
  });

  const fallbackEl = (text: string): HTMLElement => {
    const el = document.createElement('span');
    el.className = 'rn-ssr';
    el.setAttribute('data-rn-ssr', '');
    el.textContent = text;
    return el;
  };

  it.each(['rest', 'begin'] as const)('adopts a fallback added after mount at the next %s() and moves the block after it', (call) => {
    const host = makeHost('span');
    const { r } = setup(restOf(42), host, true);
    const fallback = host.appendChild(fallbackEl('42'));
    if (call === 'rest') r.rest(restOf(42));
    else r.begin(motion(42, 43), 'count', restOf(43));
    expect(fallback.hasAttribute('hidden')).toBe(true);
    expect(host.firstElementChild).toBe(fallback);
    expect(keys(host)).toEqual(['i1', 'i0']);
    r.destroy();
    expect(fallback.hasAttribute('hidden')).toBe(false);
    expect(host.childNodes.length).toBe(1);
  });

  it('while the document is loading, adopts a fallback the parser appends after mount (no further call)', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    const host = makeHost('rolling-number');
    setup(restOf(42), host, true);
    const fallback = host.appendChild(fallbackEl('42'));
    host.appendChild(document.createTextNode('\n'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fallback.hasAttribute('hidden')).toBe(true);
    expect(host.firstElementChild).toBe(fallback);
    expect(keys(host)).toEqual(['i1', 'i0']);
    expect(host.lastChild!.nodeType).toBe(3);
  });

  it('adopts at most one fallback, and never with adopt = false', () => {
    const a = makeHost('span');
    a.appendChild(fallbackEl('1'));
    const { r } = setup(restOf(1), a, true);
    const late = a.appendChild(fallbackEl('2'));
    r.rest(restOf(1));
    expect(late.hasAttribute('hidden')).toBe(false);

    const b = makeHost('span');
    const rb = setup(restOf(1), b, false).r;
    const other = b.appendChild(fallbackEl('1'));
    rb.rest(restOf(1));
    expect(other.hasAttribute('hidden')).toBe(false);
  });
});

describe('columns renderer: realm safety', () => {
  it('creates every node from the given document', () => {
    const doc = document.implementation.createHTMLDocument('other');
    const host = doc.createElement('span');
    doc.body.appendChild(host);
    const r = createColumnsRenderer(host, doc, fmtOf());
    r.mount(restOf(-12, { suffix: '!' }), false);
    for (const el of host.querySelectorAll('*')) expect(el.ownerDocument).toBe(doc);
    r.begin(motion(-12, 345, { suffix: '!' }), 'count', restOf(345, { suffix: '!' }));
    r.rest(restOf(345, { suffix: '!' }));
    for (const el of host.querySelectorAll('*')) expect(el.ownerDocument).toBe(doc);
    r.destroy();
    expect(host.childNodes.length).toBe(0);
  });
});
