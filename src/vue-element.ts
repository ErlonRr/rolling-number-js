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
 * import 'rolling-number/style.css';
 * </script>
 *
 * <template>
 *   <rolling-number :value="count" pad="3" :max="99" interpolate="false" />
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

/**
 * Template typing of the `<rolling-number>` custom element in Vue: every HTML
 * attribute plus the typed options of {@link RollingNumberAttributes}.
 * Bindings such as `:value="count"` are set as DOM properties, plain
 * attributes such as `pad="3"` as strings; both are accepted.
 */
export type RollingNumberElementComponent = new () => RollingNumberElement & {
  /** Template prop types only: do not read `$props` on an element ref. */
  $props: Omit<HTMLAttributes, keyof RollingNumberAttributes> &
    RollingNumberAttributes &
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
