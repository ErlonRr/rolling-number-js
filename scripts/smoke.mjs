// Smoke test for the built package (run after `pnpm run build`).
// Imports every export path in plain Node (no DOM, no bundler) through the
// package's own name, both as ESM (import) and CJS (require), and checks a
// few invariants of the bundles that previously broke consumers: side-effect
// free entries, the script-tag (IIFE) build and the embedded stylesheet.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { checkManifest } from './smoke-manifest.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const require = createRequire(join(root, 'package.json'));

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`ok   ${label}`);
  } catch (err) {
    failures++;
    console.error(`FAIL ${label}\n     ${err && err.message ? err.message : err}`);
  }
}
async function checkAsync(label, fn) {
  try {
    await fn();
    console.log(`ok   ${label}`);
  } catch (err) {
    failures++;
    console.error(`FAIL ${label}\n     ${err && err.message ? err.message : err}`);
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/** Named exports every entry must provide. */
const expectedExports = {
  '.': [
    'RollingNumberCore', 'RollingNumberElement', 'defineRollingNumber', 'rollingNumber',
    'configureRollingNumber', 'injectRollingNumberStyles', 'renderStaticText', 'renderStaticHTML'
  ],
  './register': ['RollingNumberElement'],
  './action': ['RollingNumberCore', 'rollingNumber', 'configureRollingNumber', 'injectRollingNumberStyles'],
  './ssr': ['renderStaticText', 'renderStaticHTML'],
  // Script-tag build (global RollingNumber): checked with import() only; it has no ES exports.
  './iife': [],
  './angular': ['RollingNumberDirective'],
  './react': ['RollingNumber', 'useRollingNumber'],
  './vue': ['RollingNumber', 'vRollingNumber'],
  // Type-only entries (JSX / Vue template augmentations): empty runtime modules.
  './jsx': [],
  './vue-element': []
};

// Non-code exports: the stylesheet and the JSON metadata files.
const codeEntries = Object.keys(pkg.exports).filter((k) => !/\.(css|json)$/.test(k));
check('every code export path is covered by the smoke test', () => {
  const missing = codeEntries.filter((k) => !(k in expectedExports));
  assert(missing.length === 0, `no expectations for ${missing.join(', ')}`);
});

// The Angular entry ships Ivy partial declarations (ɵɵngDeclareDirective). In an
// app they are linked at build time; in plain Node they need the JIT compiler.
await import('@angular/compiler');

for (const subpath of codeEntries) {
  const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;

  await checkAsync(`import('${specifier}')`, async () => {
    const mod = await import(specifier);
    for (const name of expectedExports[subpath]) assert(name in mod, `missing export ${name}`);
  });

  // The IIFE is a classic script: no "require" condition.
  if (subpath === './iife') continue;

  check(`require('${specifier}')`, () => {
    let mod;
    try {
      mod = require(specifier);
    } catch (err) {
      // @angular/core is ESM-only: require() of it needs Node >= 20.19 / 22.12.
      if (err && err.code === 'ERR_REQUIRE_ESM' && subpath === './angular') {
        console.warn(`     (skipped: this Node version cannot require() the ESM-only @angular/core)`);
        return;
      }
      throw err;
    }
    for (const name of expectedExports[subpath]) assert(name in mod, `missing export ${name}`);
  });
}

await checkAsync('Angular directive is Ivy partial-compiled (ɵdir/ɵfac after JIT linking)', async () => {
  const { RollingNumberDirective } = await import(`${pkg.name}/angular`);
  assert(RollingNumberDirective.ɵdir, 'missing ɵdir');
  assert(RollingNumberDirective.ɵfac, 'missing ɵfac');
});

check(`'${pkg.name}/style.css' and '${pkg.name}/package.json' resolve`, () => {
  assert(statSync(require.resolve(`${pkg.name}/style.css`)).size > 0, 'empty style.css');
  assert(require(`${pkg.name}/package.json`).name === pkg.name, 'wrong package.json');
});

const dist = (file) => readFileSync(join(root, 'dist', file), 'utf8');

// Custom Elements Manifest and VS Code custom data (owned by the element work package).
checkManifest({ check, assert, require, root, pkg });

check('dist/react.js is a small client module without a bundled jsx-runtime', () => {
  const code = dist('react.js');
  assert(/^['"]use client['"];/.test(code), 'does not start with "use client"');
  assert(/^['"]use client['"];/.test(dist('react.cjs')), 'react.cjs does not start with "use client"');
  for (const file of ['react.js', 'react.cjs']) {
    const c = dist(file);
    assert(!/jsx-runtime|ReactCurrentOwner|__SECRET_INTERNALS|process\.env/.test(c), `${file} bundles React internals`);
  }
  const size = Buffer.byteLength(code);
  assert(size < 3 * 1024, `dist/react.js is ${size} bytes (limit 3 kB)`);
});

check('only the React entry is marked "use client"', () => {
  for (const file of ['rolling-number.js', 'register.js', 'vue.js', 'angular.js']) {
    assert(!/^['"]use client['"]/.test(dist(file)), `${file} starts with "use client"`);
  }
});

check('dist/angular.js contains ɵɵngDeclareDirective with minVersion <= 16.0.0', () => {
  const code = dist('angular.js');
  assert(code.includes('ɵɵngDeclareDirective'), 'no ɵɵngDeclareDirective');
  assert(!/Symbol\.metadata|__decorate/.test(code), 'contains decorator helpers (not AOT-compiled)');
  const versions = [...code.matchAll(/minVersion:\s*["'](\d+)\.(\d+)\.(\d+)["']/g)];
  assert(versions.length > 0, 'no minVersion found');
  for (const [, major, minor, patch] of versions) {
    const v = Number(major) * 1e6 + Number(minor) * 1e3 + Number(patch);
    assert(v <= 16e6, `minVersion ${major}.${minor}.${patch} > 16.0.0`);
  }
});

// --- Side effects, script-tag build and stylesheet injection (WP5) ---------

/** Members of the IIFE global `RollingNumber` (docs/design/v1.3.md §2.8), exactly. */
const iifeGlobalMembers = [
  'RollingNumberCore', 'RollingNumberElement', 'defineRollingNumber', 'rollingNumber',
  'configureRollingNumber', 'injectRollingNumberStyles', 'renderStaticText', 'renderStaticHTML'
];

/** Runs ESM code in a fresh Node process (cwd = the package, so its own name resolves) and returns its last stdout line. */
function runNode(code) {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8' });
  assert(run.status === 0, (run.stderr || run.stdout || `exit code ${run.status}`).trim());
  return run.stdout.trim().split('\n').pop();
}

/**
 * Child-process probe: imports `specifier` (and, with `cjs`, also requires it)
 * and reports what changed. With `dom`, a happy-dom window is installed as the
 * global DOM first, so module-level `window`/`customElements`/`document`
 * access would be visible. Prints JSON:
 * { added: new global keys, defined: <rolling-number> registered,
 *   adopted: document.adoptedStyleSheets.length, styles: <style> elements }.
 */
function probeSideEffects(specifier, { dom, cjs = false }) {
  const code = `
    import { createRequire } from 'node:module';
    let win = null;
    ${dom ? `
    const { Window } = await import('happy-dom');
    win = new Window({ url: 'https://example.test/' });
    for (const key of ['window', 'document', 'customElements', 'HTMLElement', 'Element', 'Node', 'CSSStyleSheet',
      'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'getComputedStyle', 'matchMedia',
      'requestAnimationFrame', 'cancelAnimationFrame']) {
      const value = win[key];
      globalThis[key] = typeof value === 'function' && /^[a-z]/.test(key) ? value.bind(win) : value;
    }` : ''}
    const before = new Set(Reflect.ownKeys(globalThis));
    await import(${JSON.stringify(specifier)});
    ${cjs ? `createRequire(process.cwd() + '/package.json')(${JSON.stringify(specifier)});` : ''}
    const added = Reflect.ownKeys(globalThis).filter((k) => !before.has(k)).map(String);
    const report = { added, defined: false, adopted: 0, styles: 0 };
    if (win) {
      report.defined = !!win.customElements.get('rolling-number');
      report.adopted = win.document.adoptedStyleSheets.length;
      report.styles = win.document.querySelectorAll('style').length;
      await win.happyDOM.close();
    }
    console.log(JSON.stringify(report));
  `;
  return JSON.parse(runNode(code));
}

for (const subpath of ['./ssr', './action']) {
  const specifier = `${pkg.name}/${subpath.slice(2)}`;
  check(`'${specifier}' has no side effects (ESM + CJS, without and with a DOM)`, () => {
    const bare = probeSideEffects(specifier, { dom: false, cjs: true });
    assert(bare.added.length === 0, `defines globals: ${bare.added.join(', ')}`);
    const withDom = probeSideEffects(specifier, { dom: true, cjs: true });
    assert(withDom.added.length === 0, `defines globals: ${withDom.added.join(', ')}`);
    assert(!withDom.defined, 'registers <rolling-number>');
    assert(withDom.adopted === 0 && withDom.styles === 0, 'injects styles at import time');
  });
}

check(`the side-effect probe detects side effects ('${pkg.name}' registers <rolling-number>)`, () => {
  const control = probeSideEffects(pkg.name, { dom: true });
  assert(control.defined, 'the root entry did not register <rolling-number> with a DOM: the probe is blind');
  assert(control.adopted === 0 && control.styles === 0, 'the root entry injects styles at import time (only counters do)');
});

check(`import('${pkg.name}/iife') in plain Node does not throw and leaves globals alone`, () => {
  const report = probeSideEffects(`${pkg.name}/iife`, { dom: false });
  assert(report.added.length === 0, `defines globals: ${report.added.join(', ')}`);
});

const iifeFile = join(root, 'dist', 'rolling-number.iife.js');

check('dist/rolling-number.iife.js is a self-contained, minified classic script with the stylesheet embedded', () => {
  assert(existsSync(iifeFile), 'missing (run "pnpm run build")');
  const code = readFileSync(iifeFile, 'utf8');
  assert(/^var RollingNumber\s*=/.test(code), 'does not start with "var RollingNumber ="');
  assert(!/^\s*(import|export)\b/m.test(code), 'contains ES module syntax');
  assert(!/\bimport\(/.test(code), 'contains a dynamic import()');
  assert(code.includes('.rn-col'), 'the injected stylesheet is not embedded');
  assert(!/:root\s*\{/.test(code), 'the embedded stylesheet contains :root defaults (only dist/style.css has them)');
  assert(code.split('\n').length <= 3, 'not minified');
  assert(existsSync(`${iifeFile}.map`), 'missing source map');
  assert(pkg.unpkg === './dist/rolling-number.iife.js' && pkg.jsdelivr === pkg.unpkg, 'unpkg/jsdelivr do not point to the IIFE');
});

/**
 * Runs the IIFE as a classic script in a happy-dom window (a vm context, so a
 * top-level `var` becomes a window property as in a browser), with
 * `document.currentScript` pointing to a `<script>` carrying `attrs`.
 */
function runIife(attrs, { constructableSheets = true } = {}) {
  const win = new Window({ url: 'https://example.test/' });
  if (!constructableSheets) win.CSSStyleSheet = undefined;
  const doc = win.document;
  const script = doc.createElement('script');
  for (const [name, value] of Object.entries(attrs)) script.setAttribute(name, value);
  doc.head.appendChild(script);
  Object.defineProperty(doc, 'currentScript', { configurable: true, get: () => script });
  try {
    vm.runInContext(readFileSync(iifeFile, 'utf8'), win, { filename: 'rolling-number.iife.js' });
  } finally {
    delete doc.currentScript;
  }
  // Symbol-keyed globals of a vm context are only visible from inside it.
  const config = () => JSON.parse(vm.runInContext('JSON.stringify(globalThis[Symbol.for("rolling-number.config")] ?? null)', win));
  return { win, doc, config };
}

await checkAsync('the IIFE defines the RollingNumber global with exactly the §2.8 members and registers <rolling-number>', async () => {
  const { win, doc, config } = runIife({});
  try {
    const api = win.RollingNumber;
    assert(api && typeof api === 'object', 'no RollingNumber global');
    const keys = Object.keys(api).sort();
    assert(keys.join() === [...iifeGlobalMembers].sort().join(), `members: ${keys.join(', ')}`);
    for (const name of iifeGlobalMembers) assert(typeof api[name] === 'function', `${name} is not a function`);
    assert(win.customElements.get('rolling-number') === api.RollingNumberElement, '<rolling-number> is not registered');
    const cfg = config();
    assert(cfg === null || (cfg.injectStyles === true && cfg.nonce === null), `unexpected config ${JSON.stringify(cfg)}`);
    // The embedded stylesheet reaches the document.
    api.injectRollingNumberStyles(doc);
    assert(doc.adoptedStyleSheets.length === 1, `adoptedStyleSheets: ${doc.adoptedStyleSheets.length}`);
    const rules = Array.from(doc.adoptedStyleSheets[0].cssRules, (r) => r.cssText).join('\n');
    assert(rules.includes('.rn-col'), 'the adopted sheet has no .rn-col rule');
  } finally {
    await win.happyDOM.close();
  }
});

await checkAsync('the IIFE reads nonce and data-rn-inject="false" from its <script> tag', async () => {
  const { win, doc, config } = runIife({ nonce: 'smoke-nonce', 'data-rn-inject': 'false' }, { constructableSheets: false });
  try {
    const cfg = config();
    assert(cfg && cfg.injectStyles === false && cfg.nonce === 'smoke-nonce', `config ${JSON.stringify(cfg)}`);
    // Without constructable sheets, the <style> fallback carries the nonce.
    win.RollingNumber.injectRollingNumberStyles(doc);
    const style = doc.head.querySelector('style[data-rn-style]');
    assert(style, 'no <style data-rn-style> fallback');
    assert(style.getAttribute('nonce') === 'smoke-nonce', `nonce ${style.getAttribute('nonce')}`);
    assert(style.textContent.includes('.rn-col'), 'empty fallback stylesheet');
  } finally {
    await win.happyDOM.close();
  }
});

await checkAsync('the ESM and CJS builds embed the injected stylesheet', async () => {
  const esm = await import(`${pkg.name}/action`);
  const cjs = require(`${pkg.name}/action`);
  for (const [label, mod] of [['ESM', esm], ['CJS', cjs]]) {
    const win = new Window({ url: 'https://example.test/' });
    try {
      mod.injectRollingNumberStyles(win.document);
      const sheets = win.document.adoptedStyleSheets;
      assert(sheets.length === 1, `${label}: adoptedStyleSheets ${sheets.length}`);
      const rules = Array.from(sheets[0].cssRules, (r) => r.cssText).join('\n');
      assert(rules.includes('.rn-col'), `${label}: the injected sheet has no .rn-col rule`);
    } finally {
      await win.happyDOM.close();
    }
  }
});

check('dist/style.css is the unlayered stylesheet (the IIFE build did not overwrite or drop it)', () => {
  const css = dist('style.css');
  assert(css.includes('.rn-col'), 'no .rn-col rule');
  assert(!/@layer\s+rolling-number/.test(css), 'dist/style.css must stay unlayered');
});

if (failures) {
  console.error(`\nsmoke: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nsmoke: all checks passed');
