// not-found.js — Unknown routes.

import { h, pageHeader } from '../ui.js';

export function mount(view) {
  view.append(
    h(
      'div',
      { class: 'container not-found' },
      pageHeader({ eyebrow: '404', title: 'Page not found', lead: 'There is no page at this address.' }),
      h('a', { class: 'btn btn-primary', href: '#/' }, 'Back to the home page'),
    ),
  );
}
