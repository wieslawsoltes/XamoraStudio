import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { Studio } from '../dist/studio/studio.js';
import { PreviewRenderer } from '../dist/core/render.js';
import { builtins } from '../dist/core/registry.js';
import { parseXaml } from '../dist/core/xaml.js';
import { motionBase, motionDocument } from '../dist/core/motion-render.js';

for (const previous of [false, true])
  test(`resource board initializes current renderer context after previous preview=${previous}`, (t) => {
    const dom = controlDOM(t);
    const doc = parseXaml(
      '<ResourceDictionary xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><SolidColorBrush x:Key="Accent" Color="#456789"/><SolidColorBrush x:Key="Alias" Color="{StaticResource Accent}"/></ResourceDictionary>',
    );
    const renderer = new PreviewRenderer(builtins());
    let disposed = 0;
    if (previous) {
      renderer.prepareDocument(parseXaml('<Grid><Button Content="Old document"/></Grid>'));
      renderer.elements.set('old', dom.host());
      renderer.runtimeTemplates.push({ ownerId: 'old', tree: { id: 'obsolete' } });
      renderer.contexts.set('old', {});
      renderer.htmlRenderer = { dispose: () => disposed++ };
    }
    const before = JSON.stringify(doc);
    const host = dom.host();
    Studio.prototype.renderResourceBoard.call(
      { renderer, doc, resources: () => doc.root.children },
      host,
    );
    assert.equal(renderer.document, doc);
    assert.equal(renderer.designTime, true);
    assert.equal(renderer.interactive, false);
    assert.equal(renderer.contexts.size, 0);
    assert.deepEqual(renderer.runtimeTemplates, []);
    assert.equal(renderer.elements.has('old'), false);
    assert.equal(disposed, previous ? 1 : 0);
    assert.equal(renderer.elements.size, 2);
    assert.equal(host.querySelectorAll('.token-card').length, 2);
    const copy = motionDocument(renderer);
    assert.equal(copy.id, doc.id);
    const base = motionBase(renderer, copy);
    assert.equal(base.root.children[1].props.Color, '#456789');
    assert.equal(renderer.parents.get(doc.root.children[1].id), doc.root);
    assert.equal(
      JSON.stringify(doc),
      before,
      'Preview context initialization does not author changes',
    );
  });
