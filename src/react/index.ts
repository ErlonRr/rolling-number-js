/**
 * React bindings of rolling-number: the {@link RollingNumber} component and
 * the {@link useRollingNumber} hook. Also types the raw `<rolling-number>`
 * custom element in JSX (see `rolling-number/jsx`).
 *
 * Remember to import `rolling-number/style.css` once.
 *
 * @packageDocumentation
 */
export { useRollingNumber } from './useRollingNumber';
export { RollingNumber, type RollingNumberProps } from './RollingNumber';
// Type-only: brings the JSX.IntrinsicElements['rolling-number'] augmentation along.
export type { RollingNumberJSXProps } from '../jsx';
