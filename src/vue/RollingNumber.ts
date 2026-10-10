import { defineComponent, h, onMounted, onUnmounted, ref, watch, PropType, type DefineComponent } from 'vue';
import { RollingNumberCore, RollingNumberOptions, RN_DEFAULTS } from '../core';

/** Accepts booleans and the string forms used by plain attributes (`interpolate="false"`). */
function toInterpolate(value: boolean | string | null | undefined): boolean {
  return value === 'false' ? false : Boolean(value);
}

/**
 * Props of the Vue `<RollingNumber>` component. All optional; invalid values
 * are normalized (see {@link RollingNumberOptions}). Fallthrough attributes
 * (`class`, `style`, `aria-*`, listeners) are applied to the rendered `<span>`.
 */
export interface RollingNumberProps {
  /**
   * The number to display; decimals are rounded for display, non-finite → 0.
   * @default 0
   */
  value?: number;
  /**
   * Minimum number of digits, padded with leading zeros (1..64).
   * @default 1
   */
  pad?: number;
  /**
   * Upper bound of the displayed absolute value (e.g. `99`); `null` → no limit.
   * @default null
   */
  max?: number | null;
  /**
   * Count through the intermediate numbers on change. `false` or the string
   * `'false'` (plain attribute `interpolate="false"`) jumps straight to the new value.
   * @default true
   */
  interpolate?: boolean | string;
  /**
   * Interpolation duration in milliseconds.
   * @default 400
   */
  duration?: number;
}

// Explicitly typed so the published declaration does not depend on the arity of
// DefineComponent in the Vue version used to build the package (it differs
// between Vue 3.3, 3.4 and 3.5).
/**
 * Rolling number counter rendered as a `<span class="rn-rolling-number">`.
 * Prop changes animate/update the counter in place; fallthrough attributes
 * (`class`, `style`, `aria-*`, …) land on the span.
 *
 * Props: `value` (0), `pad` (1), `max` (null), `interpolate` (true),
 * `duration` (400 ms). Import `rolling-number/style.css` once.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { RollingNumber } from 'rolling-number/vue';
 * import 'rolling-number/style.css';
 * </script>
 *
 * <template>
 *   <RollingNumber :value="count" :pad="2" :max="99" :duration="600" class="badge" />
 * </template>
 * ```
 */
export const RollingNumber: DefineComponent<RollingNumberProps> = defineComponent({
  name: 'RollingNumber',
  props: {
    value: { type: Number, default: RN_DEFAULTS.value },
    pad: { type: Number, default: RN_DEFAULTS.pad },
    max: { type: [Number, Object] as PropType<number | null>, default: RN_DEFAULTS.max },
    interpolate: { type: [Boolean, String] as PropType<boolean | string>, default: RN_DEFAULTS.interpolate },
    duration: { type: Number, default: RN_DEFAULTS.duration }
  },
  setup(props) {
    const rootEl = ref<HTMLElement | null>(null);
    let core: RollingNumberCore | null = null;

    onMounted(() => {
      if (rootEl.value) {
        core = new RollingNumberCore(rootEl.value, {
          value: props.value,
          pad: props.pad,
          max: props.max,
          interpolate: toInterpolate(props.interpolate),
          duration: props.duration
        });
      }
    });

    // Forward only the fields that actually changed, so the core doesn't re-apply
    // (and re-render) options that are already up to date.
    watch(
      [
        () => props.value,
        () => props.pad,
        () => props.max,
        () => toInterpolate(props.interpolate),
        () => props.duration
      ],
      ([value, pad, max, interpolate, duration], [oldValue, oldPad, oldMax, oldInterpolate, oldDuration]) => {
        if (!core) return;
        const changed: RollingNumberOptions = {};
        if (!Object.is(pad, oldPad)) changed.pad = pad;
        if (!Object.is(max, oldMax)) changed.max = max;
        if (interpolate !== oldInterpolate) changed.interpolate = interpolate;
        if (!Object.is(duration, oldDuration)) changed.duration = duration;
        if (!Object.is(value, oldValue)) changed.value = value;
        core.update(changed);
      }
    );

    onUnmounted(() => {
      if (core) {
        core.destroy();
        core = null;
      }
    });

    // Declaring the class on the vnode lets Vue merge it with any fallthrough `class`
    // instead of overwriting the one the core adds to the host.
    return () => h('span', { ref: rootEl, class: 'rn-rolling-number' });
  }
});
