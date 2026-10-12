/**
 * Helpers shared by the Vue component and directive.
 * @internal
 * @module
 */

/**
 * Option equality used to skip no-op updates: `Object.is`, plus a one-level
 * shallow compare of plain objects and arrays, so a new but equal `format`
 * literal or `locale` array on every render is not a change. Functions
 * compare by identity.
 */
export function sameOption(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a != 'object' || typeof b != 'object' || Array.isArray(a) != Array.isArray(b)) return false;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return keys.length == Object.keys(y).length && keys.every((k) => k in y && Object.is(x[k], y[k]));
}
