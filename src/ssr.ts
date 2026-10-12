/**
 * DOM-free SSR helpers: the formatted value as text or as escaped HTML for
 * template engines (docs/design/v1.3.md §2.6, §7). Owned by WP2.
 *
 * This module imports only `options.ts` and `format.ts` (never `core.ts`,
 * which imports the stylesheet), so `rolling-number/ssr` runs in plain Node.
 *
 * @module
 */
import type { RollingNumberOptions, RollingNumberUpdate } from './public-types';
import { OPTION_ATTRIBUTES, OPTION_KEYS, readOption, resolveOptions } from './options';
import { createBaseFormatter, resolveLabel } from './format';

/** Tags accepted by {@link renderStaticHTML}. */
const TAG_RE = /^[a-z][a-z0-9-]*$/;
/** Attribute names accepted in `init.attrs` (no quotes, spaces, `=`, `<`, `>` or `/`). */
const ATTR_RE = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/;
/**
 * Tags that cannot carry the markup, whatever the mode (§6 table): void and
 * raw-text elements, form controls (the caller renders their value), hosts
 * whose content is not rendered or that the HTML parser would move the child
 * out of (select, media, table structure, head), MathML, and SVG elements
 * other than `text`/`tspan`/`textPath`/`foreignObject` (plus `fe*` and
 * `animate*`, below). Lowercase: HTML parsing lowercases SVG names too.
 */
const NO_HOST = new Set(
  ('area base basefont bgsound br col embed frame hr image img input keygen link meta param source track wbr ' +
    'script style textarea title xmp iframe noembed noframes noscript plaintext template select optgroup ' +
    'video audio canvas html head frameset table thead tbody tfoot tr colgroup math svg g defs symbol use ' +
    'switch marker mask pattern clippath lineargradient radialgradient stop filter path rect circle ellipse ' +
    'line polygon polyline view desc metadata set mpath discard').split(' ')
);

/** Throws the TypeError of an invalid {@link renderStaticHTML} call. */
function fail(why: string): never {
  throw new TypeError(`[RollingNumber] renderStaticHTML: ${why}.`);
}

/** Escapes text for HTML content and double-quoted attribute values. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}

/** What a counter shows at rest for `options`: the clamped text, the (unclamped) label and the mode option. */
function staticState(options: RollingNumberOptions | undefined): { text: string; label: string; mode: string } {
  const o = resolveOptions(options as RollingNumberUpdate | undefined);
  const fmt = createBaseFormatter(o);
  const A = fmt.quantize(o.value);
  const Amax = fmt.maxA(o.max);
  const overflow = Math.abs(A) > Amax;
  const shown = (A < 0 ? -1 : 1) * Math.min(Math.abs(A), Amax) || 0;
  return { text: fmt.text(shown, overflow), label: resolveLabel(o, fmt, o.value, overflow), mode: o.mode };
}

/**
 * Formatted `value` (with affixes; `from` is ignored), e.g. `"1,234 pts"`.
 * This is the text the counter shows at rest, the same as
 * `RollingNumberCore#getText()`: clamped by `max`, with `overflowSuffix`
 * (`"99+"`). The accessible label keeps the unclamped value.
 * Pass an explicit `locale` for deterministic output across servers and
 * browsers.
 *
 * @param options Counter options.
 * @returns The text a counter shows at rest.
 *
 * @example
 * ```ts
 * renderStaticText({ value: 1234.5, locale: 'en-US', format: { style: 'currency', currency: 'USD' } }); // "$1,234.50"
 * renderStaticText({ value: 150, max: 99, overflowSuffix: '+' }); // "99+"
 * ```
 */
export function renderStaticText(options?: RollingNumberOptions): string {
  return staticState(options).text;
}

/** One HTML attribute: `null` value = boolean attribute. */
type Attr = [name: string, value: string | null];

/** Attribute text of an option value, or `null` when it cannot be expressed (functions, symbols, …). */
function optionAttrValue(value: unknown): string | null {
  if (typeof value !== 'object' || !value) return /^(string|number|boolean|bigint)$/.test(typeof value) ? String(value) : null;
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === 'string').join(',');
  try {
    const json = JSON.stringify(value);
    return typeof json === 'string' ? json : null;
  } catch {
    return null;
  }
}

/** Adds `init.attrs` to `list`: validated names, `class` merged, other duplicates replaced (case-insensitive). */
function mergeAttrs(list: Attr[], attrs: Record<string, string> | undefined): void {
  if (!attrs) return;
  for (const name of Object.keys(attrs)) {
    const raw: unknown = attrs[name];
    if (raw === undefined || raw === null) continue;
    if (!ATTR_RE.test(name)) fail(`invalid attribute name ${JSON.stringify(name)}`);
    const value = String(raw);
    const lower = name.toLowerCase();
    const existing = list.find(([n]) => n.toLowerCase() === lower);
    if (!existing) list.push([name, value]);
    else if (lower === 'class') existing[1] = existing[1] ? `${existing[1]} ${value}`.trim() : value;
    else existing[1] = value;
  }
}

function renderAttrs(list: Attr[]): string {
  return list.map(([n, v]) => (v === null ? ` ${n}` : ` ${n}="${escapeHtml(v)}"`)).join('');
}

/**
 * Escaped HTML for template engines (every text and attribute value is
 * escaped). Columns mode (the default) has three shapes:
 * - no `tag`: `<span class="rn-ssr" data-rn-ssr>…</span>`, the fallback child
 *   to place inside a host;
 * - `{ tag: 'rolling-number' }`: `<rolling-number …option attributes…>` with
 *   the fallback child; option attributes are named by the element's
 *   attribute names (`prefixText` → `prefix-text`), `format` is JSON and
 *   function options (`easing`, `label`) are skipped;
 * - any other tag (e.g. `'span'`): `<span class="rn-rolling-number" role="img"
 *   aria-label="…" data-rn-ssr>` with the fallback child. The client core
 *   adopts it: role and label become core-owned, `data-rn-ssr` is removed
 *   from the host and the child is hidden.
 *
 * Text mode (`mode: 'text'`, or `mode: 'auto'` on `option` and SVG
 * `text`/`tspan`/`textpath`, as the core resolves it) writes the host's text,
 * so the element gets the plain text as its content and nothing else (no
 * class, role, label, `data-rn-ssr` or fallback child; `rolling-number` keeps
 * its option attributes). Without a `tag` the result is that escaped text,
 * the content of a text host.
 *
 * `attrs` are added to the outer element (`class` is merged, other names
 * replace the generated ones). The text is the clamped text of
 * {@link renderStaticText}; `aria-label` is the unclamped label.
 *
 * @param options Counter options.
 * @param init `tag`: host tag (lowercase `[a-z][a-z0-9-]*`); `attrs`: extra
 *   attributes.
 * @returns An HTML string.
 * @throws TypeError on an invalid `tag` or attribute name, on `attrs` without
 *   a `tag` in text mode, and on a tag that cannot carry the markup: void or
 *   raw-text elements, `input` and `textarea` (render
 *   {@link renderStaticText} as their value yourself), `select`, media,
 *   table-structure and MathML elements, and SVG elements other than
 *   `text`/`tspan`/`textpath`/`foreignobject`.
 *
 * @example
 * ```ts
 * renderStaticHTML({ value: 42 }, { tag: 'span', attrs: { class: 'score' } });
 * // <span class="rn-rolling-number score" role="img" aria-label="42" data-rn-ssr><span class="rn-ssr" data-rn-ssr>42</span></span>
 * renderStaticHTML({ value: 3 }, { tag: 'option', attrs: { value: '3' } });
 * // <option value="3">3</option>
 * ```
 */
export function renderStaticHTML(
  options?: RollingNumberOptions,
  init?: { tag?: string; attrs?: Record<string, string> }
): string {
  const tag = init?.tag;
  if (tag !== undefined && (typeof tag !== 'string' || !TAG_RE.test(tag))) {
    fail(`invalid tag ${JSON.stringify(String(tag))} (expected [a-z][a-z0-9-]*)`);
  }
  if (tag !== undefined && (NO_HOST.has(tag) || /^(fe|animate)[a-z]*$/.test(tag))) {
    fail(`<${tag}> cannot host a counter: ${/^(input|textarea)$/.test(tag) ? 'render renderStaticText() as its value' : 'use a container'}`);
  }
  const { text, label, mode } = staticState(options);
  const content = escapeHtml(text);
  // Text mode (§6): the host's own text, no columns markers or fallback child.
  const textMode = mode == 'text' || (mode == 'auto' && /^(option|text|tspan|textpath)$/.test(tag as string));
  const child = (attrs: Attr[]): string => `<span${renderAttrs(attrs)}>${content}</span>`;
  const fallbackAttrs = (): Attr[] => [['class', 'rn-ssr'], ['data-rn-ssr', null]];

  if (tag === undefined) {
    if (!textMode) {
      const list = fallbackAttrs();
      mergeAttrs(list, init?.attrs);
      return child(list);
    }
    if (init?.attrs && Object.keys(init.attrs).length) fail('attrs need a tag in text mode');
    return content;
  }

  const list: Attr[] = [];
  if (tag === 'rolling-number') {
    const src = (options ?? {}) as Record<string, unknown>;
    for (const key of OPTION_KEYS) {
      const raw = readOption(src, key);
      if (raw === undefined || raw === null) continue;
      const value = optionAttrValue(raw);
      if (value !== null) list.push([OPTION_ATTRIBUTES[key], value]);
    }
  } else if (!textMode) {
    list.push(['class', 'rn-rolling-number'], ['role', 'img'], ['aria-label', label], ['data-rn-ssr', null]);
  }
  mergeAttrs(list, init?.attrs);
  return `<${tag}${renderAttrs(list)}>${textMode ? content : child(fallbackAttrs())}</${tag}>`;
}
