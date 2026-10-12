import type { ObjectDirective } from 'vue';
import { RollingNumberCore } from '../core';
import { OPTION_KEYS, resolveOptions } from '../options';
import { createFormatter, resolveLabel } from '../format';
import type { RollingNumberUpdate } from '../types';
import { sameOption } from './shared';

/**
 * Value accepted by `v-rolling-number`: a plain number (or numeric string),
 * or an options object ({@link RollingNumberUpdate}). With an object, fields
 * left `undefined` keep their current value and `null` resets a field to its
 * default. `target` (a CSS selector or an element inside the host) puts the
 * counter on that descendant instead of the host; a selector that matches
 * nothing falls back to the host.
 *
 * @example
 * ```vue
 * <span v-rolling-number="count" />
 * <span v-rolling-number="{ value: count, pad: 3, max: 999, overflowSuffix: '+' }" />
 * <label v-rolling-number="{ value: count, target: '.n' }">Score: <b class="n"></b></label>
 * ```
 */
export type RollingNumberBinding = number | string | (RollingNumberUpdate & { target?: string | Element | null });

type BindingObject = Exclude<RollingNumberBinding, number | string>;

interface DirectiveState {
  core: RollingNumberCore;
  /** Options last forwarded to the core, used to skip no-op updates and to re-create the core on a new target. */
  applied: Record<string, unknown>;
}

/**
 * Tags whose `mode: 'auto'` is text or unsupported (§6): form controls,
 * replaced elements and common SVG tags (SVG `a` is ambiguous with HTML `a`
 * and treated as a container). No `role`/`aria-label` on the server for them.
 */
const NO_COLUMNS = new Set(
  ('input textarea option select img video audio canvas iframe br hr ' +
    'svg g text tspan textPath circle ellipse line path polygon polyline rect use image').split(' ')
);

const instanceMap = new WeakMap<HTMLElement, DirectiveState>();

function toObject(binding: RollingNumberBinding | null | undefined): BindingObject {
  return typeof binding === 'object' && binding !== null ? binding : { value: Number(binding ?? 0) };
}

/** The defined option fields of a binding (`undefined` = unchanged). */
function toOptions(binding: RollingNumberBinding | null | undefined): Record<string, unknown> {
  const src = toObject(binding) as Record<string, unknown>;
  const opts: Record<string, unknown> = {};
  for (const key of OPTION_KEYS) {
    if (src[key] !== undefined) opts[key] = src[key];
  }
  return opts;
}

/** The element the counter renders into: `target` (selector or element inside `el`), else `el`. */
function resolveHost(el: HTMLElement, binding: RollingNumberBinding | null | undefined): HTMLElement {
  const target = toObject(binding).target;
  if (typeof target === 'string' && target) return el.querySelector<HTMLElement>(target) ?? el;
  if (target && typeof target === 'object' && target.nodeType === 1) return target as HTMLElement;
  return el;
}

function create(el: HTMLElement, host: HTMLElement, applied: Record<string, unknown>): void {
  // A server-rendered host (getSSRProps) that ends up in text mode: the core
  // never owns role/aria-label there, so drop the server's columns markers.
  const ssr = host.hasAttribute('data-rn-ssr');
  const core = new RollingNumberCore(host, applied as RollingNumberUpdate);
  if (ssr && core.getMode() === 'text') {
    for (const name of ['role', 'aria-label', 'data-rn-ssr']) host.removeAttribute(name);
  }
  instanceMap.set(el, { core, applied });
}

function applyBinding(el: HTMLElement, state: DirectiveState, binding: RollingNumberBinding | null | undefined): void {
  const next = toOptions(binding);
  const host = resolveHost(el, binding);
  if (host !== state.core.getHost()) {
    // The target moved (new selector/element, or the matched node was replaced).
    state.core.destroy();
    create(el, host, Object.assign(state.applied, next));
    return;
  }
  let changed: Record<string, unknown> | null = null;
  for (const key of OPTION_KEYS) {
    const value = next[key];
    if (value !== undefined && !sameOption(value, state.applied[key])) {
      changed = changed ?? {};
      changed[key] = state.applied[key] = value;
    }
  }
  if (changed) {
    state.core.update(changed as RollingNumberUpdate);
  } else if (!host.classList.contains('rn-rolling-number')) {
    // Vue patched the host's class (e.g. a `:class` change) and dropped the
    // library class: render() re-applies it (and the animating markers) and
    // returns early otherwise, since nothing else changed.
    state.core.render();
  }
}

/**
 * Directive that turns its host element into a rolling number
 * (`v-rolling-number`). Use it on a container element such as `<span>` or
 * `<div>` (form controls and SVG text get text mode), or point `target` at a
 * descendant.
 *
 * Server-side rendering: `getSSRProps` renders `role="img"`, the formatted
 * `aria-label` and `data-rn-ssr` on a container host, so the server HTML is
 * accessible before hydration; the client core takes these attributes over.
 * It renders nothing for a `target`, a component, or a tag that is not drawn
 * as columns (`input`, `textarea`, `option`, `select`, SVG, …; an explicit
 * `mode` is honored). Compiled SSR templates do not pass the tag to the
 * directive: give form controls an explicit `mode: 'text'` there.
 *
 * Register it locally (`<script setup>`: importing `vRollingNumber` is enough)
 * or globally with `app.directive('rolling-number', vRollingNumber)`.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { ref } from 'vue';
 * import { vRollingNumber } from 'rolling-number/vue';
 * const count = ref(0);
 * </script>
 *
 * <template>
 *   <span v-rolling-number="{ value: count, pad: 2 }" v-on:click="count++" />
 * </template>
 * ```
 */
export const vRollingNumber: ObjectDirective<HTMLElement, RollingNumberBinding> = {
  mounted(el, binding) {
    const existing = instanceMap.get(el);
    if (existing) {
      // The host already carries a core from this directive: reuse it instead of
      // stacking a second instance on top of the same DOM.
      applyBinding(el, existing, binding.value);
      return;
    }
    create(el, resolveHost(el, binding.value), toOptions(binding.value));
  },
  updated(el, binding) {
    const state = instanceMap.get(el);
    if (state) {
      // Parent re-renders that don't change the binding are a no-op: the comparison
      // runs against what was last applied, so in-place mutations of a reused options
      // object are still picked up. A re-render that only changes the host's
      // class still restores the library class.
      applyBinding(el, state, binding.value);
    }
  },
  unmounted(el) {
    const state = instanceMap.get(el);
    if (state) {
      state.core.destroy();
      instanceMap.delete(el);
    }
  },
  getSSRProps(binding, vnode) {
    const o = toObject(binding.value);
    // Compiled templates pass no vnode (the tag is unknown): treated as a container.
    const tag = vnode ? vnode.type : null;
    if (o.target || (vnode && typeof tag !== 'string')) return {};
    if (o.mode === 'text' || (o.mode !== 'columns' && typeof tag === 'string' && (NO_COLUMNS.has(tag) || NO_COLUMNS.has(tag.toLowerCase())))) {
      return {};
    }
    const opts = resolveOptions(o);
    const fmt = createFormatter(opts);
    const overflow = Math.abs(fmt.quantize(opts.value)) > fmt.maxA(opts.max);
    return { role: 'img', 'aria-label': resolveLabel(opts, fmt, opts.value, overflow), 'data-rn-ssr': '' };
  }
};
