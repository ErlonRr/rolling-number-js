import { defineComponent, h, onMounted, onUnmounted, ref, watch, type DefineComponent, type VNode } from 'vue';
import { RollingNumberCore, RN_DEFAULTS } from '../core';
import { OPTION_KEYS, RN_DEFAULTS_13, normalizeInterpolate, normalizeValue } from '../options';
import { renderStaticText } from '../ssr';
import type {
  RollingNumberEasing,
  RollingNumberEvent,
  RollingNumberFormat,
  RollingNumberLive,
  RollingNumberMode,
  RollingNumberOptions,
  RollingNumberSetValueOptions,
  RollingNumberSettled,
  RollingNumberTrigger,
  RollingNumberUpdate
} from '../types';
import { sameOption } from './shared';

/**
 * Props of the Vue `<RollingNumber>` component: every
 * {@link RollingNumberOptions | rolling number option} (all optional; invalid
 * values are normalized) plus `staticFallback` and the typed `rn-start` /
 * `rn-end` listeners. Fallthrough attributes (`class`, `style`, `aria-*`,
 * listeners) are applied to the rendered `<span>`.
 *
 * Absent props are passed to the core as unset, so `duration`, `easing` and
 * `decimals` keep their automatic values (CSS-driven timing, currency digits),
 * and removing a prop resets it.
 */
export interface RollingNumberProps extends Omit<RollingNumberOptions, 'interpolate'> {
  /**
   * `true`: count through the intermediate values. `false` or the string
   * `'false'` (plain attribute `interpolate="false"`): each digit rolls
   * straight to its new digit.
   * @default true
   */
  interpolate?: boolean | string;
  /**
   * `rn-start` listener (`v-on:rn-start`): the display starts moving. Receives the
   * DOM `CustomEvent`. Not declared as an emit: it falls through to the root
   * `<span>` as a native listener.
   */
  onRnStart?: (event: RollingNumberEvent) => void;
  /**
   * `rn-end` listener (`v-on:rn-end`): the display settled on the target. Receives
   * the DOM `CustomEvent`. Not declared as an emit: it falls through to the
   * root `<span>` as a native listener.
   */
  onRnEnd?: (event: RollingNumberEvent) => void;
  /**
   * Render the formatted `value` as a static `<span class="rn-ssr" data-rn-ssr>`
   * child, for SSR and no-JS readers. The counter hides it once mounted. Read
   * at creation.
   * @default false
   */
  staticFallback?: boolean;
}

/**
 * What a template ref to `<RollingNumber>` exposes (Vue ≥ 3.2): the current
 * props, the live core, the root element and the imperative methods.
 *
 * On Vue 3.0/3.1 (no `expose`) the component's full public instance is
 * returned instead: the props stay readable, the methods are not available.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { shallowRef } from 'vue';
 * import { RollingNumber, type RollingNumberInstance } from 'rolling-number/vue';
 * // shallowRef keeps `core` typed as RollingNumberCore (a deep ref would unwrap it).
 * const counter = shallowRef<RollingNumberInstance | null>(null);
 * const jump = () => counter.value?.setValue(1000).then(({ completed }) => console.log(completed));
 * </script>
 *
 * <template>
 *   <RollingNumber ref="counter" :value="0" />
 * </template>
 * ```
 */
export interface RollingNumberExposed {
  /** `value` prop. */
  readonly value: number;
  /** `pad` prop. */
  readonly pad: number;
  /** `max` prop. */
  readonly max: number | null;
  /** `interpolate` prop, normalized (`'false'` → `false`). */
  readonly interpolate: boolean;
  /** `duration` prop; 400 when unset (the 1.2 value). */
  readonly duration: number;
  /** `easing` prop (`undefined` = automatic). */
  readonly easing: RollingNumberEasing | undefined;
  /** `decimals` prop (`undefined` = automatic). */
  readonly decimals: number | undefined;
  /** `locale` prop. */
  readonly locale: string | readonly string[] | undefined;
  /** `format` prop. */
  readonly format: RollingNumberFormat | undefined;
  /** `prefixText` prop. */
  readonly prefixText: string;
  /** `suffixText` prop. */
  readonly suffixText: string;
  /** `overflowSuffix` prop. */
  readonly overflowSuffix: string;
  /** `mode` prop. */
  readonly mode: RollingNumberMode;
  /** `from` prop. */
  readonly from: number | null;
  /** `trigger` prop. */
  readonly trigger: RollingNumberTrigger;
  /** `label` prop (`undefined` = default label). */
  readonly label: RollingNumberOptions['label'] | undefined;
  /** `live` prop. */
  readonly live: RollingNumberLive;
  /** `injectStyles` prop (`true` when absent). */
  readonly injectStyles: boolean;
  /** The live core (`null` before mount and after unmount). */
  readonly core: RollingNumberCore | null;
  /** The rendered `<span>` (`null` before mount). */
  readonly el: HTMLElement | null;
  /**
   * Sets the target imperatively (see `RollingNumberCore#setValue`). The
   * `value` prop wins again on its next change. Without a core (before mount,
   * after unmount) resolves `{ value, completed: false }`.
   */
  setValue(value: number, animate?: boolean | RollingNumberSetValueOptions): Promise<RollingNumberSettled>;
  /** Resolves when the current motion settles (immediately when idle). */
  whenSettled(): Promise<RollingNumberSettled>;
  /** Jumps to the target now (final DOM, `rn-end`, promises resolve). No-op when idle. */
  finish(): void;
  /** Value on screen (signed, user units; fractional mid-count). */
  getDisplayValue(): number;
}

/** Alias of {@link RollingNumberExposed}: the type of a template ref to `<RollingNumber>`. */
export type RollingNumberInstance = RollingNumberExposed;

/** Unset options: `undefined` prop default, passed to the core as `null` (automatic). */
const UNSET = ['duration', 'easing', 'decimals', 'locale', 'format', 'label'];
/** Boolean props default to `undefined`: Vue's boolean casting would turn an absent prop into `false`. */
const BOOL = { type: Boolean, default: undefined };

/** Runtime props: defaults and Boolean casting only (the types come from {@link RollingNumberProps}). */
const props: Record<string, object> = { staticFallback: BOOL };
for (const key of OPTION_KEYS) {
  props[key] =
    key === 'interpolate'
      ? { type: [Boolean, String], default: RN_DEFAULTS_13.interpolate }
      : key === 'injectStyles'
        ? BOOL
        : { default: UNSET.includes(key) ? undefined : RN_DEFAULTS_13[key] };
}

/** Exposed value of an absent prop whose public type is not optional. */
const EXPOSED_FALLBACK: Record<string, unknown> = {
  duration: RN_DEFAULTS.duration,
  injectStyles: RN_DEFAULTS_13.injectStyles
};

// Explicitly typed so the published declaration does not depend on the arity of
// DefineComponent in the Vue version used to build the package (it differs
// between Vue 3.3, 3.4 and 3.5).
/**
 * Rolling number counter rendered as a `<span class="rn-rolling-number">`.
 * Prop changes animate/update the counter in place (only the changed props
 * reach the core); fallthrough attributes (`class`, `style`, `aria-*`,
 * listeners such as `v-on:rn-end`) land on the span.
 *
 * Props: every rolling number option (`value` 0, `pad` 1, `max` null,
 * `interpolate` true, `duration`/`easing`/`decimals` automatic, `locale`,
 * `format`, `prefixText`, `suffixText`, `overflowSuffix`, `mode`, `from`,
 * `trigger`, `label`, `live`, `injectStyles`) plus `staticFallback`.
 * A template ref exposes {@link RollingNumberExposed} (methods need Vue ≥ 3.2).
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { RollingNumber } from 'rolling-number/vue';
 * </script>
 *
 * <template>
 *   <RollingNumber :value="count" :pad="2" :max="99" overflow-suffix="+" class="badge"
 *     v-on:rn-end="(e) => console.log(e.detail.value)" />
 * </template>
 * ```
 */
export const RollingNumber: DefineComponent<RollingNumberProps, RollingNumberExposed> = defineComponent({
  name: 'RollingNumber',
  props,
  setup(rawProps, { expose }) {
    const p = rawProps as Record<string, unknown>;
    const rootEl = ref<HTMLElement | null>(null);
    let core: RollingNumberCore | null = null;
    let applied: RollingNumberUpdate = {};
    /** Every option, absent props as `null` (unset: the core's default or automatic value). */
    const read = (): RollingNumberUpdate => {
      const o: Record<string, unknown> = {};
      for (const key of OPTION_KEYS) o[key] = p[key] ?? null;
      return o;
    };

    // Created once and reused, so patches never write to it (the core hides it on mount).
    const fallback: VNode | null = p.staticFallback
      ? h('span', { class: 'rn-ssr', 'data-rn-ssr': '' }, renderStaticText(read() as RollingNumberOptions))
      : null;

    onMounted(() => {
      if (rootEl.value) {
        applied = read();
        core = new RollingNumberCore(rootEl.value, applied);
      }
    });

    // Forward only the options that actually changed (`from` is creation-only).
    watch(read, (next) => {
      if (!core) return;
      const changed: Record<string, unknown> = {};
      let any = false;
      for (const key of OPTION_KEYS) {
        if (key !== 'from' && !sameOption(next[key], applied[key])) {
          changed[key] = next[key];
          any = true;
        }
      }
      applied = next;
      if (any) core.update(changed);
    });

    onUnmounted(() => {
      if (core) {
        core.destroy();
        core = null;
      }
    });

    // Vue 3.0/3.1 have no `expose`: the full public instance (props included) stays the ref.
    if (typeof expose === 'function') {
      const api = {
        get core() {
          return core;
        },
        get el() {
          return rootEl.value;
        },
        setValue: (value: number, animate?: boolean | RollingNumberSetValueOptions) =>
          core ? core.setValue(value, animate) : Promise.resolve({ value: normalizeValue(value), completed: false }),
        whenSettled: () => (core ? core.whenSettled() : Promise.resolve({ value: normalizeValue(p.value), completed: false })),
        finish: () => core?.finish(),
        getDisplayValue: () => (core ? core.getDisplayValue() : normalizeValue(p.value))
      };
      for (const key of OPTION_KEYS) {
        Object.defineProperty(api, key, {
          enumerable: true,
          get: () =>
            key === 'interpolate'
              ? normalizeInterpolate(p.interpolate, RN_DEFAULTS_13.interpolate)
              : p[key] === undefined && key in EXPOSED_FALLBACK
                ? EXPOSED_FALLBACK[key]
                : p[key]
        });
      }
      expose(api);
    }

    // Declaring the class on the vnode lets Vue merge it with any fallthrough `class`
    // instead of overwriting the one the core adds to the host.
    return () => h('span', { ref: rootEl, class: 'rn-rolling-number' }, fallback ? [fallback] : undefined);
  }
}) as unknown as DefineComponent<RollingNumberProps, RollingNumberExposed>;
