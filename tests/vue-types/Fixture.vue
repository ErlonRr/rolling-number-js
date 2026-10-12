<script setup lang="ts">
// Template typing fixture of rolling-number/vue (`pnpm check:vue-types`).
// Every `@vue-expect-error` / `@ts-expect-error` below must stay an error.
import { ref, shallowRef } from 'vue';
import { RollingNumber, vRollingNumber, type RollingNumberInstance } from '../../src/vue';
import type { RollingNumberCore } from '../../src/core';
import type { RollingNumberEvent, RollingNumberFormat } from '../../src/types';

const count = ref(42);
const format: RollingNumberFormat = { style: 'currency', currency: 'EUR' };
const counter = shallowRef<RollingNumberInstance | null>(null);
const last = ref<number | null>(null);

function onEnd(event: RollingNumberEvent): void {
  last.value = event.detail.value;
}

function wrongHandler(event: string): string {
  return event;
}

function jump(): void {
  void counter.value?.setValue(count.value + 100, { motion: 'roll', duration: 600 }).then((settled) => {
    const done: boolean = settled.completed;
    const target: number = settled.value;
    void done;
    void target;
  });
  counter.value?.finish();
  const shown: number | undefined = counter.value?.getDisplayValue();
  const core: RollingNumberCore | null | undefined = counter.value?.core;
  const el: HTMLElement | null | undefined = counter.value?.el;
  const pad: number | undefined = counter.value?.pad;
  void shown;
  void core;
  void el;
  void pad;
  // @ts-expect-error setValue takes a number
  void counter.value?.setValue('100');
}
</script>

<template>
  <div>
    <RollingNumber
      ref="counter"
      :value="count"
      :pad="3"
      :max="999"
      interpolate="false"
      :duration="600"
      easing="ease-out-expo"
      :decimals="2"
      locale="de-DE"
      :format="format"
      prefix-text="~"
      suffix-text=" pts"
      overflow-suffix="+"
      mode="columns"
      :from="0"
      trigger="visible"
      label="Score: {value}"
      live="polite"
      :inject-styles="false"
      static-fallback
      class="badge"
      @rn-start="(e) => e.detail.value"
      @rn-end="onEnd"
      @click="jump"
    />
    <RollingNumber :value="count" @rn-end="(e) => (last = e.detail.from)" />
    <!-- @vue-expect-error the rn-start handler receives a RollingNumberEvent, not a string -->
    <RollingNumber :value="count" @rn-start="wrongHandler" />
    <!-- @vue-expect-error pad is a number -->
    <RollingNumber :value="count" :pad="'3'" />
    <!-- @vue-expect-error a currency format requires `currency` -->
    <RollingNumber :value="count" :format="{ style: 'currency' }" />
    <!-- @vue-expect-error mode is 'auto' | 'columns' | 'text' -->
    <RollingNumber :value="count" mode="rows" />
    <span v-rolling-number="count" />
    <span v-rolling-number="{ value: count, pad: 2, duration: null, target: '.n' }"><b class="n" /></span>
    <!-- @vue-expect-error the binding is a number, a string or an options object -->
    <span v-rolling-number="[count]" />
  </div>
</template>
