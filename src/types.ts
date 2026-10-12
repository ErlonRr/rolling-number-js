/**
 * Public types of rolling-number (options, events, formatting, configuration).
 * Types only: re-exported by every entry point. The DOM-free types live in
 * `public-types.ts` (the whole type graph of `rolling-number/ssr`), the DOM
 * event types in `events.ts`.
 *
 * @module
 */
export type {
  RollingNumberConfig,
  RollingNumberEasing,
  RollingNumberEasingName,
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
} from './public-types';
export type { RollingNumberEvent, RollingNumberEventDetail, RollingNumberEventMap } from './events';
