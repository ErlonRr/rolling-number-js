// Smoke test for the built package (run after `pnpm run build`).
// Imports every export path in plain Node (no DOM, no bundler) through the
// package's own name, both as ESM (import) and CJS (require), and checks a
// few invariants of the bundles that previously broke consumers.
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

if (failures) {
  console.error(`\nsmoke: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nsmoke: all checks passed');
