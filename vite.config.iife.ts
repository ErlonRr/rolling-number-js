import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';

/**
 * The IIFE injects its stylesheet at runtime, so the CSS that Vite extracts
 * from `core.ts` is dropped instead of being emitted next to the script.
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

/** Script-tag build: dist/rolling-number.iife.js, global `RollingNumber`. Runs after the library build. */
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/iife.ts'),
      name: 'RollingNumber',
      formats: ['iife'],
      fileName: () => 'rolling-number.iife.js'
    },
    minify: true,
    sourcemap: true
  },
  plugins: [dropCssAssets()]
});
