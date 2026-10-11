import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announce, retainAnnouncer } from '../src/a11y';
import { makeHost } from './helpers';

const REGION = '[data-rn-live]';

/** Live regions directly inside `container`. */
function regionsIn(container: Element): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`:scope > ${REGION}`));
}

function allRegions(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(REGION));
}

/**
 * Runs the 300 ms debounce and the "set text" task. Under fake timers a 0 ms
 * timeout scheduled while timers run fires 1 ms later.
 */
function settle(): void {
  vi.advanceTimersByTime(301);
}

function dialog(attrs: Record<string, string> = {}, tag = 'dialog'): HTMLElement {
  const d = makeHost(tag);
  for (const [k, v] of Object.entries(attrs)) d.setAttribute(k, v);
  return d;
}

const releases: Array<() => void> = [];
function retain(host: Element): () => void {
  const release = retainAnnouncer(host);
  releases.push(release);
  return release;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const release of releases.splice(0)) release();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('announcer: regions', () => {
  it('retainAnnouncer creates one hidden region in body, before any announcement', () => {
    const host = makeHost();
    retain(host);
    const [region, ...rest] = regionsIn(document.body);
    expect(rest).toHaveLength(0);
    expect(region.localName).toBe('div');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
    expect(region.hasAttribute('data-rn-live')).toBe(true);
    expect(region.textContent).toBe('');
  });

  it('is visually hidden through CSSOM styles', () => {
    retain(makeHost());
    const style = regionsIn(document.body)[0].style;
    expect(style.getPropertyValue('position')).toBe('absolute');
    expect(style.getPropertyValue('width')).toBe('1px');
    expect(style.getPropertyValue('height')).toBe('1px');
    expect(style.getPropertyValue('overflow')).toBe('hidden');
    expect(style.getPropertyValue('white-space')).toBe('nowrap');
    expect(style.getPropertyValue('clip-path')).toBe('inset(50%)');
    expect(style.getPropertyPriority('position')).toBe('important');
  });

  it('hosts in the same container share one region', () => {
    retain(makeHost());
    retain(makeHost('div'));
    expect(allRegions()).toHaveLength(1);
  });

  it('a dialog and body get separate regions', () => {
    const d = dialog({ open: '' });
    const inner = makeHost('span', d);
    const outer = makeHost();
    retain(inner);
    retain(outer);
    expect(regionsIn(d)).toHaveLength(1);
    expect(regionsIn(document.body)).toHaveLength(1);

    announce(inner, 'in', 'polite');
    announce(outer, 'out', 'polite');
    settle();
    expect(regionsIn(d)[0].textContent).toBe('in');
    expect(regionsIn(document.body)[0].textContent).toBe('out');
  });

  it('an [aria-modal="true"] element is a container; aria-modal="false" is not', () => {
    const modal = dialog({ role: 'dialog', 'aria-modal': 'true' }, 'div');
    const notModal = dialog({ role: 'dialog', 'aria-modal': 'false' }, 'div');
    retain(makeHost('span', modal));
    retain(makeHost('span', notModal));
    expect(regionsIn(modal)).toHaveLength(1);
    expect(regionsIn(notModal)).toHaveLength(0);
    expect(regionsIn(document.body)).toHaveLength(1);
  });

  it('finds the dialog through an enclosing shadow root', () => {
    const d = dialog({ open: '' });
    const component = makeHost('div', d);
    const root = component.attachShadow({ mode: 'open' });
    const host = document.createElement('span');
    root.appendChild(host);
    retain(host);
    expect(regionsIn(d)).toHaveLength(1);
    expect(regionsIn(document.body)).toHaveLength(0);
  });
});

describe('announcer: ref-count and removal', () => {
  it('is removed when the last retained host is released; release is idempotent', () => {
    const a = makeHost();
    const b = makeHost();
    const releaseA = retain(a);
    const releaseB = retain(b);
    releaseA();
    releaseA();
    expect(allRegions()).toHaveLength(1);
    releaseB();
    expect(allRegions()).toHaveLength(0);
  });

  it('counts a host retained twice until both retains are released', () => {
    const host = makeHost();
    const first = retain(host);
    const second = retain(host);
    first();
    expect(allRegions()).toHaveLength(1);
    second();
    expect(allRegions()).toHaveLength(0);
  });

  it('is recreated by a later retain', () => {
    const host = makeHost();
    retain(host)();
    expect(allRegions()).toHaveLength(0);
    retain(host);
    expect(allRegions()).toHaveLength(1);
  });

  it('is removed from a disconnected container on release, even with hosts left', () => {
    const d = dialog({ open: '' });
    const a = makeHost('span', d);
    const b = makeHost('span', d);
    const releaseA = retain(a);
    retain(b);
    expect(regionsIn(d)).toHaveLength(1);
    d.remove();
    releaseA();
    expect(regionsIn(d)).toHaveLength(0);
  });

  it('is removed from a disconnected container on announce, and nothing is announced', () => {
    const d = dialog({ open: '' });
    const host = makeHost('span', d);
    retain(host);
    d.remove();
    announce(host, 'lost', 'polite');
    expect(regionsIn(d)).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(regionsIn(d)).toHaveLength(0);
    expect(allRegions()).toHaveLength(0);
  });

  it('a re-inserted container gets a fresh region on the next announcement', () => {
    const d = dialog({ open: '' });
    const host = makeHost('span', d);
    retain(host);
    d.remove();
    announce(host, 'lost', 'polite');
    vi.advanceTimersByTime(300);
    document.body.appendChild(d);
    announce(host, 'back', 'polite');
    settle();
    expect(regionsIn(d)).toHaveLength(1);
    expect(regionsIn(d)[0].textContent).toBe('back');
  });

  it('follows a host that moved into a dialog, and drops the region it left', () => {
    const host = makeHost();
    retain(host);
    expect(regionsIn(document.body)).toHaveLength(1);
    const d = dialog({ open: '' });
    d.appendChild(host);
    announce(host, 'moved', 'polite');
    settle();
    expect(regionsIn(d)[0].textContent).toBe('moved');
    expect(regionsIn(document.body)).toHaveLength(0);
  });

  it('re-appends a region that was removed from its container by someone else', () => {
    const host = makeHost();
    retain(host);
    const region = regionsIn(document.body)[0];
    region.remove();
    announce(host, '7', 'polite');
    settle();
    expect(regionsIn(document.body)).toEqual([region]);
    expect(region.textContent).toBe('7');
  });

  it('a full release cancels the pending announcement of that host', () => {
    const keep = makeHost();
    const host = makeHost();
    retain(keep);
    const release = retain(host);
    announce(host, 'gone', 'polite');
    release();
    vi.advanceTimersByTime(1000);
    expect(regionsIn(document.body)[0].textContent).toBe('');
  });
});

describe('announcer: debounce and text', () => {
  it('debounces 300 ms per host; the last text wins', () => {
    const host = makeHost();
    retain(host);
    const region = regionsIn(document.body)[0];
    announce(host, 'a', 'polite');
    vi.advanceTimersByTime(200);
    announce(host, 'b', 'polite');
    vi.advanceTimersByTime(299);
    expect(region.textContent).toBe('');
    vi.advanceTimersByTime(2);
    expect(region.textContent).toBe('b');
  });

  it('debounces each host independently', () => {
    const a = makeHost();
    const b = makeHost();
    retain(a);
    retain(b);
    const region = regionsIn(document.body)[0];
    announce(a, 'a', 'polite');
    vi.advanceTimersByTime(200);
    announce(b, 'b', 'polite');
    vi.advanceTimersByTime(101);
    expect(region.textContent).toBe('a');
    vi.advanceTimersByTime(200);
    expect(region.textContent).toBe('b');
  });

  it('clears the region, then sets the text on the next task', () => {
    const host = makeHost();
    retain(host);
    const region = regionsIn(document.body)[0];
    announce(host, 'first', 'polite');
    settle();
    expect(region.textContent).toBe('first');
    announce(host, 'second', 'polite');
    vi.advanceTimersToNextTimer(); // the debounce fires: clear
    expect(region.textContent).toBe('');
    vi.advanceTimersToNextTimer(); // next task: set
    expect(region.textContent).toBe('second');
  });

  it('joins texts flushed in the same task with ", "', () => {
    const a = makeHost();
    const b = makeHost();
    retain(a);
    retain(b);
    announce(a, '3 messages', 'polite');
    announce(b, '5 tasks', 'polite');
    settle();
    expect(regionsIn(document.body)[0].textContent).toBe('3 messages, 5 tasks');
  });

  it('aria-live follows the politeness of the latest announcement', () => {
    const a = makeHost();
    retain(a);
    const region = regionsIn(document.body)[0];
    announce(a, '1', 'assertive');
    settle();
    expect(region.getAttribute('aria-live')).toBe('assertive');
    announce(a, '2', 'polite');
    settle();
    expect(region.getAttribute('aria-live')).toBe('polite');
    announce(a, '3', 'assertive');
    vi.advanceTimersByTime(100);
    announce(a, '4', 'polite');
    settle();
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('4');
  });

  it('creates the region lazily on the first announcement without a retain', () => {
    // In a dialog: an unretained region stays until its container goes away.
    const d = dialog({ open: '' });
    const host = makeHost('span', d);
    announce(host, '9', 'polite');
    expect(allRegions()).toHaveLength(0);
    settle();
    expect(regionsIn(d)[0].textContent).toBe('9');
    d.remove();
    announce(host, '10', 'polite');
    expect(regionsIn(d)).toHaveLength(0);
  });

  it('an empty text announces nothing but replaces a pending text', () => {
    const host = makeHost();
    retain(host);
    const region = regionsIn(document.body)[0];
    announce(host, 'x', 'polite');
    announce(host, '', 'polite');
    vi.advanceTimersByTime(1000);
    expect(region.textContent).toBe('');
  });

  it('uses the host window timers (nothing is announced synchronously)', () => {
    const host = makeHost();
    retain(host);
    const spy = vi.spyOn(host.ownerDocument.defaultView as Window, 'setTimeout');
    announce(host, 'x', 'polite');
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 300);
    expect(regionsIn(document.body)[0].textContent).toBe('');
  });

  it('does nothing for a document without a window', () => {
    const doc = document.implementation.createHTMLDocument('');
    const host = doc.createElement('span');
    doc.body.appendChild(host);
    const view = vi.spyOn(doc, 'defaultView', 'get').mockReturnValue(null);
    const release = retainAnnouncer(host);
    expect(() => announce(host, 'x', 'polite')).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(doc.querySelector(REGION)?.textContent ?? '').toBe('');
    release();
    expect(doc.querySelectorAll(REGION)).toHaveLength(0);
    view.mockRestore();
  });
});
