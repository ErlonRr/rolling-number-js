// Stage of the visual suite (see stage.html). Loads the BUILT package from /dist.
import * as RN from '/dist/rolling-number.js';

const SVG = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'g', 'text', 'tspan', 'textPath', 'rect', 'foreignObject']);

const params = new URLSearchParams(location.search);

if (params.get('inject') === '0') RN.configureRollingNumber({ injectStyles: false });

const sheet = { dist: '/dist/style.css', '1.2': '/fixtures/style-1.2.css' }[params.get('css') || ''];
if (sheet) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = sheet;
  const loaded = new Promise((resolve, reject) => {
    link.onload = resolve;
    link.onerror = reject;
  });
  document.head.appendChild(link);
  await loaded;
}

window.RN = RN;
window.stage = {
  /**
   * Creates host #id (default <span>) and attaches a core (host.rnCore).
   * SVG tags are created in the SVG namespace inside an <svg> (`style` goes on the <svg>).
   */
  counter(id, options = {}, init = {}) {
    const tag = init.tag || 'span';
    const parent = init.parent ? document.querySelector(init.parent) : document.getElementById('stage');
    let el;
    if (SVG_TAGS.has(tag)) {
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('width', '480');
      svg.setAttribute('height', '80');
      if (init.style) svg.setAttribute('style', init.style);
      el = tag === 'svg' ? svg : document.createElementNS(SVG, tag);
      if (tag === 'text') {
        el.setAttribute('x', '8');
        el.setAttribute('y', '56');
      }
      if (el !== svg) svg.appendChild(el);
      parent.appendChild(svg);
    } else {
      el = document.createElement(tag);
      if (init.style) el.setAttribute('style', init.style);
      parent.appendChild(el);
    }
    el.id = id;
    if (init.className) el.setAttribute('class', init.className);
    for (const [name, value] of Object.entries(init.attrs || {})) el.setAttribute(name, value);
    el.rnCore = new RN.RollingNumberCore(el, options);
    return id;
  }
};
window.rnReady = true;
document.documentElement.setAttribute('data-ready', '');
