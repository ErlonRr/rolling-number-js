/**
 * Rendering of the §4.3 stylesheet in real engines: window geometry (§14.2),
 * the wrap cell (B19), stable column width (I07), RTL isolation (B08) and
 * the opt-in effects `--rn-fill` (C1), `--rn-bleed` (C2), `--rn-decoration`
 * (C3, risk R10).
 *
 * Pixel checks compare two screenshots taken in the same run (same engine,
 * same fonts), never stored baselines, so they hold on any machine.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { addCounter, decodePng, diffImages, inkPixels, lineRows, openStage, sampleHost, setValue, stepFrames } from './_harness';

test.beforeEach(async ({ page }) => {
  await openStage(page);
});

/** Box geometry of the first column of `host` (px). */
async function geometry(host: Locator) {
  return host.evaluate((el) => {
    const col = el.querySelector<HTMLElement>('.rn-col')!;
    const scale = col.querySelector<HTMLElement>('.rn-scale')!;
    const cell = scale.querySelector<HTMLElement>('.rn-cell')!;
    const after = getComputedStyle(scale, '::after');
    return {
      host: el.getBoundingClientRect().height,
      col: col.getBoundingClientRect().height,
      cell: cell.getBoundingClientRect().height,
      scale: scale.getBoundingClientRect().height,
      wrapTop: parseFloat(after.top),
      wrapHeight: parseFloat(after.height),
      wrapContent: after.content
    };
  });
}

test.describe('geometry (§14.2)', () => {
  const cases = [
    { name: 'default', style: 'font-size: 40px', window: 40 },
    { name: '--rn-lh: 1.5', style: 'font-size: 40px; --rn-lh: 1.5', window: 60 },
    { name: 'host line-height: 1.5', style: 'font-size: 40px; line-height: 1.5', window: 60 }
  ];
  for (const c of cases) {
    test(`${c.name}: host = column = cell, scale = 10 cells, wrap cell right below`, async ({ page }) => {
      const host = await addCounter(page, 'n', { value: 7 }, { style: c.style });
      const g = await geometry(host);
      expect(g.host).toBeCloseTo(c.window, 1);
      expect(g.col).toBeCloseTo(c.window, 1);
      expect(g.cell).toBeCloseTo(c.window, 1);
      expect(g.scale).toBeCloseTo(10 * c.window, 1);
      expect(g.wrapTop).toBeCloseTo(10 * c.window, 1);
      expect(g.wrapHeight).toBeCloseTo(c.window, 1);
      expect(g.wrapContent).toBe('"0"');
    });
  }

  test('a moving column keeps the window height (no partial neighbor cells)', async ({ page }) => {
    const host = await addCounter(page, 'n', { value: 1 }, { style: 'font-size: 40px; line-height: 1.5' });
    await setValue(host, 9);
    await stepFrames(page, 4);
    const g = await geometry(host);
    expect(g.col).toBeCloseTo(60, 1);
    expect(g.cell).toBeCloseTo(60, 1);
  });
});

/** Column screenshots of hosts placed at the same x, one per row. */
async function rows(page: Page, ids: string[]): Promise<void> {
  await page.evaluate((list) => {
    const stage = document.getElementById('stage')!;
    for (const id of list) {
      const row = document.createElement('div');
      row.id = 'row-' + id;
      row.style.cssText = 'height: 80px; display: block';
      stage.appendChild(row);
    }
  }, ids);
}

test.describe('wrap cell (B19)', () => {
  test('a column at position 10 shows the wrap cell, identical to a 0 at rest', async ({ page }) => {
    await rows(page, ['a', 'b']);
    const a = await addCounter(page, 'a', { value: 9 }, { parent: '#row-a', style: 'font-size: 40px' });
    const b = await addCounter(page, 'b', { value: 0 }, { parent: '#row-b', style: 'font-size: 40px' });
    await a.evaluate((el) => el.querySelector<HTMLElement>('.rn-scale')!.style.setProperty('transform', 'translateY(-100%)'));
    const diff = diffImages(await a.screenshot(), await b.screenshot());
    expect(diff.count).toBe(0);
  });

  test('with native digits the wrap cell shows the native zero (data-rn-zero)', async ({ page }) => {
    await rows(page, ['a', 'b']);
    const a = await addCounter(page, 'a', { value: 9, locale: 'ar-EG' }, { parent: '#row-a', style: 'font-size: 40px' });
    const b = await addCounter(page, 'b', { value: 0, locale: 'ar-EG' }, { parent: '#row-b', style: 'font-size: 40px' });
    expect(await a.evaluate((el) => el.querySelector('.rn-scale')!.getAttribute('data-rn-zero'))).toBe('٠');
    await a.evaluate((el) => el.querySelector<HTMLElement>('.rn-scale')!.style.setProperty('transform', 'translateY(-100%)'));
    expect(diffImages(await a.screenshot(), await b.screenshot()).count).toBe(0);
  });
});

test.describe('stable width (I07)', () => {
  test('every column is as wide as the widest digit, whatever digit it shows', async ({ page }) => {
    // Emulate proportional digits whatever the installed fonts: "8" is wider than "1".
    await page.addStyleTag({
      content: '.prop .rn-cell:nth-child(9), .prop .rn-col[data-digit="8"] > .rn-sizer, .wide8 { letter-spacing: 0.4em }'
    });
    const ones = await addCounter(page, 'ones', { value: 1111 }, { className: 'prop', style: 'font-size: 40px' });
    const eights = await addCounter(page, 'eights', { value: 8888 }, { className: 'prop', style: 'font-size: 40px' });
    const widths = async (host: Locator) => (await sampleHost(host)).cols.map((c) => c.width);
    const w1 = await widths(ones);
    const w8 = await widths(eights);
    expect(new Set([...w1, ...w8]).size).toBe(1);
    // The emulation works: as plain text, "8" is wider than "1".
    const plain = await page.evaluate(() => {
      const s = document.createElement('span');
      s.style.fontSize = '40px';
      document.body.appendChild(s);
      s.textContent = '1';
      const one = s.getBoundingClientRect().width;
      s.className = 'wide8';
      s.textContent = '8';
      const eight = s.getBoundingClientRect().width;
      s.remove();
      return { one, eight };
    });
    expect(plain.eight).toBeGreaterThan(plain.one + 5);
    expect(w1[0]).toBeGreaterThanOrEqual(plain.eight - 0.5);
  });
});

test.describe('RTL (B08)', () => {
  test('digits and sign read left to right inside dir="rtl" content', async ({ page }) => {
    await page.evaluate(() => {
      document.documentElement.dir = 'rtl';
      document.documentElement.lang = 'ar';
      const p = document.createElement('p');
      p.id = 'para';
      p.style.fontSize = '40px';
      p.textContent = 'الرصيد ';
      document.getElementById('stage')!.appendChild(p);
    });
    for (const [id, options] of [
      ['plain', { value: -1234 }],
      ['intl', { value: -1234, locale: 'ar-EG' }]
    ] as const) {
      const host = await addCounter(page, id, options, { parent: '#para' });
      const order = await host.evaluate((el) => ({
        direction: getComputedStyle(el).direction,
        nodes: Array.from(el.querySelectorAll<HTMLElement>(':scope > .rn-col, :scope > .rn-sign'), (n) => ({
          key: n.getAttribute('data-rn-key'),
          x: n.getBoundingClientRect().left
        }))
      }));
      expect(order.direction).toBe('ltr');
      const xs = order.nodes.sort((a, b) => a.x - b.x).map((n) => n.key);
      expect(xs).toEqual(['sign', 'i3', 'i2', 'i1', 'i0']);
    }
    await expect(page.locator('#intl')).toHaveAttribute('aria-label', /١٬?٢٣٤/);
  });
});

/** Counter on its own row inside a shadow root that adopts `sheet` (no other styles). */
async function shadowCounter(page: Page, id: string, value: number, strip: boolean): Promise<Locator> {
  await page.evaluate(
    async ([hostId, v, stripFill]) => {
      const css = await (await fetch('/dist/style.css')).text();
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      if (stripFill) {
        for (const rule of Array.from(sheet.cssRules)) {
          const style = (rule as CSSStyleRule).style;
          if (style && style.getPropertyValue('background-image').includes('--rn-fill')) {
            style.removeProperty('background-image');
            style.removeProperty('background-clip');
            style.removeProperty('-webkit-background-clip');
          }
        }
      }
      const row = document.createElement('div');
      row.style.cssText = 'height: 80px';
      document.getElementById('stage')!.appendChild(row);
      const shadow = row.attachShadow({ mode: 'open' });
      shadow.adoptedStyleSheets = [sheet];
      const el = document.createElement('span');
      el.id = hostId;
      el.style.fontSize = '40px';
      shadow.appendChild(el);
      el.rnCore = new window.RN.RollingNumberCore(el, { value: v, injectStyles: false });
    },
    [id, value, strip] as const
  );
  return page.locator('#' + id);
}

test.describe('--rn-fill (C1)', () => {
  test('the fill rules are pixel-identical when --rn-fill is unset', async ({ page }) => {
    const withRules = await shadowCounter(page, 'with', 1234567890, false);
    const without = await shadowCounter(page, 'without', 1234567890, true);
    expect(await without.evaluate((el) => getComputedStyle(el.querySelector('.rn-cell')!).backgroundClip)).not.toBe('text');
    expect(diffImages(await withRules.screenshot(), await without.screenshot()).count).toBe(0);
  });

  test('a vertical gradient paints the glyphs at rest and mid-roll', async ({ page }) => {
    const style = 'font-size: 40px; --rn-fill: linear-gradient(#ff0000, #0000ff); color: transparent';
    const host = await addCounter(page, 'n', { value: 1234 }, { style });
    const colored = (png: Buffer) => inkPixels(png, [255, 255, 255], 60);
    const nearBlack = (png: Buffer) => {
      const { width, height } = decodePng(png);
      return width * height - inkPixels(png, [0, 0, 0], 60);
    };
    const rest = await host.screenshot();
    expect(colored(rest)).toBeGreaterThan(100);
    // The text itself is transparent: only the gradient shows, no black glyph pixels.
    expect(nearBlack(rest)).toBe(0);
    await setValue(host, 5678);
    await stepFrames(page, 6);
    const mid = await host.screenshot();
    expect(colored(mid)).toBeGreaterThan(100);
    expect(nearBlack(mid)).toBe(0);
  });
});

test.describe('--rn-bleed (C2)', () => {
  test('reveals a glow around the digits, which the window clips otherwise', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'overflow-clip-margin is a no-op in Safari (documented, R11)');
    const base = 'font-size: 40px; --rn-lh: 1.5; color: #000; text-shadow: 0 0 3px #f0f, 0 0 6px #f0f, 0 0 6px #f0f; margin-left: 40px';
    await rows(page, ['a', 'b']);
    const clipped = await addCounter(page, 'a', { value: 8 }, { parent: '#row-a', style: base });
    const bled = await addCounter(page, 'b', { value: 8 }, { parent: '#row-b', style: base + '; --rn-bleed: 10px' });
    const band = async (host: Locator) => {
      const box = (await host.boundingBox())!;
      // 10 px band to the left of the column, outside the column box.
      const png = await page.screenshot({ clip: { x: box.x - 10, y: box.y, width: 10, height: box.height } });
      return inkPixels(png, [255, 255, 255], 8);
    };
    expect(await band(clipped)).toBe(0);
    expect(await band(bled)).toBeGreaterThan(10);
  });
});

test.describe('--rn-decoration (C3, R10)', () => {
  for (const decoration of ['underline', 'line-through'] as const) {
    test(`${decoration} is painted and stays still while the digits roll`, async ({ page }) => {
      await rows(page, ['a', 'b']);
      await page.evaluate((d) => {
        document.getElementById('row-a')!.style.setProperty('--rn-decoration', d);
      }, decoration);
      const plain = await addCounter(page, 'b', { value: 1234 }, { parent: '#row-b', style: 'font-size: 40px' });
      const deco = await addCounter(page, 'a', { value: 1234 }, { parent: '#row-a', style: 'font-size: 40px' });
      expect(await deco.evaluate((el) => getComputedStyle(el.querySelector('.rn-col')!, '::before').textDecorationLine)).toBe(decoration);

      // Rows where the decorated counter differs from the plain one across most of
      // its width = the decoration (antialiasing noise never covers a whole row).
      const diff = async () => diffImages(await deco.screenshot(), await plain.screenshot(), 40);
      const atRest = lineRows(await diff(), 0.6);
      expect(atRest.length).toBeGreaterThan(0);
      expect(atRest.length).toBeLessThan(8);

      // Both counters roll in lockstep: mid-roll the digits move, the decoration does not.
      // Rolling glyphs may cover part of the line, so a decoration row only needs 40% here;
      // no other row may look like a line (a decoration sliding with the cells would).
      await setValue(deco, 5678);
      await setValue(plain, 5678);
      for (const frames of [3, 3, 4]) {
        await stepFrames(page, frames);
        expect(await deco.evaluate((el) => el.getAttribute('data-rn-state'))).toBe('animating');
        const mid = await diff();
        for (const row of atRest) expect(mid.perRow[row]).toBeGreaterThanOrEqual(0.4 * mid.width);
        expect(lineRows(mid, 0.6).filter((row) => !atRest.includes(row))).toEqual([]);
      }
    });
  }
});
