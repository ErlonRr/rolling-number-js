/**
 * DOM-free SSR helpers: the formatted value as text or as escaped HTML for
 * template engines (docs/design/v1.3.md §2.6, §7). Owned by WP2.
 *
 * This module imports only `options.ts` and `format.ts` (never `core.ts`,
 * which imports the stylesheet), so `rolling-number/ssr` runs in plain Node.
 *
 * @module
 */
import type { RollingNumberOptions, RollingNumberUpdate } from './types';
import { OPTION_ATTRIBUTES, OPTION_KEYS, readOption, resolveOptions } from './options';
import { createFormatter, resolveLabel } from './format';

/** Tags accepted by {@link renderStaticHTML}. */
const TAG_RE = /^[a-z][a-z0-9-]*$/;
/** Attribute names accepted in `init.attrs` (no quotes, spaces, `=`, `<`, `>` or `/`). */
const ATTR_RE = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/;
/** Elements that cannot hold the fallback child (void or raw-text content). */
const NO_CHILD_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
  'script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext', 'template'
]);

/** Escapes text for HTML content and double-quoted attribute values. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}

/** What a counter shows at rest for `options`: the clamped text and the (unclamped) label. */
function staticState(options: RollingNumberOptions | undefined): { text: string; label: string } {
  const o = resolveOptions(options as RollingNumberUpdate | undefined);
  const fmt = createFormatter(o);
  const A = fmt.quantize(o.value);
  const Amax = fmt.maxA(o.max);
  const overflow = Math.abs(A) > Amax;
  const shown = (A < 0 ? -1 : 1) * Math.min(Math.abs(A), Amax) || 0;
  return { text: fmt.text(shown, overflow), label: resolveLabel(o, fmt, o.value, overflow) };
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
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    case 'object': {
      if (value === null) return null;
      if (Array.isArray(value)) return value.filter((x): x is string => typeof x === 'string').join(',');
      try {
        const json = JSON.stringify(value);
        return typeof json === 'string' ? json : null;
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}

/** Adds `init.attrs` to `list`: validated names, `class` merged, other duplicates replaced (case-insensitive). */
function mergeAttrs(list: Attr[], attrs: Record<string, string> | undefined): void {
  if (!attrs) return;
  for (const name of Object.keys(attrs)) {
    const raw: unknown = attrs[name];
    if (raw === undefined || raw === null) continue;
    if (!ATTR_RE.test(name)) {
      throw new TypeError(`[RollingNumber] renderStaticHTML: invalid attribute name ${JSON.stringify(name)}.`);
    }
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
 * escaped). Three shapes:
 * - default: `<span class="rn-ssr" data-rn-ssr>…</span>`, the fallback child
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
 * `attrs` are added to the outer element (`class` is merged, other names
 * replace the generated ones). The fallback text is the clamped text of
 * {@link renderStaticText}; `aria-label` is the unclamped label.
 *
 * @param options Counter options.
 * @param init `tag`: host tag (lowercase `[a-z][a-z0-9-]*`, a container
 *   element); `attrs`: extra attributes.
 * @returns An HTML string.
 * @throws TypeError on an invalid `tag` (or a void/raw-text one such as
 *   `input` or `textarea`) or attribute name.
 *
 * @example
 * ```ts
 * renderStaticHTML({ value: 42 }, { tag: 'span', attrs: { class: 'score' } });
 * // <span class="rn-rolling-number score" role="img" aria-label="42" data-rn-ssr><span class="rn-ssr" data-rn-ssr>42</span></span>
 * ```
 */
export function renderStaticHTML(
  options?: RollingNumberOptions,
  init?: { tag?: string; attrs?: Record<string, string> }
): string {
  const tag = init?.tag;
  if (tag !== undefined && (typeof tag !== 'string' || !TAG_RE.test(tag))) {
    throw new TypeError(`[RollingNumber] renderStaticHTML: invalid tag ${JSON.stringify(String(tag))} (expected [a-z][a-z0-9-]*).`);
  }
  if (tag !== undefined && NO_CHILD_TAGS.has(tag)) {
    throw new TypeError(`[RollingNumber] renderStaticHTML: <${tag}> cannot hold the fallback child; use a container tag.`);
  }
  const { text, label } = staticState(options);
  const child = (attrs: Attr[]): string => `<span${renderAttrs(attrs)}>${escapeHtml(text)}</span>`;
  const fallbackAttrs = (): Attr[] => [['class', 'rn-ssr'], ['data-rn-ssr', null]];

  if (tag === undefined) {
    const list = fallbackAttrs();
    mergeAttrs(list, init?.attrs);
    return child(list);
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
  } else {
    list.push(['class', 'rn-rolling-number'], ['role', 'img'], ['aria-label', label], ['data-rn-ssr', null]);
  }
  mergeAttrs(list, init?.attrs);
  return `<${tag}${renderAttrs(list)}>${child(fallbackAttrs())}</${tag}>`;
}
