/**
 * Vue 3 bindings of rolling-number: the {@link RollingNumber} component and
 * the {@link vRollingNumber} directive. Remember to import
 * `rolling-number/style.css` once.
 *
 * Local imports in `<script setup>` are typed in templates out of the box.
 * This entry does not declare any global component or directive: apps that
 * register them globally (`app.component('RollingNumber', RollingNumber)`,
 * `app.directive('rolling-number', vRollingNumber)`) can opt in to global
 * template typing with a `GlobalComponents` / `GlobalDirectives` augmentation
 * in their own `env.d.ts` (see the README).
 *
 * To type the raw `<rolling-number>` custom element (used through
 * `rolling-number/register` with `compilerOptions.isCustomElement`), see
 * `rolling-number/vue-element`.
 *
 * @packageDocumentation
 */
export { vRollingNumber } from './vRollingNumber';
export type { RollingNumberBinding } from './vRollingNumber';
export { RollingNumber } from './RollingNumber';
export type { RollingNumberProps } from './RollingNumber';
