import { FC, render } from 'hono/jsx/dom';

import { isIslandName, islands } from './lib/island';

function mountIslands() {
  const nodes = document.querySelectorAll<HTMLElement>('[data-island]');
  nodes.forEach((el) => {
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

    render(<Component {...props} />, el);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountIslands);
} else {
  mountIslands();
}
