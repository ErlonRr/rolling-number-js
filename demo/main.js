// main.js — Demo entry: registers <rolling-number>, then runs the theme switch and the hash router.
// Each view is a lazily loaded module that mounts its own counters and returns a cleanup function.

// The full entry: registers the element and injects the styles. In dev it resolves to src/, in the
// static build to dist/ (vite.config.demo.ts), so the published site runs the published package.
import 'rolling-number';

const VERSION = import.meta.env.RN_VERSION;

// --- Theme -----------------------------------------------------------------

const THEME_KEY = 'rn-demo-theme';
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function storedTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

const effectiveTheme = () => storedTheme() ?? (systemDark.matches ? 'dark' : 'light');

/** Applies a theme: `color-scheme` on the page, so form controls and scrollbars follow too. */
function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const toggle = document.getElementById('theme-toggle');
  toggle?.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  toggle?.setAttribute('aria-pressed', String(theme === 'dark'));
}

document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  applyTheme(next);
});
systemDark.addEventListener('change', () => {
  if (!storedTheme()) applyTheme(effectiveTheme());
});
applyTheme(effectiveTheme());

// --- Shell -----------------------------------------------------------------

for (const element of document.querySelectorAll('[data-version]')) element.textContent = `v${VERSION}`;

const main = /** @type {HTMLElement} */ (document.getElementById('main'));

// The skip link must not change the hash, which is the route.
document.querySelector('.skip-link')?.addEventListener('click', (event) => {
  event.preventDefault();
  main.focus();
});

// "On this page" links scroll to their section without touching the route.
document.addEventListener('click', (event) => {
  const link = /** @type {Element} */ (event.target).closest?.('a[data-jump]');
  if (!link) return;
  const target = document.getElementById(link.getAttribute('href').slice(1));
  if (!target) return;
  event.preventDefault();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  target.querySelector('h2')?.focus({ preventScroll: true });
});

// --- Router ----------------------------------------------------------------

const ROUTES = [
  { pattern: /^\/?$/, nav: 'home', load: () => import('./pages/home.js') },
  { pattern: /^\/playground\/?$/, nav: 'playground', load: () => import('./pages/playground.js') },
  { pattern: /^\/examples\/?$/, nav: 'examples', load: () => import('./pages/examples.js') },
  { pattern: /^\/frameworks\/?$/, nav: 'frameworks', load: () => import('./pages/frameworks.js') },
  { pattern: /^\/api\/?$/, nav: 'api', load: () => import('./pages/api.js') },
];

/** Section links of the 1.3.0 demo (#playground, #options, …) → their new pages. */
const LEGACY = {
  overview: '/',
  install: '/frameworks',
  playground: '/playground',
  styling: '/examples',
  anywhere: '/examples',
  formatting: '/examples',
  events: '/examples',
  performance: '/examples',
  frameworks: '/frameworks',
  options: '/api',
  api: '/api',
};

/** @type {(() => void) | null} */
let cleanup = null;
let navigation = 0;
let firstRender = true;

/** Splits `#/playground?pad=4` into its path and query. */
function parseHash() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = hash.split('?');
  return { path, params: new URLSearchParams(query) };
}

async function render() {
  let { path, params } = parseHash();
  if (!path.startsWith('/')) {
    if (LEGACY[path]) {
      location.replace(`#${LEGACY[path]}`);
      return;
    }
    // Fragment links that are not routes (`#main`) keep the current view; on a fresh load, home.
    if (!firstRender) return;
    path = '/';
  }
  const current = ++navigation;
  const route = ROUTES.find((item) => item.pattern.test(path));

  for (const link of document.querySelectorAll('.primary-nav a')) {
    if (link.getAttribute('data-nav') === route?.nav) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  main.setAttribute('aria-busy', 'true');
  let page;
  try {
    page = route ? await route.load() : await import('./pages/not-found.js');
  } catch (error) {
    console.error(error);
    page = await import('./pages/not-found.js');
  }
  if (current !== navigation) return;

  cleanup?.();
  cleanup = null;
  main.replaceChildren();
  const view = document.createElement('div');
  view.className = 'view';
  main.append(view);
  const result = page.mount(view, { query: params });
  cleanup = typeof result === 'function' ? result : null;
  main.removeAttribute('aria-busy');

  const heading = view.querySelector('h1');
  document.title = route?.nav === 'home' ? 'Rolling Number — animated odometer counter' : `${heading?.textContent ?? 'Not found'} · Rolling Number`;
  if (firstRender) {
    firstRender = false;
  } else {
    window.scrollTo({ top: 0 });
    /** @type {HTMLElement | null} */ (heading)?.focus({ preventScroll: true });
  }
}

window.addEventListener('hashchange', render);
render();
