import { describe, expectTypeOf, it } from 'vitest';
import { createRef } from 'react';
import type { RollingNumberElement } from '../src/element';
import { RollingNumber } from '../src/react';
import type {} from '../src/jsx';

describe('JSX typing', () => {
  it('types the React component', () => {
    const ok = <RollingNumber value={5} pad={2} max={99} interpolate={false} duration={600} className="b" />;
    expectTypeOf(ok).not.toBeAny();
    // @ts-expect-error pad is numeric
    void (<RollingNumber pad="x" />);
    // @ts-expect-error children are not allowed
    void (<RollingNumber value={1}>text</RollingNumber>);
  });

  it('types the raw <rolling-number> custom element', () => {
    const ref = createRef<RollingNumberElement>();
    const ok = <rolling-number ref={ref} value={5} pad="3" max={null} interpolate="false" duration={600} className="x" />;
    expectTypeOf(ok).not.toBeAny();
    // @ts-expect-error not a numeric string
    void (<rolling-number pad="x" />);
    // @ts-expect-error interpolate only accepts booleans or 'true' / 'false'
    void (<rolling-number interpolate="nope" />);
  });
});
