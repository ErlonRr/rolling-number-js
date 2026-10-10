import { ObjectDirective } from 'vue';
import { RollingNumberCore, RollingNumberOptions } from '../core';

/**
 * Value accepted by `v-rolling-number`: a plain number (or numeric string) or
 * an options object ({@link RollingNumberOptions}). With an object, fields left
 * `undefined` keep their current value.
 *
 * @example
 * ```vue
 * <span v-rolling-number="count" />
 * <span v-rolling-number="{ value: count, pad: 3, max: 999, duration: 600 }" />
 * ```
 */
export type RollingNumberBinding = number | string | RollingNumberOptions;

interface DirectiveState {
  core: RollingNumberCore;
  /** Raw options last forwarded to the core, used to skip no-op updates. */
  applied: RollingNumberOptions;
}

const OPTION_KEYS = ['value', 'pad', 'max', 'interpolate', 'duration'] as const;

const instanceMap = new WeakMap<HTMLElement, DirectiveState>();

function toOptions(binding: RollingNumberBinding | null | undefined): RollingNumberOptions {
  if (typeof binding === 'object' && binding !== null) {
    const opts: RollingNumberOptions = {};
    for (const key of OPTION_KEYS) {
      if (binding[key] !== undefined) {
        (opts as Record<string, unknown>)[key] = binding[key];
      }
    }
    return opts;
  }
  return { value: Number(binding ?? 0) };
}

/**
 * Returns only the fields of `next` that are defined and differ from `applied`
 * (undefined fields mean "unchanged", matching `RollingNumberCore.update()`).
 */
function diffOptions(applied: RollingNumberOptions, next: RollingNumberOptions): RollingNumberOptions | null {
  let changed: RollingNumberOptions | null = null;
  for (const key of OPTION_KEYS) {
    const value = next[key];
    if (value !== undefined && !Object.is(value, applied[key])) {
      changed = changed ?? {};
      (changed as Record<string, unknown>)[key] = value;
    }
  }
  return changed;
}

function applyBinding(el: HTMLElement, state: DirectiveState, binding: RollingNumberBinding | null | undefined): void {
  const changed = diffOptions(state.applied, toOptions(binding));
  if (changed) {
    Object.assign(state.applied, changed);
    state.core.update(changed);
  } else if (!el.classList.contains('rn-rolling-number')) {
    // Vue patched the host's class (e.g. a `:class` change) and dropped the
    // library class: render() re-applies it (and the animating markers) and
    // returns early otherwise, since nothing else changed.
    state.core.render();
  }
}

/**
 * Directive that turns its host element into a rolling number
 * (`v-rolling-number`). Use it on a container element such as `<span>` or
 * `<div>`; client-only (renders nothing extra on the server).
 *
 * Register it locally (`<script setup>`: importing `vRollingNumber` is enough)
 * or globally with `app.directive('rolling-number', vRollingNumber)`.
 * Import `rolling-number/style.css` once.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { ref } from 'vue';
 * import { vRollingNumber } from 'rolling-number/vue';
 * import 'rolling-number/style.css';
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

    const opts = toOptions(binding.value);
    const core = new RollingNumberCore(el, opts);
    instanceMap.set(el, { core, applied: { ...opts } });
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
  getSSRProps() {
    // The core is client-only; nothing to render on the server.
    return {};
  }
};
