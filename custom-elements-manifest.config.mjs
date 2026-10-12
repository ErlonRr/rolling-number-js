// Configuration of @custom-elements-manifest/analyzer (`pnpm run cem`).
// Produces dist/custom-elements.json from the JSDoc of src/element.ts
// (@tagname, @attr, @cssprop, property docs). The plugin below fills in what
// static analysis cannot see in this codebase:
//   - the tag is registered dynamically by defineRollingNumber(), so the
//     `custom-element-definition` exports are added explicitly;
//   - the SSR-safe base class alias (HTMLElementBase) is the global HTMLElement;
//   - attributes are linked to the properties that reflect them (kebab-case
//     attributes such as prefix-text ↔ prefixText; no-interpolate has no
//     property); the build fails when an attribute or a public property is
//     left unlinked;
//   - module paths point at the published entry points instead of src/.

const TAG = 'rolling-number';
const CLASS = 'RollingNumberElement';
const SOURCE = 'src/element.ts';
/** Public entry points that export the element class and register the tag on import. */
const ENTRIES = ['dist/rolling-number.js', 'dist/register.js'];
/** Attributes whose property has another name (`null`: attribute without a property). Others share the name. */
const ATTRIBUTE_FIELDS = {
  'prefix-text': 'prefixText',
  'suffix-text': 'suffixText',
  'overflow-suffix': 'overflowSuffix',
  'inject-styles': 'injectStyles',
  'no-interpolate': null
};
/** Global HTML attributes listed in `observedAttributes` that are not element options. */
const GLOBAL_ATTRIBUTES = ['class'];

/** @returns {import('@custom-elements-manifest/analyzer').Plugin} */
function rollingNumberManifest() {
  return {
    name: 'rolling-number-manifest',
    packageLinkPhase({ customElementsManifest: manifest }) {
      const source = manifest.modules.find((m) => m.path === SOURCE);
      if (!source) throw new Error(`cem: module ${SOURCE} not found`);
      const element = source.declarations.find((d) => d.name === CLASS);
      if (!element || element.tagName !== TAG) throw new Error(`cem: ${CLASS} with @tagname ${TAG} not found`);

      element.superclass = { name: 'HTMLElement', package: 'global:' };

      // `class` is observed (to restore the library class), but it is the global attribute, not an option.
      element.attributes = (element.attributes ?? []).filter((attr) => !GLOBAL_ATTRIBUTES.includes(attr.name));

      const publicFields = (element.members ?? []).filter((m) => m.kind === 'field' && !m.static && !m.privacy);
      for (const attr of element.attributes) {
        const fieldName = Object.hasOwn(ATTRIBUTE_FIELDS, attr.name) ? ATTRIBUTE_FIELDS[attr.name] : attr.name;
        if (fieldName === null) continue;
        const field = publicFields.find((m) => m.name === fieldName);
        if (!field) throw new Error(`cem: attribute ${attr.name} has no property ${fieldName}`);
        attr.fieldName = field.name;
        if (field.default !== undefined && field.default !== 'null' && attr.default === undefined) attr.default = field.default;
        field.attribute = attr.name;
        field.reflects = true;
      }
      const unlinked = publicFields.filter((f) => !f.attribute).map((f) => f.name);
      if (unlinked.length) throw new Error(`cem: properties without an @attr: ${unlinked.join(', ')}`);

      const [main, register] = ENTRIES;
      const definition = (module) => ({
        kind: 'custom-element-definition',
        name: TAG,
        declaration: { name: CLASS, module }
      });

      source.path = main;
      for (const exp of source.exports ?? []) {
        if (exp.declaration?.module === SOURCE) exp.declaration.module = main;
      }
      source.exports.push(definition(main));

      manifest.modules.push({
        kind: 'javascript-module',
        path: register,
        declarations: [],
        exports: [
          { kind: 'js', name: CLASS, declaration: { name: CLASS, module: main } },
          definition(main)
        ]
      });
    }
  };
}

export default {
  globs: [SOURCE],
  outdir: 'dist',
  // package.json already declares "customElements": "./dist/custom-elements.json".
  packagejson: false,
  plugins: [rollingNumberManifest()]
};
