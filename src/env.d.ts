/**
 * Build-time module shims (docs/design/v1.3.md §10). Included by
 * `tsconfig.json` and `tsconfig.build.json` (ngc). Not published: nothing in
 * the emitted declarations refers to these modules.
 */

/** `import css from './file.css?inline'`: the processed stylesheet as a string (Vite, Vitest with `test.css.include`, scripts/size.mjs). */
declare module '*.css?inline' {
  const css: string;
  export default css;
}
