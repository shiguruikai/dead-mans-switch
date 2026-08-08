import type { FC } from 'hono/jsx/dom';
import { render } from 'hono/jsx/dom';

import { isIslandName, islands } from './lib/island';

function mountIslands() {
  const nodes = document.querySelectorAll<HTMLElement>('[data-island]');
  nodes.forEach((el) => {
    if (el.dataset.islandMounted === 'true') {
      return;
    }

    const name = el.dataset.island;

    if (!isIslandName(name)) {
      console.warn(`[client] Unknown island: ${String(name)}`);
      return;
    }

    let props = {};
    try {
      if (el.dataset.props) {
        const parsed = JSON.parse(el.dataset.props) as unknown;
        if (parsed && typeof parsed === 'object') {
          props = parsed;
        }
      }
    } catch (e) {
      console.warn(`[client] Invalid props of ${name}: ${String(el.dataset.props)}`, e);
    }

    const Component = islands[name] as FC;

    try {
      render(<Component {...props} />, el);
      el.dataset.islandMounted = 'true';
      delete el.dataset.props;
    } catch (e) {
      console.error(`[client] Failed to mount island ${name}:`, e);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountIslands);
} else {
  mountIslands();
}
