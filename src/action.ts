/**
 * Generic `rollingNumber(node, param)` action (Svelte `use:` compatible;
 * Solid / Lit / Alpine / Svelte 5 attachments via one-line wrappers).
 * Owned by WP7 (docs/design/v1.3.md §2.6). WP0: minimal implementation with
 * the final signature.
 *
 * @module
 */
import { RollingNumberCore } from './core';
import { OPTION_KEYS } from './options';
import type { RollingNumberUpdate } from './types';

/** Action parameter: the value, or the full option set plus an optional `target` (selector or element inside the node). */
export type RollingNumberActionParam = number | (RollingNumberUpdate & { target?: string | Element | null });

/** Object returned by {@link rollingNumber}. */
export interface RollingNumberActionReturn {
  /** Svelte semantics: `param` is the FULL option set; omitted fields reset to their defaults. No-op when nothing changed. */
  update(param?: RollingNumberActionParam): void;
  destroy(): void;
  /** The live core (null after destroy). */
  readonly core: RollingNumberCore | null;
}

/** Full option set of a param: omitted fields are `null` (reset to default). */
function toOptions(param: RollingNumberActionParam | undefined): RollingNumberUpdate {
  const src: Record<string, unknown> =
    typeof param === 'object' && param !== null ? (param as Record<string, unknown>) : { value: param };
  const out: Record<string, unknown> = {};
  for (const key of OPTION_KEYS) out[key] = src[key] === undefined ? null : src[key];
  return out as RollingNumberUpdate;
}

/** Resolves `target` (a selector or an element inside `node`), else `node`. */
function resolveTarget(node: Element, param: RollingNumberActionParam | undefined): Element {
  const target = typeof param === 'object' && param !== null ? param.target : null;
  if (typeof target === 'string') return node.querySelector(target) ?? node;
  if (target && typeof target === 'object' && (target as Element).nodeType === 1) return target;
  return node;
}

/**
 * Attaches a counter to `node` (or to `target` inside it).
 *
 * @param node Host element.
 * @param param The value, or the full option set.
 * @returns `update`, `destroy` and the live `core`.
 *
 * @example
 * ```svelte
 * <span use:rollingNumber={{ value: count, pad: 2 }}></span>
 * ```
 *
 * @example
 * ```ts
 * const counter = rollingNumber(document.querySelector('#n')!, 42);
 * counter.update({ value: 50, max: 99 });
 * counter.destroy();
 * ```
 */
export function rollingNumber(node: Element, param?: RollingNumberActionParam): RollingNumberActionReturn {
  let core: RollingNumberCore | null = new RollingNumberCore(
    resolveTarget(node, param) as HTMLElement,
    toOptions(param)
  );
  return {
    update(next) {
      if (core) core.update(toOptions(next));
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
