// Custom Elements Manifest and VS Code custom data checks, run by scripts/smoke.mjs
// after `pnpm run build`. Owned by the element work package (WP7): update it
// together with the element's attributes, events and CSS custom properties
// (docs/design/v1.3.md §2.5, §10).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Option property → attribute (src/options.ts OPTION_ATTRIBUTES), in OPTION_KEYS order. */
const OPTIONS = {
  value: 'value',
  pad: 'pad',
  max: 'max',
  interpolate: 'interpolate',
  duration: 'duration',
  easing: 'easing',
  decimals: 'decimals',
  locale: 'locale',
  format: 'format',
  prefixText: 'prefix-text',
  suffixText: 'suffix-text',
  overflowSuffix: 'overflow-suffix',
  mode: 'mode',
  from: 'from',
  trigger: 'trigger',
  label: 'label',
  live: 'live',
  injectStyles: 'inject-styles'
};
/** Attributes without a property. */
const ATTRIBUTE_ONLY = ['no-interpolate'];
const METHODS = ['finish', 'getDisplayValue', 'setValue', 'whenSettled'];
const EVENTS = ['rn-end', 'rn-start'];
const CSS_PROPERTIES = ['--rn-bleed', '--rn-decoration', '--rn-duration', '--rn-easing', '--rn-fill', '--rn-lh'];
/** Attribute value sets offered by the VS Code data. */
const VALUE_SETS = {
  mode: ['auto', 'columns', 'text'],
  trigger: ['immediate', 'visible'],
  live: ['off', 'polite', 'assertive'],
  interpolate: ['true', 'false'],
  'inject-styles': ['true', 'false'],
  easing: [
    'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out',
    'ease-out-cubic', 'ease-in-out-cubic', 'ease-out-quart', 'ease-out-expo', 'odometer'
  ]
};

const sorted = (list) => [...list].sort().join(',');

/**
 * @param {{ check: (label: string, fn: () => void) => void, assert: (cond: unknown, message: string) => void,
 *           require: NodeRequire, root: string, pkg: any }} ctx
 */
export function checkManifest({ check, assert, require, root, pkg }) {
  const attributes = [...Object.values(OPTIONS), ...ATTRIBUTE_ONLY];

  check('custom-elements.json describes <rolling-number> (attributes, properties, methods, events, CSS custom properties)', () => {
    assert(pkg.customElements, 'package.json has no "customElements" field');
    const manifest = JSON.parse(readFileSync(join(root, pkg.customElements), 'utf8'));
    assert(require(`${pkg.name}/custom-elements.json`).schemaVersion === manifest.schemaVersion, 'export does not match "customElements"');
    const el = manifest.modules.flatMap((m) => m.declarations).find((d) => d.tagName === 'rolling-number');
    assert(el && el.customElement, 'no custom element declaration with tagName rolling-number');
    const names = (list) => sorted((list ?? []).map((x) => x.name));

    assert(names(el.attributes) === sorted(attributes), `attributes: ${names(el.attributes)}`);
    for (const [prop, attr] of Object.entries(OPTIONS)) {
      const a = el.attributes.find((x) => x.name === attr);
      assert(a.fieldName === prop, `attribute ${attr} not linked to its property ${prop} (fieldName: ${a.fieldName})`);
    }
    for (const attr of ATTRIBUTE_ONLY) {
      assert(el.attributes.find((x) => x.name === attr).fieldName === undefined, `attribute ${attr} must not be linked to a property`);
    }
    for (const [attr, values] of Object.entries(VALUE_SETS)) {
      const text = el.attributes.find((x) => x.name === attr).type?.text ?? '';
      for (const v of values) assert(text.includes(`"${v}"`), `attribute ${attr}: type ${text} lacks "${v}"`);
    }

    const members = el.members ?? [];
    const props = members.filter((m) => m.kind === 'field' && !m.privacy && !m.static);
    assert(names(props) === sorted(Object.keys(OPTIONS)), `public properties: ${names(props)}`);
    for (const p of props) assert(p.attribute === OPTIONS[p.name], `property ${p.name} not linked to attribute ${OPTIONS[p.name]}`);
    const methods = members.filter((m) => m.kind === 'method' && !m.privacy && !m.static);
    for (const m of METHODS) assert(methods.some((x) => x.name === m), `public method ${m} missing`);

    assert(names(el.events) === sorted(EVENTS), `events: ${names(el.events)}`);
    for (const e of el.events) assert(e.type?.text === 'RollingNumberEvent', `event ${e.name} type: ${e.type?.text}`);
    assert(names(el.cssProperties) === sorted(CSS_PROPERTIES), `cssProperties: ${names(el.cssProperties)}`);
    for (const p of ['--rn-in', '--rn-w']) {
      assert(!el.cssProperties.some((x) => x.name === p), `${p} is read-only and must not be listed as a cssprop`);
    }

    const defined = manifest.modules.some((m) => (m.exports ?? []).some((e) => e.kind === 'custom-element-definition' && e.name === 'rolling-number'));
    assert(defined, 'no custom-element-definition export for rolling-number');
  });

  check('VS Code custom data lists <rolling-number>, its attribute value sets and the --rn-* custom properties', () => {
    const html = require(`${pkg.name}/vscode.html-custom-data.json`);
    const tag = html.tags.find((t) => t.name === 'rolling-number');
    assert(tag, 'rolling-number tag missing');
    const attrNames = sorted(tag.attributes.map((a) => a.name));
    assert(attrNames === sorted(attributes), `tag attributes: ${attrNames}`);
    for (const [attr, values] of Object.entries(VALUE_SETS)) {
      const got = (tag.attributes.find((a) => a.name === attr).values ?? []).map((v) => v.name);
      assert(sorted(got) === sorted(values), `values of ${attr}: ${got.join(',')}`);
    }
    for (const attr of ATTRIBUTE_ONLY) {
      assert(tag.attributes.find((a) => a.name === attr).valueSet === 'v', `${attr} is not a void attribute`);
    }
    const css = require(`${pkg.name}/vscode.css-custom-data.json`);
    const cssNames = sorted(css.properties.map((p) => p.name));
    assert(cssNames === sorted(CSS_PROPERTIES), `CSS custom properties: ${cssNames}`);
  });
}
