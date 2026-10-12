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
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { RollingNumber, useRollingNumber, type RollingNumberProps } from '../src/react';
import { RollingNumberCore, getResolved, type RollingNumberOptions } from '../src/core';
import { defineRollingNumber } from '../src/element';
import { OPTION_ATTRIBUTES, OPTION_KEYS } from '../src/options';
import type { RollingNumberEvent, RollingNumberUpdate } from '../src/types';
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

    // R-settle (§11.1): from v1.3 a roll may be driven by rAF, the DOM is exact once settled.
    render(createElement(RollingNumber, { ...props, value: 75 }));
    act(() => {
      raf.runAll();
    });
    expect(digitsOf(span())).toBe('050');

    render(createElement(RollingNumber, { value: 75, interpolate: false }));
    act(() => {
      raf.runAll();
    });
    expect(digitsOf(span())).toBe('75');
    expect(raf.pending()).toBe(0);
    expect(span().hasAttribute('data-rn-state')).toBe(false);
    expect(span().classList.contains('rn-interpolating')).toBe(false);
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

/** One valid value for every option (`Required`: a new option must be added here). */
const EVERY_OPTION: Required<RollingNumberOptions> = {
  value: 1,
  pad: 2,
  max: 99,
  interpolate: true,
  duration: 300,
  easing: 'linear',
  decimals: 0,
  locale: 'en-US',
  format: { useGrouping: false },
  prefixText: '',
  suffixText: '',
  overflowSuffix: '+',
  mode: 'columns',
  from: 1,
  trigger: 'immediate',
  label: 'n={value}',
  live: 'off',
  injectStyles: false
};

/**
 * Whether the core hides an adopted `[data-rn-ssr]` child on mount (§8.3: WP6
 * core + WP3 renderer). The WP0 core stub does not, so the one assertion that
 * needs it is skipped until the WP6 core lands.
 */
const coreHidesSsrFallback = ((): boolean => {
  const host = document.createElement('span');
  const child = host.appendChild(document.createElement('span'));
  child.className = 'rn-ssr';
  child.setAttribute('data-rn-ssr', '');
  const core = new RollingNumberCore(host, { injectStyles: false });
  const hidden = child.hidden;
  core.destroy();
  return hidden;
})();

/** Settles the pending motion (instant changes settle in a microtask, animated ones on rAF). */
async function settle(core: RollingNumberCore): Promise<void> {
  await act(async () => {
    raf.runAll();
    await core.whenSettled();
  });
}

/**
 * Server HTML of `element`. In this DOM test environment the adapter picks
 * `useLayoutEffect`, which React's server renderer warns about; a real server
 * (no `window`) gets `useEffect` and no warning (asserted in react-ssr.test.ts).
 * Any other console error fails the test.
 */
function serverRender(element: ReactElement): string {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    return renderToString(element);
  } finally {
    const unexpected = error.mock.calls.filter((args) => !String(args[0]).includes('useLayoutEffect does nothing on the server'));
    error.mockRestore();
    expect(unexpected).toEqual([]);
  }
}

/** Puts server HTML in a new container attached to the document. */
function serverContainer(html: string): HTMLDivElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

describe('<RollingNumber> v1.3 props (React)', () => {
  it('calls onRnStart / onRnEnd with the DOM CustomEvent, through the latest handler (listeners attached once)', async () => {
    // The prototype that owns addEventListener for DOM elements (the DOM implementation's EventTarget).
    let proto: object = document.createElement('span');
    while (!Object.prototype.hasOwnProperty.call(proto, 'addEventListener')) proto = Object.getPrototypeOf(proto);
    const add = vi.spyOn(proto as EventTarget, 'addEventListener');
    const stale = vi.fn();
    const onRnStart = vi.fn();
    const onRnEnd = vi.fn();
    const coreRef = createRef<RollingNumberCore>();
    render(createElement(RollingNumber, { value: 1, onRnEnd: stale, coreRef }));
    render(createElement(RollingNumber, { value: 1, onRnEnd: vi.fn(), coreRef }));
    render(createElement(RollingNumber, { value: 2, onRnStart, onRnEnd, coreRef }));
    await settle(coreRef.current!);

    const host = span();
    const attached = add.mock.calls.filter(
      ([type], i) => add.mock.contexts[i] === host && (type === 'rn-start' || type === 'rn-end')
    );
    expect(attached.map(([type]) => type).sort()).toEqual(['rn-end', 'rn-start']);

    expect(stale).not.toHaveBeenCalled();
    expect(onRnStart).toHaveBeenCalledTimes(1);
    expect(onRnEnd).toHaveBeenCalledTimes(1);
    const start = onRnStart.mock.calls[0][0] as RollingNumberEvent;
    const end = onRnEnd.mock.calls[0][0] as RollingNumberEvent;
    expect(start).toBeInstanceOf(CustomEvent);
    expect(start.type).toBe('rn-start');
    expect(start.target).toBe(host);
    expect(start.detail).toMatchObject({ value: 2, from: 1 });
    expect(end.type).toBe('rn-end');
    expect(end.detail.value).toBe(2);
    expect(digitsOf(host)).toBe('2');
  });

  it('removes its listeners on unmount', () => {
    const onRnEnd = vi.fn();
    render(createElement(RollingNumber, { value: 1, onRnEnd }));
    const host = span();
    act(() => root.unmount());
    host.dispatchEvent(new CustomEvent('rn-end', { detail: { value: 1, from: 1, animated: false } }));
    expect(onRnEnd).not.toHaveBeenCalled();
    root = createRoot(container); // afterEach unmounts again
  });

  it('hands the core to coreRef (object or callback ref), null on unmount; ref stays the span', async () => {
    const coreRef = createRef<RollingNumberCore>();
    const spanRef = createRef<HTMLSpanElement>();
    render(createElement(RollingNumber, { value: 5, coreRef, ref: spanRef }));
    const core = coreRef.current!;
    expect(core).toBeInstanceOf(RollingNumberCore);
    expect(core.getHost()).toBe(span());
    expect(spanRef.current).toBe(span());

    // Imperative API through the ref.
    let settled: unknown;
    await act(async () => {
      settled = await core.setValue(9, { motion: 'none' });
    });
    expect(settled).toEqual({ value: 9, completed: true });
    expect(digitsOf(span())).toBe('9');

    // Swapping coreRef: the old ref is cleared, the new one gets the same core.
    const calls: (RollingNumberCore | null)[] = [];
    render(createElement(RollingNumber, { value: 5, coreRef: (c: RollingNumberCore | null) => void calls.push(c) }));
    expect(coreRef.current).toBeNull();
    expect(calls).toEqual([core]);

    render(createElement('div'));
    expect(calls).toEqual([core, null]);
  });

  it('coreRef holds the live core under StrictMode', () => {
    const coreRef = createRef<RollingNumberCore>();
    render(createElement(StrictMode, null, createElement(RollingNumber, { value: 3, coreRef })));
    const core = coreRef.current!;
    expect(core.getHost()).toBe(span());
    void core.setValue(4, { motion: 'none' });
    expect(digitsOf(span())).toBe('4');
    expect(span().querySelectorAll('.rn-col')).toHaveLength(1);
  });

  it('passes absent props to the core as null (unset), never RN_DEFAULTS.duration', () => {
    const coreRef = createRef<RollingNumberCore>();
    render(createElement(RollingNumber, { value: 1, coreRef }));
    const resolved = getResolved(coreRef.current!);
    expect(resolved.duration).toBeNull();
    expect(resolved.easing).toBeNull();
    expect(resolved.decimals).toBeNull();
    expect(resolved.locale).toBeNull();
    expect(resolved.format).toBeNull();
    expect(resolved.label).toBeNull();
    expect(resolved).toMatchObject({ value: 1, pad: 1, max: null, interpolate: true, prefixText: '' });
  });

  it('resets a removed prop: only the changed keys reach core.update, as null', () => {
    const coreRef = createRef<RollingNumberCore>();
    const update = vi.spyOn(RollingNumberCore.prototype, 'update');
    render(createElement(RollingNumber, { value: 5, duration: 900, easing: 'linear', decimals: 2, prefixText: '$', coreRef }));
    expect(getResolved(coreRef.current!)).toMatchObject({ duration: 900, easing: 'linear', decimals: 2, prefixText: '$' });

    render(createElement(RollingNumber, { value: 5, coreRef }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith({ duration: null, easing: null, decimals: null, prefixText: null });
    expect(getResolved(coreRef.current!)).toMatchObject({ duration: null, easing: null, decimals: null, prefixText: '' });
    act(() => {
      raf.runAll();
    });
    expect(digitsOf(span())).toBe('5');
  });

  it('compares format one level deep, locale arrays by element and functions by identity', () => {
    const coreRef = createRef<RollingNumberCore>();
    const update = vi.spyOn(RollingNumberCore.prototype, 'update');
    const label = () => 'n';
    const percent = (extra?: { signDisplay: 'always' }) => ({ style: 'percent' as const, ...extra });
    render(createElement(RollingNumber, { value: 1, locale: ['en-US'], label, format: percent(), coreRef }));
    // New but equal literals: no update.
    render(createElement(RollingNumber, { value: 1, locale: ['en-US'], label, format: percent(), coreRef }));
    expect(update).not.toHaveBeenCalled();

    const always = { signDisplay: 'always' } as const;
    render(createElement(RollingNumber, { value: 1, locale: ['en-US'], label, format: percent(always), coreRef }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith({ format: { style: 'percent', signDisplay: 'always' } });

    render(createElement(RollingNumber, { value: 1, locale: ['de-DE'], label, format: percent(always), coreRef }));
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith({ locale: ['de-DE'] });

    render(createElement(RollingNumber, { value: 1, locale: 'de-DE', label, format: percent(always), coreRef }));
    expect(update).toHaveBeenCalledTimes(3);
    expect(update).toHaveBeenLastCalledWith({ locale: 'de-DE' });

    const label2 = () => 'n';
    render(createElement(RollingNumber, { value: 1, locale: 'de-DE', label: label2, format: percent(always), coreRef }));
    expect(update).toHaveBeenCalledTimes(4);
    expect(update).toHaveBeenLastCalledWith({ label: label2 });
  });

  it('reads from at creation only', () => {
    const coreRef = createRef<RollingNumberCore>();
    const update = vi.spyOn(RollingNumberCore.prototype, 'update');
    render(createElement(RollingNumber, { value: 3, from: 0, coreRef }));
    render(createElement(RollingNumber, { value: 3, from: 1, coreRef }));
    render(createElement(RollingNumber, { value: 3, coreRef }));
    expect(update).not.toHaveBeenCalled();
    act(() => {
      raf.runAll();
    });
    expect(digitsOf(span())).toBe('3');
  });

  it('never passes option, event, coreRef or staticFallback props to the span', () => {
    const error = vi.spyOn(console, 'error');
    render(
      createElement(RollingNumber, {
        ...EVERY_OPTION,
        onRnStart: () => {},
        onRnEnd: () => {},
        coreRef: createRef<RollingNumberCore>(),
        staticFallback: false,
        id: 'counter'
      })
    );
    act(() => {
      raf.runAll();
    });
    expect(error).not.toHaveBeenCalled();
    const host = span();
    const forbidden = [
      ...OPTION_KEYS.map((k) => k.toLowerCase()),
      ...OPTION_KEYS.map((k) => OPTION_ATTRIBUTES[k]),
      'onrnstart',
      'onrnend',
      'coreref',
      'staticfallback'
    ];
    for (const name of forbidden) expect(host.hasAttribute(name), name).toBe(false);
    expect(host.id).toBe('counter');
    expect(host.querySelector('[data-rn-ssr]')).toBeNull();
  });
});

describe('<RollingNumber staticFallback> (React)', () => {
  it('renders a frozen .rn-ssr child before the columns; re-renders never touch it', () => {
    render(createElement(RollingNumber, { value: 42, staticFallback: true }));
    const host = span();
    const fallback = host.querySelector<HTMLElement>(':scope > [data-rn-ssr]')!;
    expect(fallback.className).toBe('rn-ssr');
    expect(fallback.getAttribute('data-rn-ssr')).toBe('');
    expect(fallback.textContent).toBe('42');
    expect(host.firstElementChild).toBe(fallback);
    expect(digitsOf(host)).toBe('42');

    // The core hides it on mount (WP6); React must never undo that nor patch the node.
    fallback.hidden = true;
    const text = fallback.firstChild;
    const observer = new MutationObserver(() => {});
    observer.observe(fallback, { attributes: true, childList: true, characterData: true, subtree: true });
    render(createElement(RollingNumber, { value: 7, staticFallback: true, className: 'x' }));
    // `staticFallback` is read at mount only.
    render(createElement(RollingNumber, { value: 7, className: 'x' }));
    act(() => {
      raf.runAll();
    });
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
    expect(host.querySelector(':scope > [data-rn-ssr]')).toBe(fallback);
    expect(fallback.firstChild).toBe(text);
    expect(fallback.textContent).toBe('42');
    expect(fallback.hidden).toBe(true);
    expect(digitsOf(host)).toBe('7');
  });

  it.runIf(coreHidesSsrFallback)('is hidden by the core once mounted', () => {
    render(createElement(RollingNumber, { value: 42, staticFallback: true }));
    expect(span().querySelector<HTMLElement>(':scope > [data-rn-ssr]')!.hidden).toBe(true);
  });

  it('hydrates the renderToString output without warnings', () => {
    const element = createElement(RollingNumber, { value: 1234, locale: 'en-US', staticFallback: true, id: 'n' });
    const html = serverRender(element);
    expect(html).toBe('<span id="n" class="rn-rolling-number"><span class="rn-ssr" data-rn-ssr="">1,234</span></span>');

    const host = serverContainer(html);
    const serverSpan = host.firstElementChild as HTMLSpanElement;
    const serverFallback = serverSpan.firstElementChild as HTMLSpanElement;
    const error = vi.spyOn(console, 'error');
    const onRecoverableError = vi.fn();
    let hydrated!: Root;
    act(() => {
      hydrated = hydrateRoot(host, element, { onRecoverableError });
    });
    expect(error).not.toHaveBeenCalled();
    expect(onRecoverableError).not.toHaveBeenCalled();
    // The server nodes were adopted, not re-created.
    expect(host.firstElementChild).toBe(serverSpan);
    expect(serverSpan.firstElementChild).toBe(serverFallback);
    expect(serverFallback.textContent).toBe('1,234');
    expect(serverSpan.getAttribute('role')).toBe('img');
    expect(digitsOf(serverSpan)).toBe('1234');

    act(() => hydrated.render(createElement(RollingNumber, { value: 99, locale: 'en-US', staticFallback: true, id: 'n' })));
    act(() => {
      raf.runAll();
    });
    expect(error).not.toHaveBeenCalled();
    expect(serverSpan.firstElementChild).toBe(serverFallback);
    expect(serverFallback.textContent).toBe('1,234');
    expect(digitsOf(serverSpan)).toBe('99');

    act(() => hydrated.unmount());
    host.remove();
  });

  it('hydrates without warnings when the server text differs (suppressHydrationWarning)', () => {
    const host = serverContainer(serverRender(createElement(RollingNumber, { value: 1, staticFallback: true })));
    const serverSpan = host.firstElementChild!;
    const error = vi.spyOn(console, 'error');
    const onRecoverableError = vi.fn();
    let hydrated!: Root;
    act(() => {
      hydrated = hydrateRoot(host, createElement(RollingNumber, { value: 2, staticFallback: true }), { onRecoverableError });
    });
    expect(error).not.toHaveBeenCalled();
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(host.firstElementChild).toBe(serverSpan);
    expect(digitsOf(serverSpan)).toBe('2');

    act(() => hydrated.unmount());
    host.remove();
  });
});

describe('useRollingNumber v1.3 (React)', () => {
  it('passes only the changed keys: undefined keeps the current value, null resets', () => {
    let core: RefObject<RollingNumberCore | null> | null = null;
    function Host({ options }: { options: RollingNumberUpdate }) {
      const ref = useRef<HTMLSpanElement>(null);
      core = useRollingNumber(ref, options);
      return createElement('span', { ref });
    }
    const update = vi.spyOn(RollingNumberCore.prototype, 'update');
    render(createElement(Host, { options: { value: 1, duration: 500, easing: 'linear', format: { style: 'percent' } } }));
    render(createElement(Host, { options: { value: 1, duration: 500, easing: 'linear', format: { style: 'percent' } } }));
    expect(update).not.toHaveBeenCalled();
    const live = core!.current!;

    render(createElement(Host, { options: { value: 1, duration: 500, format: { style: 'percent' } } }));
    expect(getResolved(live).easing).toBe('linear');

    render(createElement(Host, { options: { value: 1, duration: null, format: { style: 'percent' } } }));
    expect(update).toHaveBeenLastCalledWith({ duration: null });
    expect(getResolved(live).duration).toBeNull();
    expect(core!.current).toBe(live);
  });

  it('accepts any Element ref', () => {
    let core: RefObject<RollingNumberCore | null> | null = null;
    function Host() {
      const ref = useRef<Element | null>(null);
      core = useRollingNumber(ref, { value: 12 });
      return createElement('div', { ref });
    }
    render(createElement(Host));
    expect(core!.current!.getHost()).toBe(container.querySelector('div'));
    expect(digitsOf(container.querySelector('div')!)).toBe('12');
  });
});

describe('<rolling-number> custom element in React 18', () => {
  it('a re-render that changes `class` keeps the library class', () => {
    defineRollingNumber();
    render(createElement('rolling-number', { class: 'a', value: 5 }));
    const el = container.querySelector('rolling-number')!;
    expect(el.className).toBe('a rn-rolling-number');

    render(createElement('rolling-number', { class: 'b', value: 5 }));
    expect(el.className).toBe('b rn-rolling-number');
    expect(digitsOf(el)).toBe('5');

    render(createElement('rolling-number', { value: 5 })); // React removes the class attribute
    expect(el.className).toBe('rn-rolling-number');
  });
});
