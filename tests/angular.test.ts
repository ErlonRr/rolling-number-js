// @angular/common ships partial declarations: the JIT compiler links them at import time.
import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Component,
  ElementRef,
  EventEmitter,
  Injector,
  NgZone,
  PLATFORM_ID,
  RendererFactory2,
  createComponent,
  createEnvironmentInjector,
  inject,
  runInInjectionContext,
  ɵAfterRenderManager,
  ɵChangeDetectionScheduler,
  ɵINJECTOR_SCOPE,
  type ComponentRef,
  type EnvironmentInjector,
  type Renderer2,
  type SimpleChanges,
  type StaticProvider
} from '@angular/core';
import { NgIf } from '@angular/common';
import { RollingNumberDirective } from '../src/angular';
import { RollingNumberCore, getResolved } from '../src/core';
import type { RollingNumberEvent } from '../src/types';
import { digitsOf, installRaf, makeHost, stubReducedMotion, type RafController } from './helpers';

/**
 * `afterNextRender` as the directive sees it through `import * as ng from '@angular/core'`:
 * the real function, missing (Angular 16.0/16.1), or a test double.
 */
type AfterNextRender = (cb: () => void, options?: { injector?: Injector }) => { destroy(): void };
const anr = vi.hoisted(() => ({ impl: 'real' as 'real' | 'missing' | AfterNextRender }));
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return {
    ...actual,
    get afterNextRender() {
      return anr.impl === 'real' ? actual.afterNextRender : anr.impl === 'missing' ? undefined : anr.impl;
    }
  };
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distAngular = join(root, 'dist', 'angular.js');

describe('dist/angular.js (partial compilation)', () => {
  it.skipIf(!existsSync(distAngular))('ships Ivy partial declarations instead of decorators', () => {
    const code = readFileSync(distAngular, 'utf8');
    expect(code).toContain('ɵɵngDeclareDirective');
    expect(code).toContain('ɵɵngDeclareFactory');
    expect(code).toMatch(/selector:\s*["']\[rollingNumber\]["']/);
    expect(code).not.toMatch(/__decorate|Symbol\.metadata/);
  });

  it.skipIf(!existsSync(distAngular))('declares exportAs and the outputs; reads afterNextRender through the namespace (Angular 16.0/16.1)', () => {
    const code = readFileSync(distAngular, 'utf8');
    expect(code).toMatch(/exportAs:\s*\[\s*["']rollingNumber["']\s*\]/);
    expect(code).toMatch(/outputs:\s*\{\s*rnStart:\s*["']rnStart["'],\s*rnEnd:\s*["']rnEnd["']\s*\}/);
    // A named import of a missing export would fail to link on Angular < 16.2.
    expect(code).not.toMatch(/import\s*\{[^}]*\bafterNextRender\b[^}]*\}\s*from/);
    expect(code).toMatch(/typeof \w+\.afterNextRender\s*==/);
  });
});

/**
 * Light behavioural test of the directive class without TestBed: the class is
 * instantiated in an injection context with a stub NgZone, and its lifecycle
 * hooks are called the way Angular would.
 */
describe('RollingNumberDirective (lifecycle, no TestBed)', () => {
  let raf: RafController;
  const zone = {
    runOutsideAngular: vi.fn(<T>(fn: () => T): T => fn()),
    run: vi.fn(<T>(fn: () => T): T => fn())
  };

  beforeEach(() => {
    raf = installRaf();
    stubReducedMotion(false);
    zone.runOutsideAngular.mockClear();
    zone.run.mockClear();
    anr.impl = 'real';
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  function injectorFor(platform: 'browser' | 'server' = 'browser', providers: StaticProvider[] = []): Injector {
    return Injector.create({
      providers: [
        { provide: NgZone, useValue: zone },
        { provide: PLATFORM_ID, useValue: platform },
        ...providers
      ]
    });
  }

  function create(host: HTMLElement, platform: 'browser' | 'server' = 'browser', injector = injectorFor(platform)): RollingNumberDirective {
    return runInInjectionContext(injector, () => new RollingNumberDirective(new ElementRef(host)));
  }

  function changes(...names: string[]): SimpleChanges {
    return Object.fromEntries(names.map((n) => [n, { currentValue: undefined, previousValue: undefined, firstChange: false, isFirstChange: () => false }]));
  }

  /** A PrimeNG `<p-inputNumber>`-like host: a component element rendering an `<input>`. */
  function inputNumberHost(): { host: HTMLElement; input: HTMLInputElement } {
    const host = makeHost('p-inputnumber');
    const wrapper = document.createElement('span');
    wrapper.className = 'p-inputnumber p-component';
    const input = document.createElement('input');
    input.className = 'p-inputnumber-input';
    wrapper.appendChild(input);
    host.appendChild(wrapper);
    return { host, input };
  }

  /** Host with a template-owned SSR fallback child. */
  function ssrHost(text: string): { host: HTMLElement; fallback: HTMLElement } {
    const host = makeHost();
    const fallback = document.createElement('span');
    fallback.className = 'rn-ssr';
    fallback.setAttribute('data-rn-ssr', '');
    fallback.textContent = text;
    host.appendChild(fallback);
    return { host, fallback };
  }

  it('coerces string inputs (static attributes) and keeps typed getters', () => {
    const dir = create(makeHost());
    dir.valueInput = '42';
    dir.pad = '3';
    dir.max = '';
    dir.duration = '200';
    dir.interpolate = '';
    expect(dir.valueInput).toBe(42);
    expect(dir.pad).toBe(3);
    expect(dir.max).toBeNull();
    expect(dir.duration).toBe(200);
    expect(dir.interpolate).toBe(true); // bare attribute
    dir.interpolate = 'false';
    expect(dir.interpolate).toBe(false);
    dir.interpolate = 0;
    expect(dir.interpolate).toBe(false);
    dir.pad = null;
    dir.duration = undefined;
    dir.valueInput = null;
    expect(dir.pad).toBe(1);
    expect(dir.duration).toBe(400);
    expect(dir.valueInput).toBe(0);
  });

  it('non-numeric inputs fall back to the defaults (getters never return NaN)', () => {
    const host = makeHost();
    const dir = create(host);
    dir.valueInput = 'abc';
    dir.pad = 'x';
    dir.duration = 'x';
    dir.max = 'x';
    expect(dir.valueInput).toBe(0);
    expect(dir.pad).toBe(1);
    expect(dir.duration).toBe(400);
    expect(dir.max).toBeNull();
    dir.max = -5;
    expect(dir.max).toBeNull();
    dir.max = '99';
    expect(dir.max).toBe(99);
    dir.ngOnInit();
    expect(digitsOf(host)).toBe('0');
    dir.ngOnDestroy();
  });

  it('creates the core outside the zone, forwards changes and cleans up', () => {
    const host = makeHost();
    const dir = create(host);
    dir.valueInput = 7;
    dir.pad = 2;
    dir.ngOnInit();
    expect(zone.runOutsideAngular).toHaveBeenCalled();
    expect(digitsOf(host)).toBe('07');

    dir.interpolate = 'false';
    dir.valueInput = 123;
    dir.ngOnChanges(changes('interpolate', 'valueInput'));
    // R-settle (docs/design/v1.3.md §11.1): since v1.3 a roll may be JS-driven (S3).
    raf.runAll();
    expect(digitsOf(host)).toBe('123');
    expect(host.hasAttribute('data-rn-state')).toBe(false);

    dir.max = 99;
    dir.ngOnChanges(changes('max'));
    expect(digitsOf(host)).toBe('99');

    dir.ngOnDestroy();
    expect(host.childNodes).toHaveLength(0);
    expect(host.hasAttribute('role')).toBe(false);
  });

  it('applies { motion: "none" } synchronously without requesting frames (R-settle sibling)', async () => {
    const host = makeHost();
    const dir = create(host);
    dir.valueInput = 7;
    dir.interpolate = 'false';
    dir.ngOnInit();
    const requested = raf.requested();
    const settled = dir.setValue(456, { motion: 'none' });
    expect(digitsOf(host)).toBe('456');
    expect(raf.requested()).toBe(requested);
    await expect(settled).resolves.toEqual({ value: 456, completed: true });
    dir.ngOnDestroy();
  });

  it('does not create the core on the server platform', () => {
    const host = makeHost();
    const dir = create(host, 'server');
    dir.ngOnInit();
    dir.ngOnChanges(changes('valueInput'));
    dir.ngOnDestroy();
    expect(host.childNodes).toHaveLength(0);
    expect(host.hasAttribute('role')).toBe(false);
  });

  it('uses an inner span for *-input hosts and removes it on destroy', () => {
    const host = makeHost('p-inputnumber');
    host.appendChild(document.createElement('input'));
    const dir = create(host);
    dir.valueInput = 5;
    dir.ngOnInit();
    const target = host.querySelector('.rn-angular-target')!;
    expect(target).not.toBeNull();
    expect(digitsOf(target)).toBe('5');
    dir.ngOnDestroy();
    expect(host.querySelector('.rn-angular-target')).toBeNull();
    expect(host.querySelector('input')).not.toBeNull();
  });

  describe('rn* inputs (v1.3)', () => {
    it('coerces attribute strings and passes every rn* input to the core', () => {
      const host = makeHost();
      const dir = create(host);
      dir.valueInput = '1234.5';
      dir.rnEasing = 'ease-out-expo';
      dir.rnDecimals = '2';
      dir.rnLocale = 'de-DE, en';
      dir.rnFormat = '{"style":"currency","currency":"EUR"}';
      dir.rnPrefixText = '~';
      dir.rnSuffixText = ' pts';
      dir.rnOverflowSuffix = '+';
      dir.rnMode = 'columns';
      dir.rnFrom = '10';
      dir.rnTrigger = 'visible';
      dir.rnLabel = '{value} points';
      dir.rnLive = ''; // bare attribute
      dir.rnInjectStyles = 'false';

      expect(dir.rnEasing).toBe('ease-out-expo');
      expect(dir.rnDecimals).toBe(2);
      expect(dir.rnLocale).toEqual(['de-DE', 'en']);
      expect(dir.rnFormat).toEqual({ style: 'currency', currency: 'EUR' });
      expect(dir.rnPrefixText).toBe('~');
      expect(dir.rnSuffixText).toBe(' pts');
      expect(dir.rnOverflowSuffix).toBe('+');
      expect(dir.rnMode).toBe('columns');
      expect(dir.rnFrom).toBe(10);
      expect(dir.rnTrigger).toBe('visible');
      expect(dir.rnLabel).toBe('{value} points');
      expect(dir.rnLive).toBe('polite');
      expect(dir.rnInjectStyles).toBe(false);

      dir.ngOnInit();
      expect(dir.valueInput).toBe(1234.5);
      expect(getResolved(dir.core!)).toMatchObject({
        easing: 'ease-out-expo',
        decimals: 2,
        locale: ['de-DE', 'en'],
        format: { style: 'currency', currency: 'EUR' },
        prefixText: '~',
        suffixText: ' pts',
        overflowSuffix: '+',
        mode: 'columns',
        from: 10,
        trigger: 'visible',
        label: '{value} points',
        live: 'polite',
        injectStyles: false
      });
      dir.ngOnDestroy();
    });

    it('null, undefined and "" reset the rn* inputs to their defaults, also in the core', () => {
      const host = makeHost();
      const dir = create(host);
      const fn = (): string => 'x';
      dir.rnEasing = (p: number) => p;
      dir.rnDecimals = 1;
      dir.rnLocale = ['fr-FR'];
      dir.rnFormat = { style: 'percent' };
      dir.rnPrefixText = 'a';
      dir.rnSuffixText = 'b';
      dir.rnOverflowSuffix = '+';
      dir.rnMode = 'columns';
      dir.rnFrom = 3;
      dir.rnTrigger = 'visible';
      dir.rnLabel = fn;
      dir.rnLive = 'assertive';
      dir.rnInjectStyles = false;
      dir.ngOnInit();
      expect(getResolved(dir.core!)).toMatchObject({ label: fn, live: 'assertive', locale: ['fr-FR'], format: { style: 'percent' } });

      dir.rnEasing = null;
      dir.rnDecimals = '';
      dir.rnLocale = undefined;
      dir.rnFormat = '';
      dir.rnPrefixText = null;
      dir.rnSuffixText = undefined;
      dir.rnOverflowSuffix = null;
      dir.rnMode = undefined;
      dir.rnFrom = '';
      dir.rnTrigger = null;
      dir.rnLabel = '';
      dir.rnLive = null;
      dir.rnInjectStyles = undefined;
      const defaults = {
        easing: null, decimals: null, locale: null, format: null, prefixText: '', suffixText: '', overflowSuffix: '',
        mode: 'auto', trigger: 'immediate', label: null, live: 'off', injectStyles: true
      };
      expect({
        easing: dir.rnEasing, decimals: dir.rnDecimals, locale: dir.rnLocale, format: dir.rnFormat,
        prefixText: dir.rnPrefixText, suffixText: dir.rnSuffixText, overflowSuffix: dir.rnOverflowSuffix,
        mode: dir.rnMode, trigger: dir.rnTrigger, label: dir.rnLabel, live: dir.rnLive, injectStyles: dir.rnInjectStyles
      }).toEqual(defaults);
      expect(dir.rnFrom).toBeNull();

      dir.ngOnChanges(changes(
        'rnEasing', 'rnDecimals', 'rnLocale', 'rnFormat', 'rnPrefixText', 'rnSuffixText', 'rnOverflowSuffix',
        'rnMode', 'rnTrigger', 'rnLabel', 'rnLive', 'rnInjectStyles'
      ));
      expect(getResolved(dir.core!)).toMatchObject(defaults);
      dir.ngOnDestroy();
    });

    it('boolean-ish rn* inputs work as boolean attributes', () => {
      const dir = create(makeHost());
      dir.rnLive = true;
      expect(dir.rnLive).toBe('polite');
      dir.rnLive = false;
      expect(dir.rnLive).toBe('off');
      dir.rnLive = 'false' as never; // a static attribute string
      expect(dir.rnLive).toBe('off');
      dir.rnInjectStyles = '';
      expect(dir.rnInjectStyles).toBe(true);
      dir.rnInjectStyles = 'off';
      expect(dir.rnInjectStyles).toBe(false);
      dir.rnMode = 'sideways' as never;
      expect(dir.rnMode).toBe('auto');
      dir.rnTarget = '';
      expect(dir.rnTarget).toBe('auto');
    });

    it('rnFormat accepts an object or its JSON text; invalid JSON is ignored with a warning', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const dir = create(makeHost());
      dir.rnFormat = { style: 'unit', unit: 'kilometer-per-hour' };
      expect(dir.rnFormat).toEqual({ style: 'unit', unit: 'kilometer-per-hour' });
      dir.rnFormat = ' {"style":"percent","signDisplay":"always"} ';
      expect(dir.rnFormat).toEqual({ style: 'percent', signDisplay: 'always' });
      dir.rnFormat = '{oops';
      expect(dir.rnFormat).toBeNull();
      expect(warn).toHaveBeenCalled();
    });

    it('legacy names and their rn* aliases share one field; ngOnChanges handles both names', () => {
      const host = makeHost();
      const dir = create(host);
      dir.rnPad = '3';
      dir.rnMax = '500';
      dir.rnInterpolate = 'off';
      dir.rnDuration = '250';
      expect([dir.pad, dir.max, dir.interpolate, dir.duration]).toEqual([3, 500, false, 250]);
      dir.valueInput = 7;
      dir.ngOnInit();
      expect(digitsOf(host)).toBe('007');
      expect(getResolved(dir.core!)).toMatchObject({ pad: 3, max: 500, interpolate: false, duration: 250 });

      dir.pad = 2;
      expect(dir.rnPad).toBe(2);
      dir.ngOnChanges(changes('pad'));
      expect(digitsOf(host)).toBe('07');
      dir.rnPad = 4;
      dir.ngOnChanges(changes('rnPad'));
      expect(digitsOf(host)).toBe('0007');

      dir.max = 5;
      expect(dir.rnMax).toBe(5);
      dir.ngOnChanges(changes('max'));
      expect(digitsOf(host)).toBe('0005');
      dir.rnMax = null;
      dir.ngOnChanges(changes('rnMax'));
      expect(digitsOf(host)).toBe('0007');

      dir.interpolate = '';
      expect(dir.rnInterpolate).toBe(true);
      dir.ngOnChanges(changes('interpolate'));
      expect(getResolved(dir.core!).interpolate).toBe(true);
      dir.rnInterpolate = 0;
      dir.ngOnChanges(changes('rnInterpolate'));
      expect(getResolved(dir.core!).interpolate).toBe(false);
      dir.ngOnDestroy();
    });

    it('forwards only the changed options, in one core.update() call outside the zone', () => {
      const dir = create(makeHost());
      dir.ngOnInit();
      const update = vi.spyOn(dir.core!, 'update');
      zone.runOutsideAngular.mockClear();
      dir.rnPrefixText = '$';
      dir.rnDuration = 300;
      dir.valueInput = 9;
      dir.ngOnChanges(changes('rnPrefixText', 'rnDuration', 'valueInput', 'notAnInput'));
      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith({ prefixText: '$', duration: 300, value: 9 });
      expect(zone.runOutsideAngular).toHaveBeenCalledTimes(1);
      dir.ngOnDestroy();
    });
  });

  describe('unset timing (S5)', () => {
    it('never bound: the core receives null duration and easing; the duration getter reads 400', () => {
      const dir = create(makeHost());
      dir.ngOnInit();
      expect(getResolved(dir.core!).duration).toBeNull();
      expect(getResolved(dir.core!).easing).toBeNull();
      expect(dir.duration).toBe(400);
      expect(dir.rnDuration).toBeNull();
      expect(dir.rnEasing).toBeNull();
      dir.ngOnDestroy();
    });

    it.each([null, undefined, ''])('duration and rnDuration bound to %j: the core receives null, the getter reads 400', (unset) => {
      for (const name of ['duration', 'rnDuration'] as const) {
        const dir = create(makeHost());
        dir[name] = unset;
        dir.ngOnInit();
        expect(getResolved(dir.core!).duration).toBeNull();
        expect(dir.duration).toBe(400);

        dir[name] = 600;
        dir.ngOnChanges(changes(name));
        expect(getResolved(dir.core!).duration).toBe(600);
        expect(dir.duration).toBe(600);

        dir[name] = unset;
        dir.ngOnChanges(changes(name));
        expect(getResolved(dir.core!).duration).toBeNull();
        expect(dir.duration).toBe(400);
        expect(dir.rnDuration).toBeNull();
        dir.ngOnDestroy();
      }
    });

    it('rnEasing bound then reset to null: the core is back to unset', () => {
      const dir = create(makeHost());
      dir.rnEasing = 'linear';
      dir.ngOnInit();
      expect(getResolved(dir.core!).easing).toBe('linear');
      dir.rnEasing = null;
      dir.ngOnChanges(changes('rnEasing'));
      expect(getResolved(dir.core!).easing).toBeNull();
      dir.ngOnDestroy();
    });
  });

  describe('rnTarget', () => {
    it("'auto' renders into the host (non -input tags)", () => {
      const host = makeHost('div');
      const dir = create(host);
      dir.ngOnInit();
      expect(dir.core!.getHost()).toBe(host);
      dir.ngOnDestroy();
    });

    it("'host' renders into the host even for *-input tags", () => {
      const { host } = inputNumberHost();
      const dir = create(host);
      dir.rnTarget = 'host';
      dir.ngOnInit();
      expect(dir.core!.getHost()).toBe(host);
      expect(host.querySelector('.rn-angular-target')).toBeNull();
      dir.ngOnDestroy();
      expect(host.classList.contains('rn-rolling-number')).toBe(false);
    });

    it('a selector is resolved inside the host in ngAfterViewInit (p-inputNumber-like component)', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { host, input } = inputNumberHost();
      const dir = create(host);
      dir.rnTarget = 'input';
      dir.valueInput = 5;
      dir.ngOnInit();
      expect(dir.core).toBeNull(); // the component's view is not rendered yet at ngOnInit
      dir.ngAfterViewInit();
      expect(dir.core!.getHost()).toBe(input);
      expect(host.querySelector('.rn-angular-target')).toBeNull();
      dir.ngAfterViewInit(); // idempotent
      dir.ngOnDestroy();
      expect(dir.core).toBeNull();
      expect(input.isConnected).toBe(true);
    });

    it('a selector that matches nothing warns and creates no core', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const host = makeHost();
      const dir = create(host);
      dir.rnTarget = '.missing';
      dir.ngOnInit();
      dir.ngAfterViewInit();
      expect(dir.core).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('.missing'));
      expect(host.hasAttribute('role')).toBe(false);
      await expect(dir.setValue(3)).resolves.toEqual({ value: 3, completed: false });
      dir.rnTarget = '[[invalid';
      expect(() => dir.ngOnChanges(changes('rnTarget'))).not.toThrow();
      expect(dir.core).toBeNull();
      dir.ngOnDestroy();
    });

    it('changing rnTarget re-creates the core (without replaying the from intro)', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { host, input } = inputNumberHost();
      const dir = create(host);
      dir.valueInput = 5;
      dir.rnFrom = 0;
      dir.ngOnInit();
      const first = dir.core!;
      expect(first.getHost()).toBe(host.querySelector('.rn-angular-target'));

      dir.rnTarget = 'input';
      dir.ngOnChanges(changes('rnTarget'));
      const second = dir.core!;
      expect(second).not.toBe(first);
      expect(second.getHost()).toBe(input);
      expect(host.querySelector('.rn-angular-target')).toBeNull(); // the 1.x span is removed with the old core
      expect(getResolved(second).from).toBeNull();
      expect(dir.rnFrom).toBe(0);

      dir.rnTarget = 'host';
      dir.ngOnChanges(changes('rnTarget'));
      expect(dir.core!.getHost()).toBe(host);
      expect(digitsOf(host)).toBe('5'); // shows the value at once: no 0 → 5 intro
      expect(input.classList.contains('rn-rolling-number')).toBe(false);
      dir.ngOnDestroy();
      expect(host.hasAttribute('role')).toBe(false);
    });
  });

  describe('outputs rnStart / rnEnd', () => {
    it('do not emit nor re-enter the zone when nothing subscribed', async () => {
      const host = makeHost();
      const dir = create(host);
      const emitStart = vi.spyOn(dir.rnStart, 'emit');
      const emitEnd = vi.spyOn(dir.rnEnd, 'emit');
      const native = vi.fn();
      host.addEventListener('rn-end', native);
      dir.ngOnInit();
      await dir.setValue(5, { motion: 'none' });
      expect(native).toHaveBeenCalledTimes(1); // the native (rn-end) binding still works
      expect(emitStart).not.toHaveBeenCalled();
      expect(emitEnd).not.toHaveBeenCalled();
      expect(zone.run).not.toHaveBeenCalled();
      dir.ngOnDestroy();
    });

    it('emit the CustomEvent inside the zone when subscribed', async () => {
      const host = makeHost();
      const dir = create(host);
      const starts: RollingNumberEvent[] = [];
      const ends: RollingNumberEvent[] = [];
      dir.rnStart.subscribe((e) => starts.push(e));
      dir.rnEnd.subscribe((e) => ends.push(e));
      dir.ngOnInit();
      await dir.setValue(5, { motion: 'none' });
      expect(starts).toHaveLength(1);
      expect(ends).toHaveLength(1);
      expect(ends[0]).toBeInstanceOf(CustomEvent);
      expect(ends[0].type).toBe('rn-end');
      expect(ends[0].detail).toMatchObject({ value: 5, from: 0, animated: false });
      expect(zone.run).toHaveBeenCalledTimes(2);
      dir.ngOnDestroy();
    });

    it('support an RxJS 6 emitter (observers, no observed)', async () => {
      const host = makeHost();
      const dir = create(host);
      const rx6 = (observers: unknown[]) => ({ observers, emit: vi.fn() });
      const start = rx6([]);
      const end = rx6([{ next() {} }]);
      Object.assign(dir, { rnStart: start, rnEnd: end });
      dir.ngOnInit();
      await dir.setValue(5, { motion: 'none' });
      expect('observed' in end).toBe(false);
      expect(start.emit).not.toHaveBeenCalled();
      expect(end.emit).toHaveBeenCalledTimes(1);
      expect(end.emit.mock.calls[0][0].detail.value).toBe(5);
      dir.ngOnDestroy();
    });

    it('come from the core target (inner span of *-input hosts), not from nested counters', async () => {
      const host = makeHost('p-inputnumber');
      const dir = create(host);
      const ends = vi.fn();
      const native = vi.fn();
      dir.rnEnd.subscribe(ends);
      host.addEventListener('rn-end', native);
      dir.ngOnInit();
      await dir.setValue(8, { motion: 'none' });
      expect(ends).toHaveBeenCalledTimes(1);
      expect(native).toHaveBeenCalledTimes(1); // bubbles from the inner span to the host

      const target = host.querySelector('.rn-angular-target')!;
      const detail = { value: 1, from: 0, animated: false };
      const nested = target.appendChild(document.createElement('i'));
      nested.dispatchEvent(new CustomEvent('rn-end', { bubbles: true, detail }));
      expect(ends).toHaveBeenCalledTimes(1);
      target.dispatchEvent(new CustomEvent('rn-end', { detail }));
      expect(ends).toHaveBeenCalledTimes(2);

      dir.ngOnDestroy(); // listeners are removed with the core
      target.dispatchEvent(new CustomEvent('rn-end', { detail }));
      expect(ends).toHaveBeenCalledTimes(2);
    });

    it('are EventEmitters', () => {
      const dir = create(makeHost());
      expect(dir.rnStart).toBeInstanceOf(EventEmitter);
      expect(dir.rnEnd).toBeInstanceOf(EventEmitter);
    });
  });

  describe('exportAs API (#c="rollingNumber")', () => {
    it('setValue / whenSettled / finish / getDisplayValue / core delegate to the core', async () => {
      const host = makeHost();
      const dir = create(host);
      dir.ngOnInit();
      expect(dir.core).toBeInstanceOf(RollingNumberCore);

      await expect(dir.setValue(9, { motion: 'none' })).resolves.toEqual({ value: 9, completed: true });
      expect(dir.valueInput).toBe(9);
      expect(dir.getDisplayValue()).toBe(9);
      await expect(dir.whenSettled()).resolves.toEqual({ value: 9, completed: true });

      zone.runOutsideAngular.mockClear();
      const counting = dir.setValue(20);
      expect(zone.runOutsideAngular).toHaveBeenCalledTimes(1);
      dir.finish();
      await expect(counting).resolves.toEqual({ value: 20, completed: true });
      expect(digitsOf(host)).toBe('20');
      expect(dir.getDisplayValue()).toBe(20);
      expect(raf.pending()).toBe(0);
      dir.finish(); // idle: no-op

      dir.ngOnDestroy();
      expect(dir.core).toBeNull();
    });

    it('without a core (server) the methods are safe and resolve completed: false', async () => {
      const dir = create(makeHost(), 'server');
      dir.valueInput = 4;
      dir.ngOnInit();
      expect(dir.core).toBeNull();
      expect(dir.getDisplayValue()).toBe(4);
      await expect(dir.whenSettled()).resolves.toEqual({ value: 4, completed: false });
      await expect(dir.setValue(6)).resolves.toEqual({ value: 6, completed: false });
      expect(dir.getDisplayValue()).toBe(6);
      expect(() => dir.finish()).not.toThrow();
    });
  });

  describe('SSR fallback ([data-rn-ssr] child)', () => {
    /** Root-scoped injector, enough for the real afterNextRender() outside TestBed. */
    function renderInjector(): Injector {
      return injectorFor('browser', [
        { provide: ɵINJECTOR_SCOPE, useValue: 'root' },
        { provide: ɵChangeDetectionScheduler, useValue: { notify() {}, runningTick: false } }
      ]);
    }

    it('defers creation to the real afterNextRender, called from ngOnInit with { injector } (no NG0203)', () => {
      const { host, fallback } = ssrHost('42');
      const injector = renderInjector();
      const dir = create(host, 'browser', injector);
      dir.valueInput = 42;
      // ngOnInit runs outside any injection context, as in Angular.
      expect(() => dir.ngOnInit()).not.toThrow();
      expect(dir.core).toBeNull();
      expect(host.querySelector('.rn-col')).toBeNull();

      injector.get(ɵAfterRenderManager).execute(); // what ApplicationRef.tick() does after rendering
      expect(dir.core).not.toBeNull();
      expect(digitsOf(host)).toBe('42');
      expect(fallback.isConnected).toBe(true); // template-owned: never removed by the directive

      dir.ngOnDestroy();
      expect(host.querySelector('.rn-col')).toBeNull();
      expect(fallback.isConnected).toBe(true);
    });

    it('passes the injector captured at construction and cancels the pending render on destroy', () => {
      const destroyRef = { destroy: vi.fn() };
      const calls: { cb: () => void; options?: { injector?: Injector } }[] = [];
      anr.impl = (cb, options) => {
        // Bare afterNextRender() would need an injection context here: there is none.
        expect(() => inject(Injector)).toThrow(/NG0203/);
        calls.push({ cb, options });
        return destroyRef;
      };
      const { host } = ssrHost('1');
      const injector = injectorFor();
      const dir = create(host, 'browser', injector);
      dir.ngOnInit();
      expect(calls).toHaveLength(1);
      expect(calls[0].options?.injector).toBe(injector);
      expect(dir.core).toBeNull();

      // Inputs changed before the deferred creation are used by it.
      dir.valueInput = 3;
      dir.ngOnChanges(changes('valueInput'));
      calls[0].cb();
      expect(digitsOf(host)).toBe('3');
      dir.ngOnDestroy();
      expect(destroyRef.destroy).not.toHaveBeenCalled(); // already ran

      const second = ssrHost('2');
      const dir2 = create(second.host, 'browser', injector);
      dir2.ngOnInit();
      dir2.ngOnDestroy();
      expect(destroyRef.destroy).toHaveBeenCalledTimes(1);
      expect(second.host.querySelector('.rn-col')).toBeNull();
    });

    it('falls back to ngOnInit when afterNextRender is missing (Angular 16.0/16.1)', () => {
      anr.impl = 'missing';
      const { host } = ssrHost('7');
      const dir = create(host);
      dir.valueInput = 7;
      dir.ngOnInit();
      expect(dir.core).not.toBeNull();
      expect(digitsOf(host)).toBe('7');
      dir.ngOnDestroy();
    });

    it('does not defer without a fallback child', () => {
      const spy = vi.fn<AfterNextRender>(() => ({ destroy() {} }));
      anr.impl = spy;
      const host = makeHost();
      const nested = document.createElement('b');
      nested.appendChild(document.createElement('span')).setAttribute('data-rn-ssr', ''); // not a direct child
      host.appendChild(nested);
      const dir = create(host);
      dir.ngOnInit();
      expect(spy).not.toHaveBeenCalled();
      expect(dir.core).not.toBeNull();
      dir.ngOnDestroy();
    });
  });
});

/**
 * The directive in a real (JIT-compiled) template, so Angular itself orders
 * bindings, lifecycle hooks and embedded views. `@angular/platform-browser` is
 * not a dev dependency: a minimal DOM renderer stands in for it.
 */
describe('RollingNumberDirective in a template (JIT)', () => {
  const zone = { runOutsideAngular: <T>(fn: () => T): T => fn(), run: <T>(fn: () => T): T => fn() };
  const NS: Record<string, string> = { svg: 'http://www.w3.org/2000/svg', math: 'http://www.w3.org/1998/Math/MathML' };
  const renderer = {
    data: {},
    destroyNode: null,
    destroy() {},
    createElement: (name: string, ns?: string | null) => (ns ? document.createElementNS(NS[ns] ?? ns, name) : document.createElement(name)),
    createComment: (text: string) => document.createComment(text),
    createText: (text: string) => document.createTextNode(text),
    appendChild: (parent: Node, child: Node) => parent.appendChild(child),
    insertBefore: (parent: Node, child: Node, ref: Node | null) => parent.insertBefore(child, ref),
    removeChild: (_parent: Node | null, child: ChildNode) => child.remove(),
    selectRootElement: (node: Element) => node,
    parentNode: (node: Node) => node.parentNode,
    nextSibling: (node: Node) => node.nextSibling,
    setAttribute: (el: Element, name: string, value: string) => el.setAttribute(name, value),
    removeAttribute: (el: Element, name: string) => el.removeAttribute(name),
    addClass: (el: Element, name: string) => el.classList.add(name),
    removeClass: (el: Element, name: string) => el.classList.remove(name),
    setStyle: (el: HTMLElement, name: string, value: string) => el.style.setProperty(name, value),
    removeStyle: (el: HTMLElement, name: string) => el.style.removeProperty(name),
    setProperty: (el: Record<string, unknown>, name: string, value: unknown) => {
      el[name] = value;
    },
    setValue: (node: Node, value: string) => {
      node.nodeValue = value;
    },
    listen: (target: EventTarget, type: string, cb: (e: Event) => unknown) => {
      target.addEventListener(type, cb);
      return () => target.removeEventListener(type, cb);
    }
  } as unknown as Renderer2;

  let refs: ComponentRef<unknown>[] = [];

  beforeEach(() => {
    installRaf();
    stubReducedMotion(false);
    anr.impl = 'real';
    // esbuild emits no `design:paramtypes`: tell the JIT compiler what the constructor injects.
    Object.defineProperty(RollingNumberDirective, 'ctorParameters', { value: () => [{ type: ElementRef }], configurable: true });
  });

  afterEach(() => {
    for (const ref of refs) ref.destroy();
    refs = [];
    document.body.replaceChildren();
  });

  /** Renders `template` with `state` as the component; `detect()` runs one change detection. */
  function mountTemplate<T extends object>(template: string, state: T): { root: HTMLElement; state: T; detect(): void } {
    @Component({ standalone: true, imports: [RollingNumberDirective, NgIf], template })
    class Host {
      constructor() {
        Object.assign(this, state);
      }
    }
    const env = createEnvironmentInjector(
      [
        { provide: RendererFactory2, useValue: { createRenderer: () => renderer, begin() {}, end() {} } },
        { provide: NgZone, useValue: zone },
        { provide: PLATFORM_ID, useValue: 'browser' }
      ],
      Injector.NULL as EnvironmentInjector
    );
    const root = document.body.appendChild(document.createElement('div'));
    const ref = createComponent(Host, { environmentInjector: env, hostElement: root });
    refs.push(ref);
    const detect = () => ref.changeDetectorRef.detectChanges();
    detect();
    return { root, state: ref.instance as T, detect };
  }

  it('[className] on the host keeps the library class (re-applied in ngDoCheck)', () => {
    const { root, state, detect } = mountTemplate('<span [rollingNumber]="n" [className]="cls"></span>', { n: 5, cls: 'a' });
    const span = root.querySelector('span')!;
    expect(span.className).toBe('a rn-rolling-number');

    state.cls = 'b';
    detect();
    expect(span.className).toBe('b rn-rolling-number');
    expect(digitsOf(span)).toBe('5');
  });

  it('ngDoCheck only re-renders when the library class is missing (and never in text mode)', () => {
    const { root, state, detect } = mountTemplate(
      '<span [rollingNumber]="n" [className]="cls"></span><input [rollingNumber]="n" [className]="cls" />',
      { n: 5, cls: 'a' }
    );
    const render = vi.spyOn(RollingNumberCore.prototype, 'render');
    detect();
    expect(render).not.toHaveBeenCalled();
    state.cls = 'b';
    detect();
    expect(render).toHaveBeenCalledTimes(1); // the span only
    expect(root.querySelector('input')!.className).toBe('b');
  });
});
