import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';

/**
 * The IIFE injects its stylesheet at runtime (`styles.ts` imports
 * `css/rules.css?inline`, which Vite embeds as a minified string), so the CSS
 * that Vite extracts from the plain `import './rolling-number.css'` in
 * `core.ts` is dropped instead of being emitted next to the script (and
 * overwriting dist/style.css, which the library build owns).
 */
function dropCssAssets(): Plugin {
  return {
    name: 'rolling-number:drop-css',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const name of Object.keys(bundle)) {
        if (name.endsWith('.css')) delete bundle[name];
      }
    }
  };
}

/**
 * Script-tag build: dist/rolling-number.iife.js, global `RollingNumber`
 * (docs/design/v1.3.md §10). Runs after the library build, into the same
 * dist/ (never emptied here). No declarations: `rolling-number/iife` is
 * import-only and untyped.
 */
export default defineConfig({
  // A public/ folder must never be copied into dist/.
  publicDir: false,
  build: {
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: resolve(__dirname, 'src/iife.ts'),
      name: 'RollingNumber',
      formats: ['iife'],
      fileName: () => 'rolling-number.iife.js'
    },
    rollupOptions: {
      output: {
        // A single self-contained classic script.
        inlineDynamicImports: true
      }
    },
    minify: 'esbuild',
    // Minifies the `?inline` stylesheet string embedded in the script.
    cssMinify: true,
    sourcemap: true
  },
  plugins: [dropCssAssets()]
});
