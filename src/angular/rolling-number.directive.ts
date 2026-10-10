import {
  Directive,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  SimpleChanges,
  inject
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RN_DEFAULTS, RollingNumberCore } from '../core';

/**
 * Coerces a boolean-ish input the way a boolean attribute would:
 * `''` (bare attribute) → true, `'false'` / `'0'` / `'off'` / `0` → false.
 */
function coerceInterpolate(value: unknown): boolean {
  if (value === null || value === undefined) return RN_DEFAULTS.interpolate;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return !(v === 'false' || v === '0' || v === 'off');
  }
  if (typeof value === 'number') return value !== 0;
  return Boolean(value);
}

/** Coerces a numeric input; null, undefined, blank and non-numeric input fall back. */
function coerceNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Coerces the `max` input; null, undefined, blank, non-numeric and negative
 * input mean "no max".
 */
function coerceMax(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Angular directive that turns its host into a rolling number.
 *
 * Inputs accept numbers or strings (static attributes such as `pad="3"` or
 * `interpolate="false"` work), and `null`/`undefined` fall back to the defaults.
 * The core is only created in the browser, and all of its work (rAF frames,
 * setters, destroy) runs outside the Angular zone.
 *
 * | Input                     | Accepts                          | Default | Notes                              |
 * |---------------------------|----------------------------------|---------|------------------------------------|
 * | `rollingNumber` (value)   | `number \| string \| null`        | `0`     | displayed rounded to an integer    |
 * | `pad`                     | `number \| string \| null`        | `1`     | min digits, zero-padded, 1..64     |
 * | `max`                     | `number \| string \| null`        | `null`  | display clamp (e.g. 99), null=none |
 * | `interpolate`             | `boolean \| string \| number`     | `true`  | `'false'`/`'0'`/`'off'`/`0` → false |
 * | `duration`                | `number \| string \| null`        | `400`   | interpolation duration in ms       |
 *
 * Use it on a container element (`<span>`, `<div>`, …). Hosts whose tag name
 * contains `-input` (e.g. PrimeNG `<p-inputNumber>`) get an inner
 * `<span class="rn-angular-target">` instead. Add `rolling-number/style.css`
 * to your global styles (e.g. `"styles"` in angular.json).
 *
 * Usage: add `RollingNumberDirective` to the `imports` of a standalone
 * component (or of an NgModule), then use it in the template:
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
 * <span [rollingNumber]="total" interpolate></span>
 * ```
 */
@Directive({
  selector: '[rollingNumber]',
  standalone: true
})
export class RollingNumberDirective implements OnInit, OnDestroy, OnChanges {
  private _value: number = RN_DEFAULTS.value;
  private _pad: number = RN_DEFAULTS.pad;
  private _max: number | null = RN_DEFAULTS.max;
  private _interpolate: boolean = RN_DEFAULTS.interpolate;
  private _duration: number = RN_DEFAULTS.duration;

  /**
   * The number to display (`[rollingNumber]="count"` or `rollingNumber="42"`).
   * Numeric strings are accepted; `null`/`undefined`/`''` → `0`, non-numeric → `0`.
   * Decimals are rounded for display.
   * @default 0
   */
  @Input('rollingNumber')
  get valueInput(): number | string {
    return this._value;
  }
  set valueInput(value: number | string | null | undefined) {
    this._value = coerceNumber(value, RN_DEFAULTS.value);
  }

  /**
   * Minimum number of digits, zero-padded on the left (1..64; `pad="3"` shows
   * `7` as `007`). `null`/`undefined`/non-numeric → `1`.
   * @default 1
   */
  @Input()
  get pad(): number {
    return this._pad;
  }
  set pad(value: number | string | null | undefined) {
    this._pad = coerceNumber(value, RN_DEFAULTS.pad);
  }

  /**
   * Upper bound of the displayed absolute value (e.g. `99` for a badge);
   * `null`, `undefined`, `''`, non-numeric or a negative number means no limit.
   * @default null
   */
  @Input()
  get max(): number | null {
    return this._max;
  }
  set max(value: number | string | null | undefined) {
    this._max = coerceMax(value);
  }

  /**
   * Whether value changes count through the intermediate numbers. Works as a
   * boolean attribute: bare `interpolate` → true, `interpolate="false"` (or
   * `'0'`, `'off'`, `0`) → false. `null`/`undefined` → `true`.
   * @default true
   */
  @Input()
  get interpolate(): boolean {
    return this._interpolate;
  }
  set interpolate(value: boolean | string | number | null | undefined) {
    this._interpolate = coerceInterpolate(value);
  }

  /**
   * Interpolation duration in milliseconds (`duration="600"` or
   * `[duration]="600"`). `null`/`undefined`/non-numeric → `400`.
   * @default 400
   */
  @Input()
  get duration(): number {
    return this._duration;
  }
  set duration(value: number | string | null | undefined) {
    this._duration = coerceNumber(value, RN_DEFAULTS.duration);
  }

  private core: RollingNumberCore | null = null;
  /** Wrapper span created for `*-input` hosts, removed again on destroy. */
  private createdTarget: HTMLElement | null = null;
  private readonly zone = inject(NgZone);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  constructor(private el: ElementRef<HTMLElement>) {}

  /** Creates the core (browser only). */
  ngOnInit(): void {
    // The core touches the DOM and schedules rAF: only create it in the browser.
    if (!this.isBrowser) return;
    // Keep rAF frames out of zone.js so they don't trigger change detection.
    this.zone.runOutsideAngular(() => {
      const targetEl = this.resolveTargetElement(this.el.nativeElement);
      this.core = new RollingNumberCore(targetEl, {
        value: this._value,
        pad: this._pad,
        max: this._max,
        interpolate: this._interpolate,
        duration: this._duration
      });
    });
  }

  private resolveTargetElement(el: HTMLElement): HTMLElement {
    // Handle complex UI components like PrimeNG <p-inputNumber> or Material inputs
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

  /** Forwards changed inputs to the core. */
  ngOnChanges(changes: SimpleChanges): void {
    const core = this.core;
    if (!core) return;

    this.zone.runOutsideAngular(() => {
      if (changes['interpolate']) core.setInterpolate(this._interpolate);
      if (changes['duration']) core.setDuration(this._duration);
      if (changes['pad']) core.setPad(this._pad);
      if (changes['max']) core.setMax(this._max);
      if (changes['valueInput']) core.setValue(this._value);
    });
  }

  /** Destroys the core and removes the nodes the directive created. */
  ngOnDestroy(): void {
    const core = this.core;
    const createdTarget = this.createdTarget;
    this.core = null;
    this.createdTarget = null;
    if (!core && !createdTarget) return;
    this.zone.runOutsideAngular(() => {
      core?.destroy();
      createdTarget?.remove();
    });
  }
}
