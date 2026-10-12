/**
 * React bindings of rolling-number: the {@link RollingNumber} component and
 * the {@link useRollingNumber} hook. Also types the raw `<rolling-number>`
 * custom element in JSX (see `rolling-number/jsx`).
 *
 * The stylesheet is injected automatically (see `configureRollingNumber`);
 * `rolling-number/style.css` can still be imported for no-JS/SSR first paint.
 *
 * @packageDocumentation
 */
export { useRollingNumber } from './useRollingNumber';
export { RollingNumber, type RollingNumberProps } from './RollingNumber';
// Type-only: the core class (for `coreRef` / `useRef<RollingNumberCore>`) and the public option/event types.
export type { RollingNumberCore } from '../core';
export type {
  RollingNumberEasing,
  RollingNumberEasingName,
  RollingNumberEvent,
  RollingNumberEventDetail,
  RollingNumberEventMap,
  RollingNumberFormat,
  RollingNumberFormatBase,
  RollingNumberLabelInfo,
  RollingNumberLive,
  RollingNumberMode,
  RollingNumberOptions,
  RollingNumberSetValueOptions,
  RollingNumberSettled,
  RollingNumberTrigger,
  RollingNumberUnit,
  RollingNumberUpdate
} from '../types';
// Type-only: brings the JSX.IntrinsicElements['rolling-number'] augmentation along.
export type { RollingNumberJSXProps } from '../jsx';
