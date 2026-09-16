import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlRecordingOffset } from '../dist/studio/html-animation-workspace.js';

test('HTML recording converts milliseconds and delay to local keyframe progress', () => {
  assert.equal(htmlRecordingOffset(750, { duration: 1000, delay: 250 }), 0.5);
  assert.equal(htmlRecordingOffset(100, { duration: 1000, delay: 250 }), 0);
  assert.equal(htmlRecordingOffset(250, { duration: 1000, delay: -250 }), 0.5);
});
test('HTML recording clamps finite playback at the final frame', () => {
  assert.equal(htmlRecordingOffset(1000, { duration: 1000 }), 1);
  assert.equal(htmlRecordingOffset(1800, { duration: 1000 }), 1);
  assert.equal(htmlRecordingOffset(2500, { duration: 1000, iterations: 2.5 }), 0.5);
});
test('HTML recording preserves reverse, alternate and alternate-reverse directions', () => {
  assert.equal(htmlRecordingOffset(250, { duration: 1000, direction: 'reverse' }), 0.75);
  assert.equal(
    htmlRecordingOffset(1250, { duration: 1000, iterations: 3, direction: 'alternate' }),
    0.75,
  );
  assert.equal(
    htmlRecordingOffset(2250, { duration: 1000, iterations: 3, direction: 'alternate' }),
    0.25,
  );
  assert.equal(htmlRecordingOffset(250, { duration: 1000, direction: 'alternate-reverse' }), 0.75);
  assert.equal(
    htmlRecordingOffset(2000, { duration: 1000, iterations: 2, direction: 'alternate' }),
    0,
  );
});
test('HTML recording repeats an infinite animation without producing out-of-range keys', () => {
  assert.equal(htmlRecordingOffset(2250, { duration: 1000, iterations: Infinity }), 0.25);
  assert.equal(
    htmlRecordingOffset(2250, {
      duration: 1000,
      iterations: 'infinite',
      direction: 'alternate-reverse',
    }),
    0.75,
  );
});

import { HtmlAnimationWorkspace } from '../dist/studio/html-animation-workspace.js';
import { setHtmlStyle } from '../dist/core/html.js';
import {
  DocumentStore,
  find,
  walk,
  element,
  createDocument,
  textNode,
} from '../dist/core/model.js';
import { createHtmlAnimation, listHtmlAnimations } from '../dist/core/html-animation.js';

// Minimal declaration adapter isolates authoring transactions from browser rendering.
class Declarations {
  constructor() {
    this.values = new Map();
  }
  set cssText(text) {
    this.values = new Map(
      String(text || '')
        .split(';')
        .filter((s) => s.includes(':'))
        .map((s) => {
          const at = s.indexOf(':');
          return [s.slice(0, at).trim(), s.slice(at + 1).trim()];
        }),
    );
  }
  get cssText() {
    return [...this.values].map(([k, v]) => k + ': ' + v + ';').join(' ');
  }
  [Symbol.iterator]() {
    return this.values.keys();
  }
  getPropertyValue(key) {
    return this.values.get(key) || '';
  }
  setProperty(key, value) {
    this.values.set(key, String(value));
  }
}
test('recording a removed inline property preserves base CSS and commits resolved keyframe once', () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ style: new Declarations() }) };
  try {
    const doc = createDocument(
      element('html', {}, [
        element('head'),
        element('body', {}, [
          element('div', { id: 'box', style: 'opacity: 0.7; color: red;' }, [textNode('Box')]),
        ]),
      ]),
      'HTML',
      'record.html',
    );
    let box;
    walk(doc.root, (n) => {
      if (n.props?.id === 'box') box = n;
    });
    const animation = createHtmlAnimation(doc, box.id, {
      duration: 1000,
      frames: [
        { offset: 0, values: { opacity: '0' } },
        { offset: 1, values: { opacity: '1' } },
      ],
    });
    const store = new DocumentStore(doc),
      before = find(store.document.root, box.id).props.style;
    const workspace = {
      environment: { document: globalThis.document },
      recording: true,
      time: 500,
      definition: { id: animation.id, name: animation.name },
      resolveRemovedValue: () => '.4',
      computed: () => '.7',
    };
    store.transaction('Record removed opacity', (d) =>
      HtmlAnimationWorkspace.prototype.recordMutation.call(workspace, d, (model) =>
        setHtmlStyle(find(model.root, box.id), 'opacity', ''),
      ),
    );
    assert.equal(find(store.document.root, box.id).props.style, before);
    assert.equal(
      listHtmlAnimations(store.document).definitions[0].frames.find((f) => f.offset === 0.5).values
        .opacity,
      '.4',
    );
    assert.equal(store.history.length, 1);
    store.undo();
    assert.equal(listHtmlAnimations(store.document).definitions[0].frames.length, 2);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
test('an unresolved removed CSS value aborts recording without mutating base styles', () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ style: new Declarations() }) };
  try {
    const doc = createDocument(
      element('html', {}, [
        element('head'),
        element('body', {}, [element('div', { style: 'opacity: .7' }, [textNode('Box')])]),
      ]),
      'HTML',
      'record.html',
    );
    let box;
    walk(doc.root, (n) => {
      if (n.type === 'div') box = n;
    });
    const store = new DocumentStore(doc),
      before = JSON.stringify(store.document);
    const workspace = {
      environment: { document: globalThis.document },
      recording: true,
      time: 500,
      resolveRemovedValue: () => '',
    };
    assert.throws(
      () =>
        store.transaction('Record removed value', (d) =>
          HtmlAnimationWorkspace.prototype.recordMutation.call(workspace, d, (model) =>
            setHtmlStyle(find(model.root, box.id), 'opacity', ''),
          ),
        ),
      /Cannot resolve/,
    );
    assert.equal(JSON.stringify(store.document), before);
    assert.equal(store.history.length, 0);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
