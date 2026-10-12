// AOT check for the Angular entry (run after `pnpm run build`).
//
// 1. Compiles a tiny standalone component that uses `[rollingNumber]` with ngc
//    (strictTemplates), resolving `rolling-number/angular` through the
//    package's own exports and declarations, the way an app does. It covers the
//    1.x inputs, the v1.3 `rn*` inputs (bound and as attribute strings), the
//    `rnStart`/`rnEnd` outputs (`$event.detail.value`), the native `(rn-end)`
//    event and the `#c="rollingNumber"` template reference. A second component
//    with invalid bindings must fail to compile with one error per binding,
//    which proves the inputs and outputs are type-checked.
// 2. Links dist/angular.js with the Angular linker Babel plugin
//    (`unknownDeclarationVersionHandling: 'error'`), as the Angular CLI does for
//    libraries, and checks that no partial declaration (ɵɵngDeclare*) is left.
// 3. Imports the linked module in a fresh Node process WITHOUT
//    @angular/compiler: it only loads if linking produced full definitions
//    (ɵdir / ɵfac). @angular/common is partially compiled as well, so it is
//    linked the same way, as in an app build.
//
// Fails on any d.ts, input-type or linker incompatibility.
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ConsoleLogger,
  LogLevel,
  NodeJSFileSystem,
  formatDiagnostics,
  performCompilation,
  readConfiguration
} from '@angular/compiler-cli';
import { createEs2015LinkerPlugin } from '@angular/compiler-cli/linker/babel';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distAngular = join(root, 'dist', 'angular.js');
const work = join(root, 'node_modules', '.cache', 'rolling-number', 'ng-aot-check');

if (!existsSync(distAngular)) {
  console.error('ng-aot-check: dist/angular.js is missing, run "pnpm run build" first.');
  process.exit(1);
}

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`ok   ${label}`);
  } catch (err) {
    failures++;
    console.error(`FAIL ${label}\n     ${String(err && err.message ? err.message : err).replace(/\n/g, '\n     ')}`);
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}

// --- Fixture app: node_modules links to this package and to its Angular deps.
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, 'node_modules'), { recursive: true });
symlinkSync(root, join(work, 'node_modules', 'rolling-number'), 'dir');
for (const dep of ['@angular', 'rxjs', 'tslib']) {
  const target = join(root, 'node_modules', dep);
  if (existsSync(target)) symlinkSync(target, join(work, 'node_modules', dep), 'dir');
}

const component = (name, template) => `import { Component } from '@angular/core';
import {
  RollingNumberDirective,
  type RollingNumberEasing,
  type RollingNumberEvent,
  type RollingNumberFormat,
  type RollingNumberLabelInfo,
  type RollingNumberSettled
} from 'rolling-number/angular';

/** A PrimeNG p-inputNumber-like component: a host element that renders an <input>. */
@Component({ selector: 'p-input-number', standalone: true, template: '<input inputmode="decimal" />' })
export class FakeInputNumberComponent {}

@Component({
  selector: 'app-${name}',
  standalone: true,
  imports: [RollingNumberDirective, FakeInputNumberComponent],
  template: \`${template}\`
})
export class ${name[0].toUpperCase()}${name.slice(1)}Component {
  count = 5;
  label: string | null = '7';
  flag = false;
  price = 1234.5;
  easing: RollingNumberEasing = 'ease-out-expo';
  locales: readonly string[] = ['de-CH', 'en'];
  format: RollingNumberFormat = { style: 'unit', unit: 'kilometer-per-hour' };
  labelFn = (info: RollingNumberLabelInfo): string => info.text + ' points';
  last: number | null = null;
  settled: Promise<RollingNumberSettled> | null = null;
  onValue(value: number): void { this.last = value; }
  onEvent(event: RollingNumberEvent): void { this.last = event.detail.from; }
  keep(settled: Promise<RollingNumberSettled>): void { this.settled = settled; }
}
`;

writeFileSync(
  join(work, 'good.component.ts'),
  component(
    'good',
    `
    <span [rollingNumber]="count" [pad]="2" [max]="null" [duration]="600" interpolate></span>
    <span rollingNumber="42" pad="3" max="99" duration="600" interpolate="false"></span>
    <span [rollingNumber]="label" [interpolate]="flag" [max]="count"></span>
    <span rollingNumber="7" rnPad="3" rnMax="99" rnInterpolate="false" rnDuration="800" rnEasing="cubic-bezier(0.2, 1, 0.3, 1)"
          rnDecimals="2" rnLocale="de-DE, en" rnFormat='{"style":"currency","currency":"EUR"}' rnPrefixText="~"
          rnSuffixText=" pts" rnOverflowSuffix="+" rnMode="columns" rnFrom="0" rnTrigger="visible" rnLabel="{value} unread"
          rnLive rnInjectStyles="false" rnTarget="host"></span>
    <p-input-number [rollingNumber]="price" rnTarget="input" rnLive="assertive"></p-input-number>
    <span [rollingNumber]="price" [rnPad]="null" [rnMax]="count" [rnInterpolate]="flag" [rnDuration]="null" [duration]="undefined"
          [rnEasing]="easing" [rnDecimals]="2" [rnLocale]="locales" [rnFormat]="{ style: 'currency', currency: 'EUR', currencyDisplay: 'code' }"
          [rnPrefixText]="label" [rnSuffixText]="null" [rnOverflowSuffix]="'+'" [rnMode]="'text'" [rnFrom]="count"
          [rnTrigger]="'immediate'" [rnLabel]="labelFn" [rnLive]="flag" [rnInjectStyles]="flag" [rnTarget]="'auto'"
          (rnStart)="onValue($event.detail.value)" (rnEnd)="onEvent($event)" (rn-end)="onEvent($event)"
          #c="rollingNumber"></span>
    <span [rollingNumber]="count" [rnFormat]="format"></span>
    <button (click)="keep(c.setValue(count + 1, { motion: 'roll', duration: 300 })); c.finish(); keep(c.whenSettled())">
      {{ c.getDisplayValue() }} {{ c.core?.getText() }} {{ c.duration + 1 }} {{ c.rnDuration ?? 'auto' }}
    </button>
  `
  )
);
writeFileSync(
  join(work, 'bad.component.ts'),
  component(
    'bad',
    `
    <span [rollingNumber]="count" [pad]="{ wrong: true }"></span>
    <span rollingNumber="1" rnMode="sideways"></span>
    <span rollingNumber="1" [rnFormat]="{ style: 'currency' }"></span>
    <span rollingNumber="1" (rnEnd)="onValue($event.detail.nope)"></span>
    <span rollingNumber="1" (rn-end)="onValue($event.detail.missing)"></span>
    <span rollingNumber="1" #b="rollingNumber" (click)="b.setValue('5')"></span>
  `
  )
);

/** Diagnostics the bad component must produce: one per invalid binding. */
const expectedErrors = [
  ['an object bound to [pad]', /wrong/],
  ['an unknown rnMode attribute value', /sideways/],
  ['a currency format without currency', /currency/],
  ['an unknown property of $event.detail in (rnEnd)', /'nope'/],
  ['an unknown property of $event.detail in the native (rn-end) event', /'missing'/],
  ['a string passed to setValue() through the exportAs reference', /'string' is not assignable to parameter of type 'number'|"5"/]
];

function writeTsconfig(file, entry) {
  writeFileSync(
    join(work, file),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ES2022',
          moduleResolution: 'bundler',
          lib: ['ES2022', 'DOM'],
          strict: true,
          experimentalDecorators: true,
          skipLibCheck: true,
          types: [],
          outDir: `out-${entry}`
        },
        files: [`${entry}.component.ts`],
        angularCompilerOptions: {
          strictTemplates: true,
          strictInjectionParameters: true,
          strictInputAccessModifiers: true
        }
      },
      null,
      2
    )
  );
}

function compile(entry) {
  const tsconfig = `tsconfig.${entry}.json`;
  writeTsconfig(tsconfig, entry);
  const config = readConfiguration(join(work, tsconfig));
  if (config.errors.length) return config.errors;
  const { diagnostics } = performCompilation({ rootNames: config.rootNames, options: config.options });
  return diagnostics.filter((d) => d.category === 1 /* ts.DiagnosticCategory.Error */);
}

check('ngc (strictTemplates) compiles a standalone component using [rollingNumber]', () => {
  const errors = compile('good');
  assert(errors.length === 0, formatDiagnostics(errors));
  const out = readFileSync(join(work, 'out-good', 'good.component.js'), 'utf8');
  assert(/ɵɵdefineComponent/.test(out), 'no ɵɵdefineComponent in the ngc output');
  assert(/RollingNumberDirective/.test(out), 'the directive is not referenced by the compiled component');
});

check('ngc (strictTemplates) rejects invalid input, output and exportAs bindings', () => {
  const errors = compile('bad');
  const messages = errors.map((d) => formatDiagnostics([d]));
  const text = messages.join('\n');
  for (const [what, pattern] of expectedErrors) {
    assert(messages.some((m) => pattern.test(m)), `${what} was accepted: not type-checked.\nDiagnostics:\n${text}`);
  }
  assert(errors.length === expectedErrors.length, `expected ${expectedErrors.length} errors, got ${errors.length}:\n${text}`);
});

// --- Linker
const linkedDir = join(work, 'linked');
mkdirSync(linkedDir, { recursive: true });

// @babel/core is a dependency of @angular/compiler-cli: resolve it from there.
const requireFromCli = createRequire(realpathSync(join(root, 'node_modules', '@angular', 'compiler-cli', 'package.json')));
const babel = requireFromCli('@babel/core');

/** Runs the Angular linker on a file, as the Angular CLI does for libraries. */
function link(file) {
  const result = babel.transformSync(readFileSync(file, 'utf8'), {
    filename: file,
    babelrc: false,
    configFile: false,
    compact: false,
    sourceMaps: false,
    plugins: [
      createEs2015LinkerPlugin({
        fileSystem: new NodeJSFileSystem(),
        logger: new ConsoleLogger(LogLevel.warn),
        linkerJitMode: false,
        unknownDeclarationVersionHandling: 'error'
      })
    ]
  });
  assert(result && result.code, `no linker output for ${file}`);
  assert(!/ɵɵngDeclare/.test(result.code), `partial declarations left after linking ${file}`);
  return result.code;
}

check('the Angular linker links dist/angular.js (unknownDeclarationVersionHandling: error)', () => {
  const code = link(distAngular);
  assert(/ɵɵdefineDirective/.test(code), 'no ɵɵdefineDirective after linking');
  // The linked @angular/common sits next to it (see below).
  writeFileSync(join(linkedDir, 'angular.js'), code.replace(/(from\s*)(["'])@angular\/common\2/g, '$1$2./angular-common.js$2'));
  // Copy the shared chunks the entry imports (e.g. ./core-xxxx.js).
  for (const [, spec] of code.matchAll(/from\s*["'](\.\/[^"']+)["']/g)) {
    copyFileSync(join(root, 'dist', spec), join(linkedDir, spec));
  }
  const requireFromApp = createRequire(join(work, 'package.json'));
  const common = join(dirname(requireFromApp.resolve('@angular/common/package.json')), 'fesm2022', 'common.mjs');
  writeFileSync(join(linkedDir, 'angular-common.js'), link(common));
});

check('the linked directive loads without @angular/compiler (ɵdir / ɵfac)', () => {
  const probe = `
    const { RollingNumberDirective } = await import('./linked/angular.js');
    const dir = RollingNumberDirective.ɵdir;
    if (!dir || !RollingNumberDirective.ɵfac) throw new Error('missing ɵdir / ɵfac');
    if (JSON.stringify(dir.selectors) !== JSON.stringify([['', 'rollingNumber', '']])) {
      throw new Error('unexpected selectors ' + JSON.stringify(dir.selectors));
    }
    const inputs = [
      'rollingNumber', 'pad', 'max', 'interpolate', 'duration',
      'rnPad', 'rnMax', 'rnInterpolate', 'rnDuration', 'rnEasing', 'rnDecimals', 'rnLocale', 'rnFormat',
      'rnPrefixText', 'rnSuffixText', 'rnOverflowSuffix', 'rnMode', 'rnFrom', 'rnTrigger', 'rnLabel', 'rnLive',
      'rnInjectStyles', 'rnTarget'
    ];
    for (const input of inputs) {
      if (!(input in dir.inputs)) throw new Error('missing input ' + input);
    }
    for (const output of ['rnStart', 'rnEnd']) {
      if (!(output in dir.outputs)) throw new Error('missing output ' + output);
    }
    if (JSON.stringify(dir.exportAs) !== '["rollingNumber"]') throw new Error('unexpected exportAs ' + JSON.stringify(dir.exportAs));
    if (!dir.standalone) throw new Error('the directive is not standalone');
  `;
  writeFileSync(join(work, 'probe.mjs'), probe);
  const run = spawnSync(process.execPath, ['probe.mjs'], { cwd: work, encoding: 'utf8' });
  assert(run.status === 0, (run.stderr || run.stdout || `exit code ${run.status}`).trim());
});

if (failures) {
  console.error(`\nng-aot-check: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nng-aot-check: all checks passed');
