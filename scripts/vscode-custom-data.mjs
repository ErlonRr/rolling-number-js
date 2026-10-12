// Generates VS Code custom data from dist/custom-elements.json (run by `pnpm run cem`):
//   - dist/vscode.html-custom-data.json: tags and attributes for HTML completion/hover
//     ("html.customData" setting). Value sets come from the string literals of each
//     `@attr` type (`mode`, `trigger`, `live`, `interpolate`, `inject-styles` and the
//     easing names); `@attr {boolean}` attributes (`no-interpolate`) are void;
//   - dist/vscode.css-custom-data.json: the --rn-* custom properties for CSS completion/hover
//     ("css.customData" setting).
// Schemas: https://github.com/microsoft/vscode-html-languageservice/blob/main/docs/customData.md
//          https://github.com/microsoft/vscode-css-languageservice/blob/main/docs/customData.md
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(dist, 'custom-elements.json'), 'utf8'));

const references = [{ name: 'Documentation', url: pkg.homepage }];

/**
 * String literals of a type text, suggested as values: `"a" | "b"` → ['a', 'b'];
 * `"a" | string` → ['a'] (other values stay allowed); no literal → [] (free-form value).
 */
function literalValues(typeText) {
  if (!typeText) return [];
  return typeText
    .split('|')
    .map((t) => t.trim())
    .filter((p) => /^(['"]).*\1$/.test(p))
    .map((p) => p.slice(1, -1));
}

function markdown(...lines) {
  return { kind: 'markdown', value: lines.filter(Boolean).join('\n\n') };
}

const elements = manifest.modules.flatMap((m) => m.declarations ?? []).filter((d) => d.customElement && d.tagName);
if (elements.length === 0) {
  console.error('vscode-custom-data: no custom element with a tag name in custom-elements.json');
  process.exit(1);
}

const tags = elements.map((el) => ({
  name: el.tagName,
  description: markdown(
    el.summary && `**${el.summary}**`,
    el.description,
    el.cssProperties?.length &&
      'CSS custom properties:\n' +
        el.cssProperties
          .map((p) => `- \`${p.name}\`${p.default ? ` (default \`${p.default}\`)` : ''}: ${p.description ?? ''}`)
          .join('\n')
  ),
  attributes: (el.attributes ?? []).map((attr) => {
    const values = literalValues(attr.type?.text);
    return {
      name: attr.name,
      description: markdown(
        attr.description,
        attr.type?.text && `Type: \`${attr.type.text}\``,
        attr.default !== undefined && `Default: \`${attr.default}\``
      ),
      ...(values.length ? { values: values.map((name) => ({ name })) } : {}),
      ...(attr.type?.text === 'boolean' ? { valueSet: 'v' } : {})
    };
  }),
  references
}));

const cssProperties = elements.flatMap((el) =>
  (el.cssProperties ?? []).map((p) => ({
    name: p.name,
    description: markdown(
      `\`<${el.tagName}>\` / \`.rn-rolling-number\`: ${p.description ?? ''}`,
      p.default && `Default: \`${p.default}\``
    ),
    references
  }))
);

const header = { version: 1.1 };
writeFileSync(join(dist, 'vscode.html-custom-data.json'), JSON.stringify({ ...header, tags }, null, 2) + '\n');
writeFileSync(join(dist, 'vscode.css-custom-data.json'), JSON.stringify({ ...header, properties: cssProperties }, null, 2) + '\n');
console.log(
  `vscode-custom-data: ${tags.length} tag(s), ${cssProperties.length} CSS custom properties → dist/vscode.{html,css}-custom-data.json`
);
