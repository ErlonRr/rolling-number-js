/**
 * Type-only module: types `<rolling-number>` (the custom element) in React JSX.
 *
 * Included automatically by `rolling-number/react`. When you use the custom
 * element without the React wrapper, opt in once (e.g. in a `global.d.ts` or
 * your entry file):
 *
 * ```ts
 * import type {} from 'rolling-number/jsx';
 * // or: /// <reference types="rolling-number/jsx" />
 * ```
 *
 * It augments both the module-scoped `React.JSX` namespace (React 18.3+/19,
 * `"jsx": "react-jsx"`) and the legacy global `JSX` namespace (older
 * `@types/react`). Requires `@types/react`; non-React projects never load it.
 *
 * @example
 * ```tsx
 * import 'rolling-number/register';
 * import type {} from 'rolling-number/jsx';
 *
 * <rolling-number value={count} pad={3} max={99} interpolate={false} />;
 * ```
 *
 * @packageDocumentation
 */
import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import type { RollingNumberAttributes, RollingNumberElement } from './element';

/**
 * Props of `<rolling-number>` in React JSX: every HTML attribute plus the
 * typed rolling number options ({@link RollingNumberAttributes}). `children`
 * and `dangerouslySetInnerHTML` are not allowed, because the element renders
 * its own content. The `ref` receives the {@link RollingNumberElement}.
 */
export type RollingNumberJSXProps = Omit<
  DetailedHTMLProps<HTMLAttributes<RollingNumberElement>, RollingNumberElement>,
  keyof RollingNumberAttributes | 'children' | 'dangerouslySetInnerHTML'
> &
  RollingNumberAttributes;

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      /** Animated number counter custom element (`rolling-number/register`). */
      'rolling-number': RollingNumberJSXProps;
    }
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      /** Animated number counter custom element (`rolling-number/register`). */
      'rolling-number': RollingNumberJSXProps;
    }
  }
}
