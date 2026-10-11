// Custom Elements Manifest and VS Code custom data checks, run by scripts/smoke.mjs
// after `pnpm run build`. Owned by the element work package (WP7): update it
// together with the element's attributes, events and CSS custom properties.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {{ check: (label: string, fn: () => void) => void, assert: (cond: unknown, message: string) => void,
 *           require: NodeRequire, root: string, pkg: any }} ctx
 */
export function checkManifest({ check, assert, require, root, pkg }) {
  check('custom-elements.json describes <rolling-number> (attributes, properties, CSS custom properties)', () => {
    assert(pkg.customElements, 'package.json has no "customElements" field');
    const manifest = JSON.parse(readFileSync(join(root, pkg.customElements), 'utf8'));
    assert(require(`${pkg.name}/custom-elements.json`).schemaVersion === manifest.schemaVersion, 'export does not match "customElements"');
    const el = manifest.modules.flatMap((m) => m.declarations).find((d) => d.tagName === 'rolling-number');
    assert(el && el.customElement, 'no custom element declaration with tagName rolling-number');
    const options = ['value', 'pad', 'max', 'interpolate', 'duration'];
    const names = (list) => (list ?? []).map((x) => x.name).sort().join(',');
    assert(names(el.attributes) === [...options].sort().join(','), `attributes: ${names(el.attributes)}`);
    for (const attr of el.attributes) assert(attr.fieldName === attr.name, `attribute ${attr.name} not linked to its property`);
    const props = el.members.filter((m) => m.kind === 'field' && !m.privacy && !m.static);
    assert(names(props) === [...options].sort().join(','), `public properties: ${names(props)}`);
    assert(names(el.cssProperties) === '--rn-duration,--rn-easing,--rn-lh', `cssProperties: ${names(el.cssProperties)}`);
    const defined = manifest.modules.some((m) => (m.exports ?? []).some((e) => e.kind === 'custom-element-definition' && e.name === 'rolling-number'));
    assert(defined, 'no custom-element-definition export for rolling-number');
  });

  check('VS Code custom data lists <rolling-number> and the --rn-* custom properties', () => {
    const html = require(`${pkg.name}/vscode.html-custom-data.json`);
    const tag = html.tags.find((t) => t.name === 'rolling-number');
    assert(tag && tag.attributes.length === 5, 'rolling-number tag with 5 attributes missing');
    const css = require(`${pkg.name}/vscode.css-custom-data.json`);
    assert(css.properties.some((p) => p.name === '--rn-duration'), '--rn-duration missing');
  });
}
