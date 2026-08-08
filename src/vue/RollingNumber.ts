import { defineComponent, h, onMounted, onUnmounted, ref, watch, PropType } from 'vue';
import { RollingNumberCore } from '../core';

export const RollingNumber = defineComponent({
  name: 'RollingNumber',
  props: {
    value: { type: Number, default: 0 },
    pad: { type: Number, default: 1 },
    max: { type: [Number, Object] as PropType<number | null>, default: null },
    interpolate: { type: Boolean, default: true },
    duration: { type: Number, default: 400 }
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
          interpolate: props.interpolate,
          duration: props.duration
        });
      }
    });

    watch(
      () => [props.value, props.pad, props.max, props.interpolate, props.duration],
      ([value, pad, max, interpolate, duration]) => {
        if (core) {
          core.update({
            value: value as number,
            pad: pad as number,
            max: max as number | null,
            interpolate: interpolate as boolean,
            duration: duration as number
          });
        }
      }
    );

    onUnmounted(() => {
      if (core) {
        core.destroy();
        core = null;
      }
    });

    return () => h('span', { ref: rootEl });
  }
});
