/** Load with <script type="module" src="./extensions/example-toolkit.js"></script> after app.js. */
import {element} from '../core/model.js';

export function installAcmeToolkit(registry) {
  registry.registerControl({
    type: 'acme:StatusCard',
    category: 'Acme toolkit',
    namespace: 'clr-namespace:Acme.Controls;assembly=Acme.Controls',
    defaults: { Width: '260', Height: '125', Status: 'Active', Title: 'Design review' },
    properties: [
      { name: 'Status', type: 'enum', values: ['Active', 'Paused', 'Done'] },
      { name: 'Title', type: 'string' },
    ],
    render({ properties }) {
      const card = document.createElement('div');
      card.style.cssText = 'padding:20px;border:1px solid #ded9eb;border-radius:12px;background:#faf7ff';
      const title = document.createElement('strong');
      title.textContent = properties.Title || 'Status card';
      const status = document.createElement('div');
      status.textContent = properties.Status || 'Active';
      status.style.cssText = 'font-size:12px;margin-top:14px;color:#7953e8';
      card.append(title, status);
      return card;
    },
  });

  registry.registerAdapter('Element outline', {
    serialize(document) {
      const lines = [];
      function visit(node, depth = 0) {
        if (node.kind !== 'element') return;
        lines.push('  '.repeat(depth) + node.type);
        node.children.forEach(child => visit(child, depth + 1));
      }
      visit(document.root);
      return { content: lines.join('\n'), extension: 'txt', mimeType: 'text/plain' };
    },
  });
}

// Deliberately explicit: consumers choose when to install executable extension code.
// installAcmeToolkit(window.xamora.registry);

export const customScaffold = element('StackPanel', {}, [
  element('TextBlock', { Text: 'Reusable toolkit content' }),
  element('Button', { Content: 'Continue' }),
]);
