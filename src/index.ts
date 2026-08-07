export { RollingNumberCore, type RollingNumberOptions } from './core';
export { RollingNumberElement, defineRollingNumber } from './element';

import { defineRollingNumber } from './element';

// Auto-register when loaded via UMD / script tag
if (typeof window !== 'undefined' && 'customElements' in window) {
  defineRollingNumber();
}
