// Size gate (docs/design/v1.3.md §10): `pnpm size` (fails over budget) or
// `node scripts/size.mjs --report` (prints the table, always exits 0).
//
// Method
// - JS entries are bundled from src/ with esbuild: ESM, browser platform,
//   ES2020, minified, tree-shaken, peers external (react, react-dom, vue,
//   @angular/*, rxjs). The size is the gzip (level 9, node:zlib) of the
//   bundle. A Vite/Rollup build of the same code lands within a few percent.
// - `?inline` stylesheets (styles.ts → css/rules.css) are loaded as minified
//   text, as Vite embeds them. Plain `.css` imports (core.ts →
//   rolling-number.css, extracted to dist/style.css) are empty: the
//   stylesheet has its own row.
// - "(all chunks)": everything the entry pulls in, i.e. one bundle.
// - "(own code)" for the adapters: every import that leaves the adapter's
//   folder (`../core`, `../options`, …) is marked external, so only the
//   adapter's own code is measured. This matches dist/, where the adapter
//   entry imports the core chunk shared with the other entries.
//   Angular is measured on the ngc partial-compilation output
//   (node_modules/.cache/rolling-number/ngc/angular, what dist/angular.js is
//   built from); without it (no `pnpm build:ngc` yet) the decorator source is
//   measured instead and the row is marked approximate.
// - The IIFE and style.css rows measure dist/ as built (`pnpm build`); they
//   are skipped with a note when dist/ is missing.
// - 1 KB = 1024 bytes.
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build, transform } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportOnly = process.argv.includes('--report');
const KB = 1024;

const PEERS = ['react', 'react/*', 'react-dom', 'react-dom/*', 'vue', 'vue/*', '@angular/*', 'rxjs', 'rxjs/*'];
const ngcAngular = join(root, 'node_modules/.cache/rolling-number/ngc/angular');

/**
 * Budgets of docs/design/v1.3.md §10 (gzip, KB). `entry`: source bundled with
 * esbuild; `own`: folder whose code is measured alone; `file`: built file.
 */
const ROWS = [
  { name: 'rolling-number (all chunks)', entry: 'src/index.ts', budget: 11.0 },
  { name: 'rolling-number/action', entry: 'src/action-entry.ts', budget: 9.5 },
  { name: 'rolling-number/react (own code)', entry: 'src/react/index.ts', own: 'src/react', budget: 1.4 },
  { name: 'rolling-number/vue (own code)', entry: 'src/vue/index.ts', own: 'src/vue', budget: 1.8 },
  existsSync(join(ngcAngular, 'index.js'))
    ? { name: 'rolling-number/angular (own code)', entry: relative(root, join(ngcAngular, 'index.js')), own: relative(root, ngcAngular), budget: 2.4 }
    : { name: 'rolling-number/angular (own code)', entry: 'src/angular/index.ts', own: 'src/angular', budget: 2.4, note: 'approximate: decorator source, run "pnpm build:ngc" for the ngc output' },
  { name: 'rolling-number/ssr', entry: 'src/ssr-entry.ts', budget: 3.0 },
  { name: 'rolling-number/iife', file: 'dist/rolling-number.iife.js', budget: 11.5 },
  { name: 'style.css', file: 'dist/style.css', budget: 1.3 }
];

/** `import css from './x.css?inline'` → the minified stylesheet as a string (as Vite does). */
const inlineCss = {
  name: 'inline-css',
  setup(b) {
    b.onResolve({ filter: /\.css\?inline$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.replace(/\?inline$/, '')),
      namespace: 'css-inline'
    }));
    b.onLoad({ filter: /.*/, namespace: 'css-inline' }, async (args) => {
      const { code } = await transform(readFileSync(args.path, 'utf8'), { loader: 'css', minify: true });
      return { contents: code.trim(), loader: 'text' };
    });
  }
};

/** Marks every relative import that leaves `ownDir` as external (shared core chunk). */
function ownCodeOnly(ownDir) {
  const dir = resolve(root, ownDir) + sep;
  return {
    name: 'own-code-only',
    setup(b) {
      b.onResolve({ filter: /^\.\.?\// }, (args) => {
        if (args.kind === 'entry-point') return null;
        const target = resolve(args.resolveDir, args.path);
        return target.startsWith(dir) ? null : { path: args.path, external: true };
      });
    }
  };
}

/** Minified bundle of a source entry. */
async function bundle(row) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [join(root, row.entry)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    treeShaking: true,
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'silent',
    external: PEERS,
    loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [inlineCss, ...(row.own ? [ownCodeOnly(row.own)] : [])]
  });
  return Buffer.concat(result.outputFiles.map((f) => Buffer.from(f.contents)));
}

/** Measures one row: { min, gzip } in bytes, or { skipped } with a reason. */
async function measure(row) {
  let bytes;
  if (row.file) {
    const file = join(root, row.file);
    if (!existsSync(file)) return { skipped: `${row.file} missing, run "pnpm build"` };
    bytes = readFileSync(file);
  } else {
    bytes = await bundle(row);
  }
  return { min: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
}

const kb = (n) => `${(n / KB).toFixed(2)} KB`;
const results = [];
for (const row of ROWS) {
  try {
    results.push({ row, ...(await measure(row)) });
  } catch (err) {
    results.push({ row, error: err && err.message ? err.message : String(err) });
  }
}

const header = ['entry', 'minified', 'gzip', 'budget', 'status'];
const lines = results.map(({ row, min, gzip, skipped, error }) => {
  if (error) return [row.name, '-', '-', kb(row.budget * KB), `ERROR ${error.split('\n')[0]}`];
  if (skipped) return [row.name, '-', '-', kb(row.budget * KB), `skipped (${skipped})`];
  const over = gzip > row.budget * KB;
  const status = (over ? 'OVER' : 'ok') + (row.note ? ` (${row.note})` : '');
  return [row.name, kb(min), kb(gzip), kb(row.budget * KB), status];
});
const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
const fmt = (cells) => cells.map((c, i) => (i === 0 || i === cells.length - 1 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ').trimEnd();
console.log(fmt(header));
console.log(widths.map((w) => '-'.repeat(w)).join('  '));
for (const line of lines) console.log(fmt(line));

// GitHub Actions job summary.
if (process.env.GITHUB_STEP_SUMMARY) {
  const md = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...lines.map((l) => `| ${l.join(' | ')} |`)];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Bundle size (gzip -9)\n\n${md.join('\n')}\n`);
}

const over = results.filter((r) => r.gzip !== undefined && r.gzip > r.row.budget * KB);
const errors = results.filter((r) => r.error);
if (errors.length) {
  console.error(`\nsize: ${errors.length} entr${errors.length === 1 ? 'y' : 'ies'} failed to bundle`);
  process.exit(1);
}
if (over.length) {
  const msg = `size: ${over.length} entr${over.length === 1 ? 'y is' : 'ies are'} over budget`;
  if (reportOnly) {
    console.warn(`\n${msg} (--report: not failing)`);
  } else {
    console.error(`\n${msg}`);
    process.exit(1);
  }
} else {
  console.log('\nsize: every entry is within budget');
}
