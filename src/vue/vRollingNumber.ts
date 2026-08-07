import { ObjectDirective } from 'vue';
import { RollingNumberCore } from '../core';

const instanceMap = new WeakMap<HTMLElement, RollingNumberCore>();

export const vRollingNumber: ObjectDirective<HTMLElement, number | { value: number; pad?: number; max?: number | null }> = {
  mounted(el, binding) {
    const opts = typeof binding.value === 'object' && binding.value !== null
      ? binding.value
      : { value: Number(binding.value ?? 0) };

    const core = new RollingNumberCore(el, opts);
    instanceMap.set(el, core);
  },
  updated(el, binding) {
    const core = instanceMap.get(el);
    if (core) {
      const opts = typeof binding.value === 'object' && binding.value !== null
        ? binding.value
        : { value: Number(binding.value ?? 0) };
      core.update(opts);
    }
  },
  unmounted(el) {
    const core = instanceMap.get(el);
    if (core) {
      core.destroy();
      instanceMap.delete(el);
    }
  }
};
