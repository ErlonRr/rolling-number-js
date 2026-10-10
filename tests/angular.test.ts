// @angular/common ships partial declarations: the JIT compiler links them at import time.
import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ElementRef, Injector, NgZone, PLATFORM_ID, runInInjectionContext, type SimpleChanges } from '@angular/core';
import { RollingNumberDirective } from '../src/angular';
import { digitsOf, installRaf, makeHost, stubReducedMotion, type RafController } from './helpers';

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
});

/**
 * Light behavioural test of the directive class without TestBed: the class is
 * instantiated in an injection context with a stub NgZone, and its lifecycle
 * hooks are called the way Angular would.
 */
describe('RollingNumberDirective (lifecycle, no TestBed)', () => {
  let raf: RafController;
  const zone = { runOutsideAngular: vi.fn(<T>(fn: () => T): T => fn()) };

  beforeEach(() => {
    raf = installRaf();
    stubReducedMotion(false);
    zone.runOutsideAngular.mockClear();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  function create(host: HTMLElement, platform: 'browser' | 'server' = 'browser'): RollingNumberDirective {
    const injector = Injector.create({
      providers: [
        { provide: NgZone, useValue: zone },
        { provide: PLATFORM_ID, useValue: platform }
      ]
    });
    return runInInjectionContext(injector, () => new RollingNumberDirective(new ElementRef(host)));
  }

  function changes(...names: string[]): SimpleChanges {
    return Object.fromEntries(names.map((n) => [n, { currentValue: undefined, previousValue: undefined, firstChange: false, isFirstChange: () => false }]));
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
    expect(digitsOf(host)).toBe('123');
    expect(raf.requested()).toBe(0);

    dir.max = 99;
    dir.ngOnChanges(changes('max'));
    expect(digitsOf(host)).toBe('99');

    dir.ngOnDestroy();
    expect(host.childNodes).toHaveLength(0);
    expect(host.hasAttribute('role')).toBe(false);
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
});
