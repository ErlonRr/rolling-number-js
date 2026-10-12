import {
  AfterViewInit,
  Directive,
  ElementRef,
  EventEmitter,
  Injector,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  PLATFORM_ID,
  SimpleChanges,
  inject
} from '@angular/core';
// Namespace import: `afterNextRender` only exists since Angular 16.2, and a
// named import of a missing export would fail to link on 16.0/16.1.
import * as ng from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RN_DEFAULTS, RollingNumberCore } from '../core';
import { OPTION_KEYS, RN_DEFAULTS_13, resolveOptions } from '../options';
import type { NormalizedOptions, OptionKey } from '../internal/contracts';
import type {
  RollingNumberEasing,
  RollingNumberEvent,
  RollingNumberFormat,
  RollingNumberLabelInfo,
  RollingNumberLive,
  RollingNumberMode,
  RollingNumberSetValueOptions,
  RollingNumberSettled,
  RollingNumberTrigger,
  RollingNumberUpdate
} from '../types';

/**
 * Coerces a boolean-ish input the way a boolean attribute would:
 * `null`/`undefined` → true (the default), `''` (bare attribute) → true,
 * `'false'` / `'0'` / `'off'` / `0` → false.
 */
function coerceBool(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return !(v === 'false' || v === '0' || v === 'off');
  }
  if (typeof value === 'number') return value !== 0;
  return Boolean(value);
}

/** Option key of an input property: `valueInput` → `value`, `rnPrefixText` → `prefixText`, `pad` → `pad`. */
function optionKey(name: string): OptionKey | null {
  const key = name === 'valueInput' ? 'value' : /^rn[A-Z]/.test(name) ? name[2].toLowerCase() + name.slice(3) : name;
  return (OPTION_KEYS as readonly string[]).includes(key) ? (key as OptionKey) : null;
}

/** RxJS 7 has `observed`; RxJS 6 only `observers`. */
function observed(emitter: EventEmitter<RollingNumberEvent>): boolean {
  const s = emitter as unknown as { observed?: boolean; observers?: ArrayLike<unknown> };
  return s.observed ?? !!s.observers?.length;
}

/**
 * Angular directive that turns its host into a rolling number.
 *
 * Inputs accept numbers or strings (static attributes such as `pad="3"` or
 * `interpolate="false"` work), and `null`/`undefined` fall back to the defaults.
 * The core is only created in the browser, and all of its work (rAF frames,
 * setters, events, destroy) runs outside the Angular zone; `rnStart`/`rnEnd`
 * re-enter the zone only when something subscribed to them.
 *
 * | Input                          | Accepts                               | Default  | Notes                                     |
 * |--------------------------------|---------------------------------------|----------|-------------------------------------------|
 * | `rollingNumber` (value)        | `number \| string \| null`             | `0`      | the target value                          |
 * | `pad` / `rnPad`                | `number \| string \| null`             | `1`      | min integer digits, zero-padded, 1..64    |
 * | `max` / `rnMax`                | `number \| string \| null`             | `null`   | display clamp (e.g. 99), null = none      |
 * | `interpolate` / `rnInterpolate`| `boolean \| string \| number`          | `true`   | `'false'`/`'0'`/`'off'`/`0` → false        |
 * | `duration` / `rnDuration`      | `number \| string \| null`             | unset    | ms; unset = 400 when counting, CSS roll   |
 * | `rnEasing`                     | `RollingNumberEasing \| null`          | unset    | preset, CSS easing or function            |
 * | `rnDecimals`                   | `number \| string \| null`             | auto     | fixed fraction digits, 0..20              |
 * | `rnLocale`                     | `string \| string[] \| null`           | `null`   | switches on Intl formatting               |
 * | `rnFormat`                     | `RollingNumberFormat \| string \| null` | `null`   | object or its JSON text                   |
 * | `rnPrefixText`/`rnSuffixText`  | `string \| null`                       | `''`     | static text around the number             |
 * | `rnOverflowSuffix`             | `string \| null`                       | `''`     | shown when clamped by `max` (`'+'`)        |
 * | `rnMode`                       | `'auto' \| 'columns' \| 'text'`         | `'auto'` | renderer                                  |
 * | `rnFrom`                       | `number \| string \| null`             | `null`   | creation-only intro start value           |
 * | `rnTrigger`                    | `'immediate' \| 'visible'`             | `'immediate'` | `visible`: animate once on screen    |
 * | `rnLabel`                      | `string \| ((info) => string) \| null`  | default  | accessible name, `{value}` placeholder    |
 * | `rnLive`                       | `'off' \| 'polite' \| 'assertive' \| ''` | `'off'` | bare `rnLive` → `'polite'`               |
 * | `rnInjectStyles`               | `boolean \| string`                    | `true`   | per-instance style injection switch       |
 * | `rnTarget`                     | `'auto' \| 'host' \| string`            | `'auto'` | where the counter renders (see below)     |
 *
 * Outputs: `rnStart` and `rnEnd` emit the `rn-start`/`rn-end` CustomEvent
 * (`$event.detail.value`). The native `(rn-start)`/`(rn-end)` bindings work too.
 *
 * Target (`rnTarget`): `'auto'` renders into the host, except hosts whose tag
 * name contains `-input` (e.g. PrimeNG `<p-inputNumber>`), which get an inner
 * `<span class="rn-angular-target">` (1.x behavior). `'host'` always uses the
 * host. Any other value is a CSS selector resolved inside the host after the
 * view is initialized (e.g. `rnTarget="input"`); changing it re-creates the counter.
 *
 * Template reference: `#c="rollingNumber"` exposes `setValue`, `whenSettled`,
 * `finish`, `getDisplayValue` and `core`.
 *
 * SSR fallback (template-owned): put `<span class="rn-ssr" data-rn-ssr>{{ n }}</span>`
 * inside the host. The server renders the number as text; in the browser the
 * counter is created after the first render (`afterNextRender`, Angular ≥ 16.2)
 * and hides that child.
 *
 * Usage: add `RollingNumberDirective` to the `imports` of a standalone
 * component (or of an NgModule), then use it in the template. Styles are
 * injected automatically; `rolling-number/style.css` can still be added to
 * the global styles.
 *
 * ```ts
 * import { RollingNumberDirective } from 'rolling-number/angular';
 * // component metadata: imports: [RollingNumberDirective]
 * ```
 *
 * @example
 * ```html
 * <span [rollingNumber]="count" [pad]="2" [max]="99" [duration]="600"></span>
 * <span rollingNumber="42" pad="3" interpolate="false"></span>
 * <span [rollingNumber]="price" rnLocale="de-DE" [rnFormat]="{ style: 'currency', currency: 'EUR' }"></span>
 * <span [rollingNumber]="n" (rnEnd)="done($event.detail.value)" #c="rollingNumber"></span>
 * <button (click)="c.setValue(0, { motion: 'none' })">Reset</button>
 * ```
 */
@Directive({
  selector: '[rollingNumber]',
  exportAs: 'rollingNumber',
  standalone: true
})
export class RollingNumberDirective implements OnInit, AfterViewInit, OnChanges, OnDestroy {
  /** Normalized options; `null` = unset/auto where the core allows it (S5: duration/easing). */
  private readonly o: NormalizedOptions = { ...RN_DEFAULTS_13 };
  private _target = 'auto';

  /** Stores a normalized option (constructor semantics: null/undefined/'' → default). */
  private store<K extends OptionKey>(key: K, raw: unknown): void {
    this.o[key] = resolveOptions({ [key]: raw } as RollingNumberUpdate)[key];
  }

  /**
   * The number to display (`[rollingNumber]="count"` or `rollingNumber="42"`).
   * Numeric strings are accepted; `null`/`undefined`/`''` → `0`, non-numeric → `0`.
   * Displayed rounded to `rnDecimals` places (integers by default).
   * @default 0
   */
  @Input('rollingNumber')
  get valueInput(): number | string {
    return this.o.value;
  }
  set valueInput(value: number | string | null | undefined) {
    this.store('value', value);
  }

  /**
   * Minimum number of integer digits, zero-padded on the left (1..64;
   * `pad="3"` shows `7` as `007`). `null`/`undefined`/non-numeric → `1`.
   * Same field as `rnPad`.
   * @default 1
   */
  @Input()
  get pad(): number {
    return this.o.pad;
  }
  set pad(value: number | string | null | undefined) {
    this.store('pad', value);
  }

  /** Alias of `pad` (PrimeNG-safe name). @default 1 */
  @Input()
  get rnPad(): number {
    return this.o.pad;
  }
  set rnPad(value: number | string | null | undefined) {
    this.store('pad', value);
  }

  /**
   * Upper bound of the displayed absolute value (e.g. `99` for a badge);
   * `null`, `undefined`, `''`, non-numeric or a negative number means no limit.
   * Same field as `rnMax`.
   * @default null
   */
  @Input()
  get max(): number | null {
    return this.o.max;
  }
  set max(value: number | string | null | undefined) {
    this.store('max', value);
  }

  /** Alias of `max` (PrimeNG-safe name). @default null */
  @Input()
  get rnMax(): number | null {
    return this.o.max;
  }
  set rnMax(value: number | string | null | undefined) {
    this.store('max', value);
  }

  /**
   * `true`: value changes count through the intermediate numbers; `false`:
   * each digit rolls straight to its new digit. Works as a boolean attribute:
   * bare `interpolate` → true, `interpolate="false"` (or `'0'`, `'off'`, `0`)
   * → false. `null`/`undefined` → `true`. Same field as `rnInterpolate`.
   * @default true
   */
  @Input()
  get interpolate(): boolean {
    return this.o.interpolate;
  }
  set interpolate(value: boolean | string | number | null | undefined) {
    this.o.interpolate = coerceBool(value);
  }

  /** Alias of `interpolate`. @default true */
  @Input()
  get rnInterpolate(): boolean {
    return this.o.interpolate;
  }
  set rnInterpolate(value: boolean | string | number | null | undefined) {
    this.o.interpolate = coerceBool(value);
  }

  /**
   * Duration of animated changes in milliseconds (`duration="600"` or
   * `[duration]="600"`); a set duration times counting and rolling.
   * `null`/`undefined`/`''`/non-numeric → unset: counting takes 400 ms and
   * rolling follows `--rn-duration`. Reads 400 when unset (see `rnDuration`
   * for the stored value). Same field as `rnDuration`.
   * @default 400
   */
  @Input()
  get duration(): number {
    return this.o.duration ?? RN_DEFAULTS.duration;
  }
  set duration(value: number | string | null | undefined) {
    this.store('duration', value);
  }

  /** Alias of `duration`; reads `null` while unset (CSS-driven timing). @default null */
  @Input()
  get rnDuration(): number | null {
    return this.o.duration;
  }
  set rnDuration(value: number | string | null | undefined) {
    this.store('duration', value);
  }

  /**
   * Easing of animated changes: a preset (`'ease-out-expo'`, `'odometer'`, …),
   * a CSS easing (`cubic-bezier(…)`, `linear(…)`, `steps(…)`) or a function.
   * `null`/`undefined` → unset (`ease-out-cubic` when counting, `--rn-easing` when rolling).
   * @default null
   */
  @Input()
  get rnEasing(): RollingNumberEasing | null {
    return this.o.easing;
  }
  set rnEasing(value: RollingNumberEasing | null | undefined) {
    this.store('easing', value);
  }

  /**
   * Fixed fraction digits, 0..20 (`rnDecimals="2"`). `null`/`''` → auto
   * (the currency's digits with a currency format, else 0).
   * @default null
   */
  @Input()
  get rnDecimals(): number | null {
    return this.o.decimals;
  }
  set rnDecimals(value: number | string | null | undefined) {
    this.store('decimals', value);
  }

  /**
   * BCP 47 locale(s): `'de-DE'`, `'de-CH, en'` or an array. Setting it
   * switches on Intl formatting. Reads the normalized list.
   * @default null
   */
  @Input()
  get rnLocale(): readonly string[] | null {
    return this.o.locale;
  }
  set rnLocale(value: string | readonly string[] | null | undefined) {
    this.store('locale', value);
  }

  /**
   * Intl number formatting, as an object (`[rnFormat]="{ style: 'currency', currency: 'EUR' }"`)
   * or its JSON text (`rnFormat='{"style":"percent"}'`; invalid JSON is ignored with a warning).
   * @default null
   */
  @Input()
  get rnFormat(): RollingNumberFormat | null {
    return this.o.format;
  }
  set rnFormat(value: RollingNumberFormat | string | null | undefined) {
    this.store('format', value);
  }

  /** Static text before the number (and its sign). Included in the label. @default '' */
  @Input()
  get rnPrefixText(): string {
    return this.o.prefixText;
  }
  set rnPrefixText(value: string | null | undefined) {
    this.store('prefixText', value);
  }

  /** Static text after the number. Included in the label. @default '' */
  @Input()
  get rnSuffixText(): string {
    return this.o.suffixText;
  }
  set rnSuffixText(value: string | null | undefined) {
    this.store('suffixText', value);
  }

  /** Shown after the digits when the value exceeds `max`, e.g. `'+'` → "99+". @default '' */
  @Input()
  get rnOverflowSuffix(): string {
    return this.o.overflowSuffix;
  }
  set rnOverflowSuffix(value: string | null | undefined) {
    this.store('overflowSuffix', value);
  }

  /**
   * Renderer: `'columns'` (rolling digit columns), `'text'` (plain text, for
   * form controls and SVG text) or `'auto'` (chosen from the target element).
   * @default 'auto'
   */
  @Input()
  get rnMode(): RollingNumberMode {
    return this.o.mode;
  }
  set rnMode(value: RollingNumberMode | null | undefined) {
    this.store('mode', value);
  }

  /** Value shown when the counter is created; it then animates to the value. Creation-only. @default null */
  @Input()
  get rnFrom(): number | null {
    return this.o.from;
  }
  set rnFrom(value: number | string | null | undefined) {
    this.store('from', value);
  }

  /** `'visible'`: animations wait until the counter is on screen. @default 'immediate' */
  @Input()
  get rnTrigger(): RollingNumberTrigger {
    return this.o.trigger;
  }
  set rnTrigger(value: RollingNumberTrigger | null | undefined) {
    this.store('trigger', value);
  }

  /**
   * Accessible name: a string where `{value}` is replaced by the formatted
   * target (`rnLabel="{value} unread"`), or a function. `null`/`''` → the
   * formatted target.
   * @default null
   */
  @Input()
  get rnLabel(): string | ((info: RollingNumberLabelInfo) => string) | null {
    return this.o.label;
  }
  set rnLabel(value: string | ((info: RollingNumberLabelInfo) => string) | null | undefined) {
    this.store('label', value);
  }

  /** Announce each settled value to screen readers. Bare `rnLive` (or `true`) → `'polite'`. @default 'off' */
  @Input()
  get rnLive(): RollingNumberLive {
    return this.o.live;
  }
  set rnLive(value: RollingNumberLive | boolean | '' | null | undefined) {
    this.store('live', value);
  }

  /** Per-instance switch for automatic style injection; `rnInjectStyles="false"` opts out. @default true */
  @Input()
  get rnInjectStyles(): boolean {
    return this.o.injectStyles;
  }
  set rnInjectStyles(value: boolean | string | null | undefined) {
    this.o.injectStyles = coerceBool(value);
  }

  /**
   * Where the counter renders: `'auto'` (the host, or an inner span for
   * `*-input` hosts), `'host'`, or a CSS selector resolved inside the host
   * after the view is initialized (`rnTarget="input"`). Changing it
   * re-creates the counter. `null`/`''` → `'auto'`.
   * @default 'auto'
   */
  @Input()
  get rnTarget(): 'auto' | 'host' | (string & {}) {
    return this._target;
  }
  set rnTarget(value: 'auto' | 'host' | (string & {}) | null | undefined) {
    this._target = value || 'auto';
  }

  /** Emits the `rn-start` event when the display starts moving (`$event.detail.value`, `.from`, `.animated`). */
  @Output() readonly rnStart = new EventEmitter<RollingNumberEvent>();

  /** Emits the `rn-end` event when the display settled on the target. */
  @Output() readonly rnEnd = new EventEmitter<RollingNumberEvent>();

  private _core: RollingNumberCore | null = null;
  /** Element the core renders into. */
  private target: Element | null = null;
  /** Wrapper span created for `*-input` hosts, removed again on destroy. */
  private createdTarget: HTMLElement | null = null;
  /** A creation was attempted (ngOnInit, ngAfterViewInit or afterNextRender). */
  private created = false;
  /** Pending `afterNextRender` creation. */
  private renderRef: { destroy(): void } | null = null;
  private readonly zone = inject(NgZone);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  // Captured in the injection context: afterNextRender() is called later, from ngOnInit.
  private readonly injector = inject(Injector);

  constructor(private el: ElementRef<HTMLElement>) {}

  /** The live core (`null` on the server, before creation and after destroy). */
  get core(): RollingNumberCore | null {
    return this._core;
  }

  /**
   * Sets the target imperatively (`#c="rollingNumber"` then `c.setValue(10)`).
   * A later change of the bound `rollingNumber` value overrides it.
   *
   * @param value New target value.
   * @param animate `true` count, `false` roll, or per-call options (`{ motion: 'none' }`, `{ duration }`).
   * @returns Resolves when the target settles (`completed: false` when superseded, destroyed or without a core). Never rejects.
   */
  setValue(value: number, animate?: boolean | RollingNumberSetValueOptions): Promise<RollingNumberSettled> {
    this.store('value', value);
    const core = this._core;
    const v = this.o.value;
    return core
      ? this.zone.runOutsideAngular(() => core.setValue(v, animate))
      : Promise.resolve({ value: v, completed: false });
  }

  /**
   * Resolves when the current motion settles (immediately when idle).
   *
   * @returns `{ value, completed }`; `completed: false` without a core.
   */
  whenSettled(): Promise<RollingNumberSettled> {
    return this._core ? this._core.whenSettled() : Promise.resolve({ value: this.o.value, completed: false });
  }

  /** Jumps to the target now (final DOM, `rnEnd`). No-op when idle. */
  finish(): void {
    const core = this._core;
    if (core) this.zone.runOutsideAngular(() => core.finish());
  }

  /**
   * Value on screen (fractional mid-count).
   *
   * @returns The displayed value, or the target without a core.
   */
  getDisplayValue(): number {
    return this._core ? this._core.getDisplayValue() : this.o.value;
  }

  /** Creates the core (browser only), unless a selector target or an SSR fallback defers it. */
  ngOnInit(): void {
    // The core touches the DOM and schedules rAF: only create it in the browser.
    if (!this.isBrowser || this.selectorTarget()) return;
    if (this.el.nativeElement.querySelector(':scope>[data-rn-ssr]') && typeof ng.afterNextRender === 'function') {
      // Leave the server-rendered fallback alone until hydration and the first render are done.
      this.renderRef = ng.afterNextRender(() => {
        this.renderRef = null;
        this.create();
      }, { injector: this.injector });
      return;
    }
    this.create();
  }

  /** Creates the core when `rnTarget` is a selector (the host's content is rendered by now). */
  ngAfterViewInit(): void {
    if (this.isBrowser && !this.created && this.selectorTarget()) this.create();
  }

  /** Forwards changed inputs to the core; a changed `rnTarget` re-creates it. */
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['rnTarget'] && this.created) {
      this.teardown();
      this.create();
      return;
    }
    const core = this._core;
    if (!core) return;
    const update: Record<string, unknown> = {};
    for (const name in changes) {
      const key = optionKey(name);
      if (key) update[key] = this.o[key];
    }
    this.zone.runOutsideAngular(() => core.update(update as RollingNumberUpdate));
  }

  /** Destroys the core and removes the nodes the directive created. */
  ngOnDestroy(): void {
    this.renderRef?.destroy();
    this.renderRef = null;
    this.teardown();
  }

  private selectorTarget(): boolean {
    return this._target !== 'auto' && this._target !== 'host';
  }

  private create(): void {
    // `from` is an intro: a re-created counter (new rnTarget) shows the value directly.
    const options: RollingNumberUpdate = { ...this.o, from: this.created ? null : this.o.from };
    this.created = true;
    this.zone.runOutsideAngular(() => {
      const target = this.resolveTarget(this.el.nativeElement);
      if (!target) return;
      // Listeners are added outside the zone: events only re-enter it when an output is observed.
      target.addEventListener('rn-start', this.onEvent);
      target.addEventListener('rn-end', this.onEvent);
      this.target = target;
      this._core = new RollingNumberCore(target as HTMLElement, options);
    });
  }

  private readonly onEvent = (e: Event): void => {
    if (e.target !== this.target) return; // a nested counter's bubbling event
    const out = e.type === 'rn-start' ? this.rnStart : this.rnEnd;
    if (observed(out)) this.zone.run(() => out.emit(e as RollingNumberEvent));
  };

  private resolveTarget(el: HTMLElement): Element | null {
    const t = this._target;
    if (t === 'host') return el;
    if (t !== 'auto') {
      let found: Element | null = null;
      try {
        found = el.querySelector(t);
      } catch {
        // invalid selector: warned below
      }
      if (!found && typeof console !== 'undefined') {
        console.warn(`[RollingNumber] rnTarget "${t}" matches no element inside <${el.localName}>.`);
      }
      return found;
    }
    // 1.x heuristic: complex UI components such as PrimeNG <p-inputNumber>.
    if (el.tagName.toLowerCase().includes('-input')) {
      let targetSpan = el.querySelector<HTMLElement>('.rn-angular-target');
      if (!targetSpan) {
        targetSpan = el.ownerDocument.createElement('span');
        targetSpan.className = 'rn-angular-target';
        el.appendChild(targetSpan);
        this.createdTarget = targetSpan;
      }
      return targetSpan;
    }
    return el;
  }

  private teardown(): void {
    const { _core: core, target, createdTarget } = this;
    this._core = this.target = this.createdTarget = null;
    if (!core && !createdTarget) return;
    this.zone.runOutsideAngular(() => {
      target?.removeEventListener('rn-start', this.onEvent);
      target?.removeEventListener('rn-end', this.onEvent);
      core?.destroy();
      createdTarget?.remove();
    });
  }
}
