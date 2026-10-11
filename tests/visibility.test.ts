import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeVisibility } from '../src/visibility';
import { installIntersectionObserver, makeEntry, removeIntersectionObserver } from './helpers/io';
import { makeHost } from './helpers';

type Handle = ReturnType<typeof observeVisibility>;
const handles: Handle[] = [];
function observe(el: Element, cb: (visible: boolean) => void = () => {}): Handle {
  const h = observeVisibility(el, cb);
  handles.push(h);
  return h;
}

afterEach(() => {
  for (const h of handles.splice(0)) h.stop();
  document.body.replaceChildren();
});

describe('observeVisibility with IntersectionObserver', () => {
  it('is null until the first callback, then follows the 25% threshold', () => {
    const io = installIntersectionObserver();
    const el = makeHost();
    const cb = vi.fn();
    const h = observe(el, cb);
    expect(h.visible).toBeNull();
    expect(cb).not.toHaveBeenCalled();
    expect(io.observed(el)).toBe(true);

    io.intersect(el, 0.5);
    expect(h.visible).toBe(true);
    expect(cb).toHaveBeenLastCalledWith(true);
    io.intersect(el, 0);
    expect(h.visible).toBe(false);
    expect(cb).toHaveBeenLastCalledWith(false);
    io.intersect(el, 0.1);
    expect(h.visible).toBe(false);
    io.intersect(el, 0.25);
    expect(h.visible).toBe(true);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('a first callback that reports hidden moves null → false', () => {
    const io = installIntersectionObserver();
    const el = makeHost();
    const cb = vi.fn();
    const h = observe(el, cb);
    io.intersect(el, false);
    expect(h.visible).toBe(false);
    expect(cb).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('creates the observer from the window with threshold 0.25', () => {
    const io = installIntersectionObserver();
    observe(makeHost());
    expect(io.observers).toHaveLength(1);
    expect(io.observers[0].options).toEqual({ threshold: 0.25 });
  });

  it('notifies only on changes, with the last entry of a batch winning', () => {
    const io = installIntersectionObserver();
    const el = makeHost();
    const cb = vi.fn();
    observe(el, cb);
    io.batch([makeEntry(el, 0), makeEntry(el, 1)]);
    expect(cb).toHaveBeenCalledExactlyOnceWith(true);
    io.intersect(el, 0.9);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('treats an intersecting zero-area element as visible', () => {
    const io = installIntersectionObserver();
    const el = makeHost();
    const h = observe(el);
    io.intersect(el, 0, { isIntersecting: true, width: 0, height: 0 });
    expect(h.visible).toBe(true);
    io.intersect(el, 0, { isIntersecting: false, width: 0, height: 0 });
    expect(h.visible).toBe(false);
  });

  it('shares one observer per document and disconnects it when the last element stops', () => {
    const io = installIntersectionObserver();
    const a = makeHost();
    const b = makeHost();
    const cbA = vi.fn();
    const cbB = vi.fn();
    const ha = observe(a, cbA);
    const hb = observe(b, cbB);
    expect(io.observers).toHaveLength(1);
    const shared = io.observers[0];
    expect([...shared.targets]).toEqual([a, b]);

    io.intersect(a, 1);
    expect(cbA).toHaveBeenCalledWith(true);
    expect(cbB).not.toHaveBeenCalled();
    expect(hb.visible).toBeNull();

    ha.stop();
    expect(io.observed(a)).toBe(false);
    expect(shared.disconnected).toBe(false);
    hb.stop();
    expect(shared.disconnected).toBe(true);
    expect(io.live()).toBe(0);

    observe(makeHost());
    expect(io.observers).toHaveLength(2);
  });

  it('stop() is idempotent and silences the callback; visible keeps its last value', () => {
    const io = installIntersectionObserver();
    const el = makeHost();
    const cb = vi.fn();
    const h = observe(el, cb);
    io.intersect(el, 1);
    h.stop();
    h.stop();
    io.intersect(el, 0);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(h.visible).toBe(true);
  });

  it('a second watcher of the same element gets its own first notification', () => {
    const io = installIntersectionObserver();
    const el = makeHost();
    const first = vi.fn();
    const second = vi.fn();
    const h1 = observe(el, first);
    io.intersect(el, 1);
    const h2 = observe(el, second);
    expect(h2.visible).toBeNull();
    // The element is observed again, so a real observer re-delivers its state.
    expect(io.observers[0].observeCalls).toBe(2);
    io.intersect(el, 1);
    expect(second).toHaveBeenCalledExactlyOnceWith(true);
    expect(first).toHaveBeenCalledTimes(1);

    h1.stop();
    expect(io.observed(el)).toBe(true);
    io.intersect(el, 0);
    expect(second).toHaveBeenLastCalledWith(false);
    expect(first).toHaveBeenCalledTimes(1);
    h2.stop();
    expect(io.observed(el)).toBe(false);
  });

  it('a callback may stop another watcher of the same element', () => {
    const io = installIntersectionObserver();
    const el = makeHost();
    const late = vi.fn();
    let h2: Handle | null = null;
    observe(el, () => h2?.stop());
    h2 = observe(el, late);
    io.intersect(el, 1);
    expect(late).not.toHaveBeenCalled();
  });
});

describe('observeVisibility without IntersectionObserver', () => {
  it('calls cb(true) synchronously and reports visible', () => {
    removeIntersectionObserver();
    const cb = vi.fn();
    const h = observe(makeHost(), cb);
    expect(cb).toHaveBeenCalledExactlyOnceWith(true);
    expect(h.visible).toBe(true);
    expect(() => h.stop()).not.toThrow();
  });

  it('calls cb(true) synchronously for a document without a window', () => {
    installIntersectionObserver();
    const doc = document.implementation.createHTMLDocument('');
    const el = doc.createElement('span');
    doc.body.appendChild(el);
    const view = vi.spyOn(doc, 'defaultView', 'get').mockReturnValue(null);
    const cb = vi.fn();
    const h = observe(el, cb);
    expect(cb).toHaveBeenCalledExactlyOnceWith(true);
    expect(h.visible).toBe(true);
    view.mockRestore();
  });

  it('falls back to visible when the constructor throws', () => {
    vi.stubGlobal('IntersectionObserver', function Broken() {
      throw new Error('unsupported');
    });
    const cb = vi.fn();
    const h = observe(makeHost(), cb);
    expect(cb).toHaveBeenCalledExactlyOnceWith(true);
    expect(h.visible).toBe(true);
  });
});
