import { defineConfig, type Plugin } from 'vite';
import { existsSync } from 'fs';
import { dirname, relative, resolve, sep } from 'path';

const srcDir = resolve(__dirname, 'src');
/** Output of `ngc -p tsconfig.build.json` (Ivy partial compilation + .d.ts). */
const ngcDir = resolve(__dirname, 'node_modules/.cache/rolling-number/ngc');
const ngcAngularEntry = resolve(ngcDir, 'angular/index.js');

/**
 * The Angular entry is bundled from the ngc partial-compiled JS
 * (ɵɵngDeclareDirective, processed by the Angular linker in consumer apps).
 * Imports from that output that leave the angular/ folder (e.g. `../core`)
 * are redirected to the TypeScript sources, so the core stays in the chunk
 * shared with the other entries instead of being duplicated.
 */
function angularPartialCompilation(): Plugin {
  return {
    name: 'rolling-number:angular-partial',
    apply: 'build',
    enforce: 'pre',
    buildStart() {
      if (!existsSync(ngcAngularEntry)) {
        this.error(
          `Missing ${relative(__dirname, ngcAngularEntry)}. ` +
            'Run "pnpm run build:ngc" first (or use "pnpm run build").'
        );
      }
    },
    resolveId(source, importer) {
      if (!importer || !importer.startsWith(ngcDir + sep) || !source.startsWith('.')) return null;
      const target = resolve(dirname(importer), source).replace(/\.js$/, '');
      if (target.startsWith(resolve(ngcDir, 'angular') + sep)) return null;
      const srcFile = resolve(srcDir, relative(ngcDir, target)) + '.ts';
      return existsSync(srcFile) ? srcFile : null;
    }
  };
}

/**
 * Escapes non-ASCII characters of the emitted stylesheet (the decorator's
 * U+2060/U+2007): a linked style.css served without a UTF-8 charset would
 * otherwise mis-decode them. The JS bundles are ES modules / CJS, always
 * decoded as UTF-8, and must keep Angular's ɵ identifiers verbatim.
 */
function asciiCss(): Plugin {
  return {
    name: 'rolling-number:ascii-css',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'asset' && file.fileName.endsWith('.css') && typeof file.source === 'string') {
          file.source = file.source.replace(/[^\x00-\x7f]/gu, (ch) => `\\${ch.codePointAt(0)!.toString(16)} `);
        }
      }
    }
  };
}

export default defineConfig({
  build: {
    lib: {
      entry: {
        'rolling-number': resolve(__dirname, 'src/index.ts'),
        'register': resolve(__dirname, 'src/register.ts'),
        // Side-effect-free core + action, and the DOM-free SSR helpers.
        'action': resolve(__dirname, 'src/action-entry.ts'),
        'ssr': resolve(__dirname, 'src/ssr-entry.ts'),
        'angular': ngcAngularEntry,
        'react': resolve(__dirname, 'src/react/index.ts'),
        'vue': resolve(__dirname, 'src/vue/index.ts')
      },
      name: 'RollingNumber',
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => {
        if (format === 'es') return `${entryName}.js`;
        if (format === 'cjs') return `${entryName}.cjs`;
        return `${entryName}.${format}.js`;
      }
    },
    rollupOptions: {
      // Every framework subpath (react/jsx-runtime, vue/server-renderer,
      // @angular/common, ...) stays external: peers are never bundled.
      external: [/^react($|\/)/, /^react-dom($|\/)/, /^vue($|\/)/, /^@angular\//],
      output: {
        globals: {
          '@angular/core': 'ng.core',
          '@angular/common': 'ng.common',
          react: 'React',
          'react-dom': 'ReactDOM',
          vue: 'Vue'
        },
        // React Server Components: mark only the React entry as a client module.
        banner: (chunk) => (chunk.isEntry && chunk.name === 'react' ? "'use client';" : ''),
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') return 'style.css';
          return assetInfo.name || 'assets/[name][extname]';
        }
      }
    },
    sourcemap: true
  },
  plugins: [angularPartialCompilation(), asciiCss()]
});
