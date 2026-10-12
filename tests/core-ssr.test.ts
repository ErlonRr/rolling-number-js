import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Renderer } from '../src/internal/contracts';
import { RollingNumberCore } from '../src/core';
import { installRaf, makeHost, stubReducedMotion } from './helpers';

// The `adopt` flag the core passes to Renderer.mount() (§3.3, §8.3): true only
// when the host has a direct [data-rn-ssr] fallback child, for both renderers.

const mounts: Array<[kind: string, adopt: boolean]> = [];

function spyMount<T extends (...args: never[]) => Renderer>(create: T): T {
  return ((...args: Parameters<T>) => {
    const r = create(...args);
    const mount = r.mount.bind(r);
    r.mount = (rest, adopt) => {
      mounts.push([r.kind, adopt]);
      mount(rest, adopt);
    };
    return r;
  }) as T;
}

vi.mock('../src/renderers/text', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/renderers/text')>();
  return { ...m, createTextRenderer: spyMount(m.createTextRenderer) };
});
vi.mock('../src/renderers/columns', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/renderers/columns')>();
  return { ...m, createColumnsRenderer: spyMount(m.createColumnsRenderer) };
});

const cores: RollingNumberCore[] = [];

beforeEach(() => {
  installRaf();
  stubReducedMotion(false);
  mounts.length = 0;
});

afterEach(() => {
  for (const core of cores.splice(0)) core.destroy();
  document.body.replaceChildren();
});

function withFallback(): HTMLElement {
  const host = makeHost();
  const fallback = document.createElement('span');
  fallback.className = 'rn-ssr';
  fallback.setAttribute('data-rn-ssr', '');
  fallback.textContent = '42';
  host.appendChild(fallback);
  return host;
}

describe('Renderer.mount(rest, adopt)', () => {
  it('adopt is true only with a direct [data-rn-ssr] child, in both modes', () => {
    cores.push(new RollingNumberCore(makeHost(), { value: 1 }));
    cores.push(new RollingNumberCore(makeHost(), { value: 1, mode: 'text' }));
    cores.push(new RollingNumberCore(withFallback(), { value: 42 }));
    cores.push(new RollingNumberCore(withFallback(), { value: 42, mode: 'text' }));
    expect(mounts).toEqual([['columns', false], ['text', false], ['columns', true], ['text', true]]);
  });

  it('a mode swap mounts the new renderer with the same flag', () => {
    const core = new RollingNumberCore(withFallback(), { value: 42 });
    cores.push(core);
    core.update({ mode: 'text' });
    core.update({ mode: 'columns' });
    expect(mounts).toEqual([['columns', true], ['text', true], ['columns', true]]);
  });
});
