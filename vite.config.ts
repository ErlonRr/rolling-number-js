import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: {
        'rolling-number': resolve(__dirname, 'src/index.ts'),
        'register': resolve(__dirname, 'src/register.ts'),
        'angular': resolve(__dirname, 'src/angular/index.ts'),
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
      external: ['@angular/core', '@angular/common', 'react', 'react-dom', 'vue'],
      output: {
        globals: {
          '@angular/core': 'ng.core',
          react: 'React',
          'react-dom': 'ReactDOM',
          vue: 'Vue'
        },
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
