import { defineConfig, type Alias, type Plugin } from 'vite';
import { createReadStream, existsSync, statSync } from 'fs';
import { basename, extname, resolve, sep } from 'path';

/**
 * Demo page (index.html) and the server of the visual suite.
 *
 * - serve (`vite --config vite.config.demo.ts`): `rolling-number` resolves to
 *   the TypeScript sources, so edits reload live.
 * - `pnpm build:demo` (build) and `pnpm preview`: `rolling-number` resolves
 *   to the built package in `dist/` (run `pnpm build` first), so the demo
 *   shows exactly what is published.
 * - `pnpm preview` also serves, next to the built demo, the files the
 *   Playwright suite loads without bundling (see {@link visualFixtures}).
 */

/** Package specifiers used by the demo → file in `dist/` (as in package.json "exports") and in `src/`. */
const ENTRIES: Record<string, [dist: string, src: string]> = {
  'rolling-number': ['rolling-number.js', 'index.ts'],
  'rolling-number/react': ['react.js', 'react/index.ts'],
  'rolling-number/vue': ['vue.js', 'vue/index.ts'],
  'rolling-number/style.css': ['style.css', 'rolling-number.css']
};

function aliases(fromSource: boolean): Alias[] {
  return Object.entries(ENTRIES).map(([id, [dist, src]]) => ({
    find: new RegExp(`^${id.replace(/[/.]/g, '\\$&')}$`),
    replacement: fromSource ? resolve(__dirname, 'src', src) : resolve(__dirname, 'dist', dist)
  }));
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

/** Policy of the fixture pages named `csp*.html` (docs/design/v1.3.md §11 WP11: a `style-src 'self'` page). */
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:";

/**
 * Preview-only middleware for the visual suite (tests/visual): serves, as
 * static files and without any transform,
 * - `/dist/**` → the built package (`dist/`), which the fixtures import
 *   directly (`/dist/rolling-number.js`, `/dist/rolling-number.iife.js`, …);
 * - `/fixtures/**` → `tests/visual/fixtures/`. Pages named `csp*.html` are
 *   sent with a `Content-Security-Policy` header.
 * Everything else falls through to the built demo.
 */
function visualFixtures(): Plugin {
  const mounts: [prefix: string, dir: string][] = [
    ['/dist/', resolve(__dirname, 'dist')],
    ['/fixtures/', resolve(__dirname, 'tests/visual/fixtures')]
  ];
  return {
    name: 'rolling-number:visual-fixtures',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url || '/').split(/[?#]/)[0]);
        const mount = mounts.find(([prefix]) => path.startsWith(prefix));
        if (!mount) return next();
        const [prefix, dir] = mount;
        const file = resolve(dir, '.' + sep + path.slice(prefix.length));
        let size = -1;
        try {
          if (file.startsWith(dir + sep)) {
            const stat = statSync(file);
            if (stat.isFile()) size = stat.size;
          }
        } catch {
          // Not found.
        }
        if (size < 0) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
        res.setHeader('Content-Length', String(size));
        res.setHeader('Cache-Control', 'no-store');
        if (/^csp.*\.html$/.test(basename(file))) res.setHeader('Content-Security-Policy', CSP);
        createReadStream(file).pipe(res);
      });
    }
  };
}

export default defineConfig(({ command, isPreview }) => {
  if (command === 'build' && !existsSync(resolve(__dirname, 'dist/rolling-number.js'))) {
    throw new Error('The demo is built from the package in dist/: run "pnpm build" before "pnpm build:demo".');
  }
  return {
    resolve: { alias: aliases(command === 'serve' && !isPreview) },
    // Vue feature flags (no Vue plugin here: the demo uses render functions).
    define: {
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
    },
    build: {
      outDir: 'dist-demo',
      emptyOutDir: true,
      rollupOptions: {
        onwarn(warning, warn) {
          // dist/react.js starts with 'use client' (for React Server Components); irrelevant in a bundle.
          if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
          warn(warning);
        }
      }
    },
    plugins: [visualFixtures()]
  };
});
