/** Shared native-parser cases; called in real Chromium against source and package APIs. */
export function runRefactoringCases(api) {
  const {
    DocumentStore,
    DocumentSession,
    MarkupRefactorService,
    parseHtml,
    parseXaml,
    walk,
    find,
  } = api;
  const check = (value, message) => {
    if (!value) throw Error(message);
  };
  let assertions = 0;
  const eq = (actual, expected, message) => {
    assertions++;
    check(actual === expected, message + ': ' + actual);
  };
  const setup = (source) => {
    const store = new DocumentStore(parseHtml(source)),
      session = new DocumentSession(store, { source });
    return {
      store,
      session,
      service: new MarkupRefactorService(session),
      node(type) {
        let value;
        walk(store.document.root, (n) => {
          if (n.type === type) value ??= n;
        });
        return value;
      },
      dispose() {
        this.service.dispose();
        session.dispose();
      },
    };
  };
  for (const [source, target, wrapper, ns] of [
    ['<svg><circle r="4"/></svg>', 'circle', 'g', 'http://www.w3.org/2000/svg'],
    ['<math><mi>x</mi></math>', 'mi', 'mrow', 'http://www.w3.org/1998/Math/MathML'],
    [
      '<svg><foreignObject><div>HTML</div></foreignObject></svg>',
      'div',
      'section',
      'http://www.w3.org/1999/xhtml',
    ],
    [
      '<math><annotation-xml encoding="text/html"><div>Text</div></annotation-xml></math>',
      'div',
      'section',
      'http://www.w3.org/1999/xhtml',
    ],
  ]) {
    const s = setup(source),
      id = s.node(target).id;
    const p = s.service.prepareWrap(id, wrapper);
    s.service.apply(p);
    eq(find(s.store.document.root, p.selectedId).namespaceURI, ns, wrapper + ' namespace');
    eq(find(s.store.document.root, id).type, target, 'preserved identity');
    s.store.undo();
    eq(s.session.source, source, 'exact undo');
    s.store.redo();
    eq(s.session.source, p.after, 'exact redo');
    s.service.apply(s.service.prepareUnwrap(p.selectedId));
    eq(s.session.source, source, 'unwrap concrete content');
    s.dispose();
  }
  {
    const source =
        "<svg><linearGradient id='ink' gradientUnits='userSpaceOnUse'><stop offset='0'/></linearGradient></svg>",
      s = setup(source),
      p = s.service.prepareRename(s.node('linearGradient').id, 'radialGradient');
    eq(
      p.after,
      source.replaceAll('linearGradient', 'radialGradient'),
      'SVG adjusted attribute spelling and quote fidelity',
    );
    s.service.apply(p);
    s.dispose();
  }
  for (const [source, target, action, name] of [
    ['<main><div><div>Nested</div></div></main>', 'div', 'rename', 'p'],
    ['<table><tbody><tr><td>A</td></tr></tbody></table>', 'tr', 'wrap', 'div'],
    ['<main><svg><circle/></svg></main>', 'svg', 'rename', 'g'],
    ['<main><svg><circle/></svg></main>', 'svg', 'unwrap', ''],
    ['<svg><g><circle/></g></svg>', 'g', 'rename', 'foreignObject'],
  ]) {
    const s = setup(source),
      before = JSON.stringify(s.store.document);
    let rejected = false;
    try {
      if (action === 'rename') s.service.prepareRename(s.node(target).id, name);
      else if (action === 'wrap') s.service.prepareWrap(s.node(target).id, name);
      else s.service.prepareUnwrap(s.node(target).id);
    } catch {
      rejected = true;
    }
    check(rejected, 'Reject parser-induced structure/namespace change: ' + action + ' ' + name);
    eq(JSON.stringify(s.store.document), before, 'atomic rejection');
    eq(s.store.history.length, 0, 'no history on rejection');
    s.dispose();
  }
  {
    const source = '<main><b>A&nbsp;B</b> &amp; <!-- gap --> <i>C</i></main>',
      s = setup(source),
      p = s.service.prepareWrap([s.node('b').id, s.node('i').id], 'section');
    s.service.apply(p);
    eq(
      s.session.source,
      source.replace('<main>', '<main><section>').replace('</main>', '</section></main>'),
      'HTML text and entities',
    );
    s.dispose();
  }
  {
    const source = '<Grid><Border><Button Content="Save"/></Border></Grid>',
      store = new DocumentStore(parseXaml(source)),
      session = new DocumentSession(store, { source }),
      service = new MarkupRefactorService(session);
    const id = store.document.root.children[0].id,
      p = service.prepareUnwrap(id);
    service.apply(p);
    eq(session.source, '<Grid><Button Content="Save"/></Grid>', 'XAML native realm');
    service.dispose();
    session.dispose();
  }
  return { assertions };
}
