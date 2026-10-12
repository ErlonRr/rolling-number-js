/**
 * `rolling-number/action`: the core and the generic {@link rollingNumber}
 * action, without side effects (does not register `<rolling-number>`).
 *
 * @packageDocumentation
 */
export { RollingNumberCore } from './core';
export { rollingNumber, type RollingNumberActionParam, type RollingNumberActionReturn } from './action';
export { configureRollingNumber, injectRollingNumberStyles } from './styles';
export type {
  RollingNumberConfig,
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
} from './types';
