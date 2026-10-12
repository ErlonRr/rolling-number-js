import { defineConfig } from 'vitest/config';

/**
 * Unit/integration tests (happy-dom) for the core, the custom element and the
 * React/Vue/Angular adapters, plus type-level tests (`*.test-d.ts`, checked by
 * tsc through vitest's typecheck mode with tests/tsconfig.json).
 */
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    // Playwright specs (pnpm test:visual) are not vitest tests.
    exclude: ['tests/visual/**', 'node_modules/**'],
    // Without this, `?inline` CSS imports resolve to "" in tests and every
    // injected stylesheet would be empty.
    css: { include: [/rules\.css/] },
    restoreMocks: true,
    unstubGlobals: true,
    typecheck: {
      enabled: true,
      include: ['tests/**/*.test-d.ts', 'tests/**/*.test-d.tsx'],
      tsconfig: './tests/tsconfig.json'
    }
  }
});
