import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  StrictMode,
  act,
  createElement,
  createRef,
  useRef,
  useState,
  type ReactElement,
  type RefObject
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RollingNumber, useRollingNumber, type RollingNumberProps } from '../src/react';
import { RollingNumberCore, type RollingNumberOptions } from '../src/core';
import { digitsOf, installRaf, loose, stubReducedMotion, type RafController } from './helpers';

let raf: RafController;
let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  raf = installRaf();
  stubReducedMotion(false);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(element: ReactElement): void {
  act(() => root.render(element));
}

function span(): HTMLSpanElement {
  return container.querySelector('span')!;
}

describe('<RollingNumber> (React)', () => {
  it('mounts once under StrictMode (no duplicated columns)', () => {
    render(createElement(StrictMode, null, createElement(RollingNumber, { value: 42 })));
    expect(digitsOf(span())).toBe('42');
    expect(span().querySelectorAll('.rn-col')).toHaveLength(2);
    expect(span().getAttribute('role')).toBe('img');
  });

  it('forwards an object ref to the span', () => {
    const ref = createRef<HTMLSpanElement>();
    render(createElement(RollingNumber, { value: 1, ref }));
    expect(ref.current).toBe(span());
    expect(ref.current?.classList.contains('rn-rolling-number')).toBe(true);
  });

  it('forwards a callback ref and clears it on unmount', () => {
    const cb = vi.fn();
    render(createElement(RollingNumber, { value: 1, ref: cb }));
    expect(cb).toHaveBeenLastCalledWith(span());
    const swapped = createRef<HTMLSpanElement>();
    render(createElement(RollingNumber, { value: 1, ref: swapped }));
    expect(cb).toHaveBeenLastCalledWith(null);
    expect(swapped.current).toBe(span());
    render(createElement('div'));
    expect(swapped.current).toBeNull();
  });

  it('passes a React 19 callback-ref cleanup back to React instead of swallowing it', () => {
    const calls: unknown[] = [];
    const cleanup = vi.fn(() => calls.push('cleanup'));
    const consumerRef = (node: HTMLSpanElement | null) => {
      calls.push(node === null ? null : node.tagName);
      return cleanup;
    };
    // React 18 warns about a callback ref returning a function (as it does on a plain <span>).
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(createElement(RollingNumber, { value: 1, ref: consumerRef as unknown as RefObject<HTMLSpanElement> }));
    expect(calls).toEqual(['SPAN']);

    // React 18 ignores the value returned by a callback ref, so call the merged
    // ref attached to the span directly, the way React 19 does.
    const el = span();
    const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))!;
    const mergedRef = (el as unknown as Record<string, { ref: (node: HTMLSpanElement | null) => unknown }>)[fiberKey].ref;
    expect(typeof mergedRef).toBe('function');
    const returned = mergedRef(el);
    expect(typeof returned).toBe('function');
    expect(calls).toEqual(['SPAN', 'SPAN']);
    (returned as () => void)();
    expect(cleanup).toHaveBeenCalledTimes(1);
    // The consumer ref was never called with null by the cleanup path.
    expect(calls).toEqual(['SPAN', 'SPAN', 'cleanup']);
    warn.mockRestore();
  });

  it('returns no cleanup for object refs and callback refs without one', () => {
    const objectRef = createRef<HTMLSpanElement>();
    render(createElement(RollingNumber, { value: 1, ref: objectRef }));
    const el = span();
    const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))!;
    const mergedRef = (el as unknown as Record<string, { ref: (node: HTMLSpanElement | null) => unknown }>)[fiberKey].ref;
    expect(mergedRef(el)).toBeUndefined();
    expect(objectRef.current).toBe(el);

    const legacy = vi.fn();
    render(createElement(RollingNumber, { value: 1, ref: legacy }));
    const legacyRef = (span() as unknown as Record<string, { ref: (node: HTMLSpanElement | null) => unknown }>)[fiberKey].ref;
    expect(legacyRef(span())).toBeUndefined();
  });

  it('merges className with rn-rolling-number across updates', () => {
    render(createElement(RollingNumber, { value: 1, className: 'a' }));
    expect(span().className).toBe('rn-rolling-number a');
    render(createElement(RollingNumber, { value: 1, className: 'b' }));
    expect(span().classList.contains('rn-rolling-number')).toBe(true);
    expect(span().classList.contains('b')).toBe(true);
    expect(span().classList.contains('a')).toBe(false);
    render(createElement(RollingNumber, { value: 1 }));
    expect(span().className).toBe('rn-rolling-number');
  });

  it('keeps the animating markers when className changes mid-animation', () => {
    render(createElement(RollingNumber, { value: 0, className: 'a' }));
    render(createElement(RollingNumber, { value: 100, className: 'a' }));
    expect(span().getAttribute('data-rn-state')).toBe('animating');
    act(() => raf.frame(0));
    render(createElement(RollingNumber, { value: 100, className: 'b' }));
    act(() => raf.frame(100));
    expect(span().classList.contains('rn-rolling-number')).toBe(true);
    expect(span().classList.contains('rn-interpolating')).toBe(true);
    expect(span().getAttribute('data-rn-state')).toBe('animating');
    act(() => {
      raf.runAll(200);
    });
    expect(digitsOf(span())).toBe('100');
    expect(span().className).toBe('rn-rolling-number b');
  });

  it('applies prop updates and restores defaults when a prop is removed', () => {
    const props: RollingNumberProps = { value: 7, pad: 3, max: 50, interpolate: false };
    render(createElement(RollingNumber, props));
    expect(digitsOf(span())).toBe('007');

    render(createElement(RollingNumber, { ...props, value: 75 }));
    expect(digitsOf(span())).toBe('050');

    render(createElement(RollingNumber, { value: 75, interpolate: false }));
    expect(digitsOf(span())).toBe('75');
    expect(raf.requested()).toBe(0);
  });

  it('animates value changes when interpolate is on', () => {
    render(createElement(RollingNumber, { value: 0, duration: 200 }));
    render(createElement(RollingNumber, { value: 20, duration: 200 }));
    expect(raf.pending()).toBe(1);
    act(() => {
      raf.runAll();
    });
    expect(digitsOf(span())).toBe('20');
    expect(span().hasAttribute('data-rn-state')).toBe(false);
  });

  it('does not call core.update() when the parent re-renders with the same options', () => {
    const update = vi.spyOn(RollingNumberCore.prototype, 'update');
    render(createElement(RollingNumber, { value: 3, title: 'x' }));
    render(createElement(RollingNumber, { value: 3, title: 'y' }));
    expect(update).not.toHaveBeenCalled();
    expect(span().title).toBe('y');
  });

  it('passes span attributes through and drops children / dangerouslySetInnerHTML', () => {
    render(
      createElement(RollingNumber, loose<RollingNumberProps>({
        value: 12,
        id: 'counter',
        'aria-describedby': 'hint',
        children: 'should not render',
        dangerouslySetInnerHTML: { __html: '<b>x</b>' }
      }))
    );
    expect(span().id).toBe('counter');
    expect(span().getAttribute('aria-describedby')).toBe('hint');
    expect(span().textContent).not.toContain('should not render');
    expect(span().querySelector('b')).toBeNull();
    expect(digitsOf(span())).toBe('12');
  });

  it('cleans up on unmount, also in the middle of an animation', () => {
    render(createElement(RollingNumber, { value: 0 }));
    const el = span();
    render(createElement(RollingNumber, { value: 99 }));
    expect(raf.pending()).toBe(1);
    act(() => root.unmount());
    expect(raf.pending()).toBe(0);
    expect(el.querySelector('.rn-col')).toBeNull();
    root = createRoot(container); // afterEach unmounts again
  });

  it('has a displayName', () => {
    expect(RollingNumber.displayName).toBe('RollingNumber');
  });
});

describe('useRollingNumber (React)', () => {
  function Late({ show, value }: { show: boolean; value: number }) {
    const ref = useRef<HTMLSpanElement>(null);
    useRollingNumber(ref, { value, interpolate: false });
    return createElement('div', null, show ? createElement('span', { ref }) : null);
  }

  it('attaches to an element that mounts after the hook', () => {
    render(createElement(Late, { show: false, value: 5 }));
    expect(container.querySelector('span')).toBeNull();
    render(createElement(Late, { show: true, value: 5 }));
    expect(digitsOf(span())).toBe('5');
    render(createElement(Late, { show: true, value: 8 }));
    expect(digitsOf(span())).toBe('8');
    render(createElement(Late, { show: false, value: 8 }));
    expect(container.querySelector('.rn-col')).toBeNull();
  });

  it('moves to a new element when the ref target is swapped', () => {
    function Swap({ tag }: { tag: 'span' | 'div' }) {
      const ref = useRef<HTMLElement>(null);
      useRollingNumber(ref, { value: 34, interpolate: false });
      return createElement(tag, { ref, id: 'host' });
    }
    render(createElement(Swap, { tag: 'span' }));
    const first = container.querySelector('#host')!;
    expect(digitsOf(first)).toBe('34');
    render(createElement(Swap, { tag: 'div' }));
    const second = container.querySelector('#host')!;
    expect(second.tagName).toBe('DIV');
    expect(digitsOf(second)).toBe('34');
    expect(first.querySelector('.rn-col')).toBeNull();
  });

  it('returns the core and only updates it when an option changes', () => {
    let coreRef: RefObject<RollingNumberCore | null> | null = null;
    function Host(props: RollingNumberOptions & { label: string }) {
      const ref = useRef<HTMLSpanElement>(null);
      const { label, ...options } = props;
      coreRef = useRollingNumber(ref, options);
      return createElement('span', { ref, 'data-label': label });
    }
    const update = vi.spyOn(RollingNumberCore.prototype, 'update');
    render(createElement(Host, { value: 1, label: 'a', interpolate: false }));
    expect(coreRef!.current).toBeInstanceOf(RollingNumberCore);
    render(createElement(Host, { value: 1, label: 'b', interpolate: false }));
    expect(update).not.toHaveBeenCalled();
    render(createElement(Host, { value: 2, label: 'b', interpolate: false }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(digitsOf(span())).toBe('2');
    render(createElement(Host, { value: NaN, label: 'b', interpolate: false }));
    render(createElement(Host, { value: NaN, label: 'c', interpolate: false }));
    expect(update).toHaveBeenCalledTimes(2); // NaN → NaN is not a change
  });

  it('works under StrictMode (simulated unmount/remount)', () => {
    function Host() {
      const ref = useRef<HTMLSpanElement>(null);
      const [value] = useState(77);
      useRollingNumber(ref, { value });
      return createElement('span', { ref });
    }
    render(createElement(StrictMode, null, createElement(Host)));
    expect(digitsOf(span())).toBe('77');
    expect(span().querySelectorAll('.rn-col')).toHaveLength(2);
  });
});
