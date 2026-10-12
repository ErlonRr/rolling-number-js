/**
 * Generic `rollingNumber(node, param)` action (Svelte `use:` compatible;
 * Solid / Lit / Alpine / Svelte 5 attachments via one-line wrappers).
 * docs/design/v1.3.md §2.6.
 *
 * @module
 */
import { RollingNumberCore } from './core';
import { OPTION_KEYS, readOption } from './options';
import { warn } from './internal/warn';
import type { OptionKey } from './internal/contracts';
import type { RollingNumberUpdate } from './types';

/**
 * Action parameter: the value, or the full option set plus an optional
 * `target` (a selector or an element inside the node to render into).
 */
export type RollingNumberActionParam = number | (RollingNumberUpdate & { target?: string | Element | null });

/** Object returned by {@link rollingNumber}. */
export interface RollingNumberActionReturn {
  /** Svelte semantics: `param` is the FULL option set; omitted fields reset to their defaults. No-op when nothing changed. */
  update(param?: RollingNumberActionParam): void;
  /** Destroys the counter and restores the host. Safe to call more than once. */
  destroy(): void;
  /** The live core (null after destroy). */
  readonly core: RollingNumberCore | null;
}

/** Every option of a param, omitted fields as `null` (reset to the default). */
type FullOptions = Record<OptionKey, unknown>;

/** The param as an object: a number (or any non-object) is the value. */
function fields(param: RollingNumberActionParam | undefined): Record<string, unknown> {
  return typeof param === 'object' && param !== null ? (param as Record<string, unknown>) : { value: param };
}

/** Full option set of a param: omitted fields are `null` (reset to the default). */
function toOptions(param: RollingNumberActionParam | undefined): FullOptions {
  const src = fields(param);
  const out = {} as FullOptions;
  for (const key of OPTION_KEYS) {
    const raw = readOption(src, key);
    out[key] = raw === undefined ? null : raw;
  }
  return out;
}

/** `target` of a param (`null` when absent). */
function targetOf(param: RollingNumberActionParam | undefined): unknown {
  const target = fields(param).target;
  return target === undefined ? null : target;
}

/** Plain object (not null, not an array). */
function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/**
 * Whether two raw values of option `key` are the same: `Object.is` (functions
 * by identity), `format` one level deep, `locale` arrays element by element.
 */
function sameOption(key: OptionKey, a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (key === 'format' && isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && Object.is(a[k], b[k]));
  }
  if (key === 'locale' && Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  }
  return false;
}

/**
 * Resolves `target` (a selector matched inside `node`, or an element), else
 * `node`. A selector that matches nothing falls back to `node` with a warning.
 */
function resolveTarget(node: Element, target: unknown): Element {
  if (typeof target === 'string') {
    let found: Element | null = null;
    try {
      found = node.querySelector(target);
    } catch {
      found = null;
    }
    if (found) return found;
    warn(`rollingNumber(): target ${JSON.stringify(target)} matches nothing inside the node; using the node itself.`);
    return node;
  }
  if (target !== null && typeof target === 'object' && (target as Partial<Element>).nodeType === 1) return target as Element;
  return node;
}

/**
 * Attaches a counter to `node` (or to `target` inside it).
 *
 * `update(param)` follows Svelte semantics: `param` is the full option set,
 * so an omitted field resets to its default; nothing happens when no field
 * changed (`Object.is` per field, `format` compared one level deep, `locale`
 * arrays element by element, functions by identity). A changed `target`
 * destroys the counter and creates a new one on the new target (without
 * replaying `from`, which is creation-only).
 *
 * @param node Host element.
 * @param param The value, or the full option set (plus `target`).
 * @returns `update`, `destroy` and the live `core`.
 *
 * @example
 * ```svelte
 * <span use:rollingNumber={count}></span>
 * <span use:rollingNumber={{ value: count, pad: 2, max: 99, overflowSuffix: '+' }}></span>
 * ```
 *
 * @example
 * ```ts
 * const counter = rollingNumber(document.querySelector('#n')!, 42);
 * counter.update({ value: 50, max: 99 }); // every omitted option is reset to its default
 * await counter.core?.whenSettled();
 * counter.destroy();
 * ```
 */
export function rollingNumber(node: Element, param?: RollingNumberActionParam): RollingNumberActionReturn {
  let options = toOptions(param);
  let target = targetOf(param);
  let host = resolveTarget(node, target);
  let core: RollingNumberCore | null = new RollingNumberCore(host as HTMLElement, options as RollingNumberUpdate);

  return {
    update(next) {
      if (!core) return;
      const nextOptions = toOptions(next);
      const nextTarget = targetOf(next);
      if (!Object.is(nextTarget, target)) {
        target = nextTarget;
        const nextHost = resolveTarget(node, nextTarget);
        if (nextHost !== host) {
          core.destroy();
          host = nextHost;
          options = nextOptions;
          core = new RollingNumberCore(host as HTMLElement, { ...nextOptions, from: null } as RollingNumberUpdate);
          return;
        }
      }
      const changed: Record<string, unknown> = {};
      let dirty = false;
      for (const key of OPTION_KEYS) {
        if (key === 'from' || sameOption(key, options[key], nextOptions[key])) continue;
        changed[key] = nextOptions[key];
        dirty = true;
      }
      options = nextOptions;
      if (dirty) core.update(changed as RollingNumberUpdate);
    },
    destroy() {
      if (core) {
        core.destroy();
        core = null;
      }
    },
    get core() {
      return core;
    }
  };
}
