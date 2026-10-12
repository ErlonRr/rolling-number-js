/**
 * Type-only module: types the `<rolling-number>` custom element in Vue
 * templates (Volar / vue-tsc), following the Vue docs pattern for custom
 * elements (`GlobalComponents` augmentation).
 *
 * Opt in once, e.g. in `env.d.ts`:
 *
 * ```ts
 * import type {} from 'rolling-number/vue-element';
 * ```
 *
 * and let Vue treat the tag as a custom element at runtime
 * (`vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'rolling-number' } } })`
 * in `vite.config.ts`).
 *
 * Note: if your app also types the Vue `RollingNumber` component globally
 * (an opt-in `GlobalComponents` augmentation of your own), Volar resolves
 * `<rolling-number>` to that component first. Use either the Vue component or
 * the custom element in a given project.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import 'rolling-number/register';
 * </script>
 *
 * <template>
 *   <rolling-number :value="count" pad="3" :max="99" overflow-suffix="+" no-interpolate
 *     :format="{ style: 'percent' }" @rn-end="(e) => console.log(e.detail.value)" />
 * </template>
 * ```
 *
 * @packageDocumentation
 */
import type {
  AllowedComponentProps,
  ComponentCustomProps,
  HTMLAttributes,
  VNodeProps
} from 'vue';
import type { RollingNumberAttributes, RollingNumberElement } from './element';
import type { RollingNumberEvent } from './types';

/**
 * Typed listeners of `<rolling-number>` in Vue templates (`@rn-start` /
 * `@rn-end`): the listener receives the DOM `CustomEvent`.
 */
export interface RollingNumberElementEvents {
  /** `@rn-start`: the display starts moving from rest. */
  onRnStart?: (event: RollingNumberEvent) => void;
  /** `@rn-end`: the display settled on the target. */
  onRnEnd?: (event: RollingNumberEvent) => void;
}

/** `'prefix-text'` → `'prefixText'`. */
type CamelCase<S extends string> = S extends `${infer Head}-${infer Tail}` ? `${Head}${Capitalize<CamelCase<Tail>>}` : S;

/**
 * {@link RollingNumberAttributes} under their camelCase names (`prefixText`,
 * `noInterpolate`, …): Volar checks template attributes by their camelized
 * name, so `prefix-text="…"` and `:prefixText="…"` are both typed.
 */
export type RollingNumberElementProps = {
  [K in keyof RollingNumberAttributes as K extends string ? CamelCase<K> : K]: RollingNumberAttributes[K];
};

/**
 * Template typing of the `<rolling-number>` custom element in Vue: every HTML
 * attribute plus the typed options of {@link RollingNumberAttributes} and the
 * `@rn-start` / `@rn-end` listeners. Bindings such as `:value="count"` are set
 * as DOM properties, plain attributes such as `pad="3"` as strings; both are
 * accepted.
 */
export type RollingNumberElementComponent = new () => RollingNumberElement & {
  /** Template prop types only: do not read `$props` on an element ref. */
  $props: Omit<
    HTMLAttributes,
    keyof RollingNumberAttributes | keyof RollingNumberElementProps | keyof RollingNumberElementEvents
  > &
    RollingNumberElementProps &
    RollingNumberAttributes &
    RollingNumberElementEvents &
    VNodeProps &
    AllowedComponentProps &
    ComponentCustomProps;
};

declare module 'vue' {
  interface GlobalComponents {
    /** `<rolling-number>` custom element (`rolling-number/register`). */
    'rolling-number': RollingNumberElementComponent;
  }
}
