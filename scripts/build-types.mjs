// Copies the declarations emitted by `ngc -p tsconfig.build.json` into dist/
// in two flavours, so they resolve under every TypeScript moduleResolution:
//   - *.d.ts  (ESM, "import" condition): relative specifiers get a `.js` extension
//   - *.d.cts (CJS, "require" condition): relative specifiers get a `.cjs` extension
// The Angular declarations carry the Ivy `ɵdir`/`ɵfac` static types that the
// Angular compiler needs in consumer apps, which is why they come from ngc.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inDir = join(root, 'node_modules/.cache/rolling-number/ngc');
const outDir = join(root, 'dist');

if (!existsSync(inDir)) {
  console.error(`build-types: missing ${relative(root, inDir)}, run "pnpm run build:ngc" first.`);
  process.exit(1);
}

/** Recursively lists the .d.ts files under a directory. */
function listDeclarations(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listDeclarations(full);
    return name.endsWith('.d.ts') ? [full] : [];
  });
}

/** Maps an extensionless relative specifier to its file or directory index. */
function withExtension(fromFile, specifier, ext) {
  if (!specifier.startsWith('.')) return specifier;
  if (/\.(c|m)?js$/.test(specifier)) return specifier.replace(/\.(c|m)?js$/, ext);
  const target = resolve(dirname(fromFile), specifier);
  if (existsSync(`${target}.d.ts`)) return `${specifier}${ext}`;
  if (existsSync(join(target, 'index.d.ts'))) return `${specifier}/index${ext}`;
  throw new Error(`build-types: cannot resolve "${specifier}" from ${relative(root, fromFile)}`);
}

/** Drops CSS side-effect imports and rewrites `from '...'`, `import '...'` and `import('...')` specifiers. */
function rewrite(fromFile, code, ext) {
  return code
    // Side-effect stylesheet imports (core.ts imports its CSS) mean nothing in types.
    .replace(/^import\s*['"][^'"]+\.css['"];?\r?\n/gm, '')
    .replace(/(\bfrom\s*|\bimport\s*)(['"])([^'"]+)\2/g, (_, kw, q, spec) => `${kw}${q}${withExtension(fromFile, spec, ext)}${q}`)
    .replace(/(\bimport\(\s*)(['"])([^'"]+)\2/g, (_, kw, q, spec) => `${kw}${q}${withExtension(fromFile, spec, ext)}${q}`);
}

const files = listDeclarations(inDir);
for (const file of files) {
  const rel = relative(inDir, file);
  const code = readFileSync(file, 'utf8');
  const base = join(outDir, rel.slice(0, -'.d.ts'.length));
  mkdirSync(dirname(base), { recursive: true });
  writeFileSync(`${base}.d.ts`, rewrite(file, code, '.js'));
  writeFileSync(`${base}.d.cts`, rewrite(file, code, '.cjs'));
}
// Type-only entry points (declarations only, e.g. the JSX augmentation) get an
// empty runtime module, so `import 'rolling-number/jsx'` also resolves in bundlers.
const TYPE_ONLY_ENTRIES = ['jsx', 'vue-element'];
for (const name of TYPE_ONLY_ENTRIES) {
  if (!existsSync(join(outDir, `${name}.d.ts`))) {
    console.error(`build-types: missing declarations for the type-only entry "${name}"`);
    process.exit(1);
  }
  const note = `// Type-only entry point of rolling-number: see ${name}.d.ts.\n`;
  writeFileSync(join(outDir, `${name}.js`), `${note}export {};\n`);
  writeFileSync(join(outDir, `${name}.cjs`), `${note}'use strict';\n`);
}
console.log(`build-types: wrote ${files.length} declarations (.d.ts + .d.cts) to dist/`);
