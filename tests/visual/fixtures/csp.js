// Loads the BUILT package under CSP (style-src 'self'): the stylesheet arrives through
// adoptedStyleSheets and every motion through CSSOM writes, both allowed by the policy.
import { RollingNumberCore } from '/dist/rolling-number.js';

const host = document.getElementById('core-host');
host.rnCore = new RollingNumberCore(host, { value: 42 });
document.documentElement.setAttribute('data-ready', '');
