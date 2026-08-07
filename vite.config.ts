import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: {
        'rolling-number': resolve(__dirname, 'src/index.ts'),
        'register': resolve(__dirname, 'src/register.ts')
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
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') return 'style.css';
          return assetInfo.name || 'assets/[name][extname]';
        }
      }
    },
    sourcemap: true
  },
  plugins: [
    dts({
      rollupTypes: false,
      insertTypesEntry: true
    })
  ]
});

