import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { builtins } from '../dist/core/registry.js';
import { parseXaml } from '../dist/core/xaml.js';
import { parseHtml } from '../dist/core/html.js';
import { DocumentStore } from '../dist/core/model.js';
import { DocumentSession } from '../dist/core/document-session.js';
import {
  JevClient,
  jevSettings,
  aiEndpoint,
  validateJevResponse,
  validateJevRequest,
  aiJSON,
  jsonBytes,
} from '../dist/core/jev-client.js';
import {
  JevAssistant,
  fitJevRequest,
  redactJevContext,
  jevLiteralCandidates,
} from '../dist/core/jev-assistant.js';
import { JevPreferences } from '../dist/core/jev-settings.js';
import { jevTemplate, JEV_RECIPES } from '../dist/core/jev-templates.js';

import { responseFor } from './jev-fixture.mjs';

function snapshot(source, framework = 'WPF', scope = 'document') {
  const document = framework === 'HTML' ? parseHtml(source) : parseXaml(source);
  const store = new DocumentStore(document),
    session = new DocumentSession(store, { source });
  const snap = {
    document: store.document,
    source: session.source,
    selection: [document.root.children[0]?.id || document.root.id],
    revision: store.revision,
    scope,
  };
  session.dispose();
  return snap;
}
function fake(selections) {
  const requests = [];
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, options, body });
    const result =
      typeof selections === 'function' ? selections(body, requests.length) : selections.shift();
    return new Response(JSON.stringify(responseFor(body, result)), { status: 200 });
  };
  return { requests, fetch };
}
test('Jev transport sends state/questions not chat and keeps credentials out of the payload', async () => {
  const mock = fake([{ route: 'blue' }]);
  const client = new JevClient({}, { apiKey: 'test-private-key', fetch: mock.fetch });
  const result = await client.evaluate('make blue', {
    route: { type: 'choice', instructions: 'Which color?', criteria: { blue: 'blue', red: 'red' } },
  });
  const req = mock.requests[0];
  assert.equal(req.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(req.options.headers.Authorization, 'Bearer test-private-key');
  assert.equal(req.options.redirect, 'error');
  assert.equal(req.options.credentials, 'omit');
  assert(!JSON.stringify(req.body).includes('test-private-key'));
  assert(!req.body.messages);
  assert.equal(result.answers.route.choice, 'blue');
});
test('model listing uses authenticated GET and no work context', async () => {
  let options;
  const models = await new JevClient(
    {},
    {
      apiKey: 'private',
      fetch: async (url, o) => {
        options = o;
        assert(url.endsWith('/v1/models'));
        return Response.json({ models: [{ name: 'jev-latest' }] });
      },
    },
  ).models();
  assert.equal(models.length, 1);
  assert.equal(options.method, 'GET');
  assert.equal(options.body, undefined);
});
test('request settings reject unsafe endpoints, nonfinite limits and unknown secret persistence', () => {
  for (const url of [
    'javascript:x',
    'https://user:pass@host.test',
    'https://host.test/?key=secret',
    'http://public.test',
  ])
    assert.throws(() => aiEndpoint(url));
  assert.equal(aiEndpoint('/api/jev', 'https://studio.test'), 'https://studio.test/api/jev');
  assert.equal(jevSettings({ apiKey: 'secret' }).apiKey, undefined);
  for (const bad of [
    { maxSteps: 9 },
    { minProbability: NaN },
    { maxRequestBytes: 50000 },
    { timeoutMs: 0 },
  ])
    assert.throws(() => jevSettings(bad));
});
test('response validation rejects missing, extra, out-of-catalog and nonfinite answers', () => {
  const req = {
    model: 'jev-latest',
    state: 'x',
    questions: { route: { type: 'choice', instructions: 'x', criteria: { a: 'a', b: 'b' } } },
  };
  const good = responseFor(req, { route: 'a' });
  assert.equal(validateJevResponse(good, req), good);
  for (const mutate of [
    (d) => delete d.answers.route,
    (d) => (d.answers.extra = {}),
    (d) => (d.answers.route.choice = 'arbitrary-js'),
    (d) => (d.answers.route.probabilities.a = NaN),
    (d) => (d.answers.route.confidence = -1),
  ]) {
    const data = structuredClone(good);
    mutate(data);
    assert.throws(() => validateJevResponse(data, req));
  }
});
test('bounded request helper retries overload, honors cancellation and hides provider error bodies', async () => {
  let calls = 0;
  const result = await aiJSON('https://api.test', {
    retries: 1,
    fetch: async () =>
      ++calls === 1
        ? new Response('secret', { status: 529, headers: { 'Retry-After': '0' } })
        : Response.json({ ok: true }),
  });
  assert(result.ok);
  assert.equal(calls, 2);
  await assert.rejects(
    aiJSON('https://api.test', {
      fetch: async () => new Response('sk-do-not-echo-secret', { status: 401 }),
    }),
    /Invalid or missing API key/,
  );
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    aiJSON('https://api.test', { signal: c.signal, fetch: () => assert.fail('must not fetch') }),
    { name: 'AbortError' },
  );
  await assert.rejects(
    aiJSON('https://api.test', {
      maxResponseBytes: 4,
      fetch: async () => Response.json({ large: 'too large' }),
    }),
    /size limit/,
  );
});
test('secret minimization applies to questions as well as state without collecting unknown properties', () => {
  assert.deepEqual(
    redactJevContext({ apiKey: 'secret', source: 'Bearer abcdef', label: 'private-credential' }, [
      'private-credential',
    ]),
    { apiKey: '[REDACTED]', source: 'Bearer [REDACTED]', label: '[REDACTED]' },
  );
  const packed = fitJevRequest(
    'jev-latest',
    {
      request: 'safe',
      sourceExcerpt: { text: 'x'.repeat(8000) },
      nodes: [{ id: '1', properties: { width: 10 } }],
    },
    {
      q: {
        type: 'choice',
        instructions: 'key secret-123456789',
        criteria: { a: 'secret-123456789', none: 'none' },
      },
    },
    4096,
    ['secret-123456789'],
  );
  assert(packed.bytes <= 4096);
  assert(packed.omitted.includes('source excerpt'));
  assert(!JSON.stringify(packed.request).includes('secret-123456789'));
  assert.throws(
    () =>
      fitJevRequest(
        'jev-latest',
        { request: 'x'.repeat(9000) },
        { q: { type: 'noul', instructions: 'q' } },
        4096,
      ),
    /budget/,
  );
});
test('native text plan is staged, source-preserving and consumes only relevant speculative answers', async (t) => {
  controlDOM(t);
  const snap = snapshot('<Grid><!-- keep --><Button Content="Before"/></Grid>');
  const before = JSON.stringify(snap);
  const mock = fake((body) =>
    body.questions.value
      ? { value: '"After"' }
      : { operation: body.state.completed.length ? 'done:' : 'set_text:', target: 'Button' },
  );
  const plan = await new JevAssistant({ registry: builtins(), fetch: mock.fetch }).plan(
    snap,
    'Set button text to "After"',
  );
  assert(plan.source.includes('Content="After"'));
  assert(plan.source.includes('<!-- keep -->'));
  assert.equal(plan.operations.length, 1);
  assert(plan.complete);
  assert.equal(JSON.stringify(snap), before);
  assert.equal(plan.requests.length, 3);
});
test('native property plan retains exact existing source outside the property', async (t) => {
  controlDOM(t);
  const snap = snapshot("<Grid>\n  <Button Width='100' Content='Go' />\n</Grid>");
  const mock = fake((body) =>
    body.questions.property
      ? { property: 'Width' }
      : body.questions.value
        ? { value: '"240"' }
        : { operation: body.state.completed.length ? 'done:' : 'set_property:', target: 'Button' },
  );
  const plan = await new JevAssistant({ registry: builtins(), fetch: mock.fetch }).plan(
    snap,
    'Set button width to 240',
  );
  assert.equal(plan.source, "<Grid>\n  <Button Width='240' Content='Go' />\n</Grid>");
});
test('HTML native CSS edits preserve unrelated declarations and namespace metadata', async (t) => {
  controlDOM(t);
  const snap = snapshot(
    '<main><button style="padding: 8px; color: red">Go</button></main>',
    'HTML',
  );
  const mock = fake((body) =>
    body.questions.property
      ? { property: 'style.color' }
      : body.questions.value
        ? { value: '"#2563EB"' }
        : { operation: body.state.completed.length ? 'done:' : 'set_property:', target: 'button' },
  );
  const plan = await new JevAssistant({ registry: builtins(), fetch: mock.fetch }).plan(
    snap,
    'Set button style.color to "#2563EB"',
  );
  assert(plan.source.includes('padding: 8px'));
  assert(plan.source.includes('#2563EB'));
});
test('selection, locks and bound text remain enforced after typed decisions', async (t) => {
  controlDOM(t);
  const snap = snapshot(
    '<Grid><TextBlock Text="{Binding Name}"/><Button Content="Other"/></Grid>',
    'WPF',
    'selection',
  );
  const mock = fake((b) =>
    b.questions.value ? { value: '"New"' } : { operation: 'set_text:', target: 'TextBlock' },
  );
  await assert.rejects(
    new JevAssistant({ registry: builtins(), fetch: mock.fetch }).plan(snap, 'Set text to "New"'),
    /bound/,
  );
  snap.document.metadata.locked = [snap.selection[0]];
  await assert.rejects(
    new JevAssistant({ registry: builtins(), fetch: mock.fetch }).plan(snap, 'Set text to "New"'),
    /locked/,
  );
  assert(
    mock.requests.every(
      ({ body }) =>
        !body.questions.target || !JSON.stringify(body.questions.target.criteria).includes('Other'),
    ),
  );
});
test('preview builds exact first request with zero network calls', async (t) => {
  controlDOM(t);
  const result = await new JevAssistant({
    registry: builtins(),
    fetch: () => assert.fail('no network'),
  }).plan(snapshot('<Grid/>'), 'Create a login starter', { previewOnly: true });
  assert(result.request.questions.operation);
  assert(result.bytes > 0);
  assert(!result.request.messages);
});
test('new documents use typed recipe/framework/palette/title selection and never modify snapshot', async (t) => {
  controlDOM(t);
  const snap = snapshot('<Grid/>'),
    original = JSON.stringify(snap);
  const mock = fake([
    { operation: 'new_document:' },
    { framework: 'HTML', recipe: 'login:', palette: 'blue', title: 'Default heading' },
  ]);
  const plan = await new JevAssistant({ registry: builtins(), fetch: mock.fetch }).plan(
    snap,
    'Create an HTML login starter in blue',
  );
  assert.equal(plan.createdDocument.framework, 'HTML');
  assert(plan.source.includes('type="password"'));
  assert.equal(JSON.stringify(snap), original);
});
test('uncertainty or unsupported intent never becomes an executable command', async (t) => {
  controlDOM(t);
  const snap = snapshot('<Grid/>');
  const mock = fake([{ operation: 'unsupported:' }]);
  await assert.rejects(
    new JevAssistant({ registry: builtins(), fetch: mock.fetch }).plan(
      snap,
      'Do something impossible',
    ),
    /no supported action/,
  );
  const bad = {
    evaluate: async (state, questions) => {
      const result = responseFor({ questions }, { operation: 'set_text:', target: 'Grid' });
      result.answers.operation.confidence = 0.1;
      return result;
    },
  };
  await assert.rejects(
    new JevAssistant({ registry: builtins(), client: bad }).plan(snap, 'Edit text'),
    /Uncertain/,
  );
});
test('global operation uses an explicit catalog rather than executable strings', async (t) => {
  controlDOM(t);
  const snap = snapshot('<Grid/>', 'WPF', 'application');
  snap.commands = [
    { id: 'theme', label: 'Dark theme' },
    { id: 'eval', label: 'Run arbitrary JavaScript' },
  ];
  const mock = fake([{ operation: 'command:', command: 'theme:' }]);
  const plan = await new JevAssistant({ registry: builtins(), fetch: mock.fetch }).plan(
    snap,
    'Change the application theme',
  );
  assert.deepEqual(plan.appAction, { type: 'command', id: 'theme' });
  assert(!JSON.stringify(mock.requests[0].body.questions).includes('Run arbitrary JavaScript'));
});
test('configured step cap bounds inference and marks unfinished plans', async (t) => {
  controlDOM(t);
  const snap = snapshot('<Grid><Button Content="Before"/></Grid>');
  const mock = fake((body) =>
    body.questions.value ? { value: '"After"' } : { operation: 'set_text:', target: 'Button' },
  );
  const plan = await new JevAssistant({
    registry: builtins(),
    fetch: mock.fetch,
    settings: { maxSteps: 1 },
  }).plan(snap, 'Set button text to "After"');
  assert(!plan.complete);
  assert.match(plan.stopped, /step limit/);
  assert.equal(mock.requests.length, 2);
});
test('native insertion, duplication and deletion keep valid unique AST identities', async (t) => {
  controlDOM(t);
  for (const op of ['insert_control', 'duplicate_node', 'delete_node']) {
    const snap = snapshot('<StackPanel><Button Content="One"/></StackPanel>');
    const mock = fake((body) =>
      body.questions.control
        ? { control: 'TextBlock' }
        : {
            operation: body.state.completed.length ? 'done:' : op + ':',
            target: op === 'insert_control' ? 'StackPanel' : 'Button',
          },
    );
    const plan = await new JevAssistant({ registry: builtins(), fetch: mock.fetch }).plan(
      snap,
      op + ' Button or TextBlock',
    );
    assert.equal(plan.operations.length, 1);
    assert.doesNotThrow(() => parseXaml(plan.source));
  }
});
test('hybrid generation has separate credentials and explicit Jev routing/verification', async (t) => {
  controlDOM(t);
  let calls = 0;
  const fetch = async (url, o) => {
    const body = JSON.parse(o.body);
    calls++;
    if (url.includes('/chat/completions')) {
      assert.equal(o.headers.Authorization, 'Bearer generator-private');
      assert(!o.body.includes('jev-private'));
      return Response.json({
        model: 'configured-text',
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({ source: '<Grid><Button Content="Custom"/></Grid>' }),
            },
          },
        ],
      });
    }
    assert.equal(o.headers.Authorization, 'Bearer jev-private');
    return Response.json(
      responseFor(
        body,
        body.questions.fits
          ? { fits: 0.99 }
          : body.questions.framework
            ? { framework: 'WPF' }
            : { operation: 'generate_new:' },
      ),
    );
  };
  const plan = await new JevAssistant({
    registry: builtins(),
    fetch,
    credentials: { apiKey: 'jev-private', generatorKey: 'generator-private' },
    settings: {
      generatorEnabled: true,
      generatorEndpoint: 'https://gen.test/chat/completions',
      generatorModel: 'configured-text',
    },
  }).plan(snapshot('<Grid/>'), 'Create a bespoke view');
  assert.equal(calls, 4);
  assert(plan.generator);
  assert(plan.source.includes('Custom'));
  assert(plan.requests.every((r) => !JSON.stringify(r.request).includes('private')));
});
test('hybrid edits never send incomplete or secret-redacted source for replacement', async (t) => {
  controlDOM(t);
  const mock = fake([{ operation: 'generate_edit:', target: 'Grid' }]);
  const assistant = new JevAssistant({
    registry: builtins(),
    fetch: mock.fetch,
    settings: {
      generatorEnabled: true,
      includeSource: false,
      generatorEndpoint: 'https://gen.test/chat/completions',
      generatorModel: 'test',
    },
  });
  await assert.rejects(
    assistant.plan(snapshot('<Grid/>'), 'Change the entire page'),
    /source sharing/,
  );
  assert.equal(mock.requests.length, 1);
});
test('credential vault persists preferences only unless explicitly opting into endpoint-bound session storage', () => {
  const map = new Map(),
    memory = {
      getItem: (k) => map.get(k),
      setItem: (k, v) => map.set(k, v),
      removeItem: (k) => map.delete(k),
    };
  const sessions = new Map(),
    session = {
      getItem: (k) => sessions.get(k),
      setItem: (k, v) => sessions.set(k, v),
      removeItem: (k) => sessions.delete(k),
    };
  const preferences = new JevPreferences({ storage: memory, sessionStorage: session });
  preferences.save({}, { apiKey: 'very-private' });
  assert(![...map.values()].join().includes('very-private'));
  assert.equal(sessions.size, 0);
  preferences.save({}, { apiKey: 'very-private' }, true);
  assert.equal(
    new JevPreferences({ storage: memory, sessionStorage: session }).credentials().apiKey,
    'very-private',
  );
  assert.throws(
    () => preferences.save({ endpoint: 'https://other.test' }, { apiKey: 'very-private' }),
    /endpoint changed/,
  );
  preferences.clearKeys();
  assert.equal(sessions.size, 0);
  assert.equal(preferences.credentials().apiKey, undefined);
});
test('all deterministic starters parse for each advertised framework', (t) => {
  controlDOM(t);
  for (const framework of ['HTML', 'WPF', 'Avalonia', 'WinUI'])
    for (const recipe of Object.keys(JEV_RECIPES)) {
      const source = jevTemplate({ framework, recipe, title: 'Safe & <literal>' });
      const doc = framework === 'HTML' ? parseHtml(source) : parseXaml(source);
      assert(doc.root);
      assert(!source.includes('Safe & <literal>'));
    }
  assert.throws(() => jevTemplate({ recipe: 'unknown' }));
});
test('literal candidates copy supplied values and request budgets include question choices', () => {
  assert.deepEqual(jevLiteralCandidates('use "Hello" and 32px'), ['Hello', '32px']);
  assert.throws(
    () =>
      validateJevRequest({
        model: 'jev',
        state: 's',
        questions: { x: { type: 'choice', instructions: 'x', criteria: { a: 'a' } } },
      }),
    /2–255/,
  );
  assert(jsonBytes({ a: 'ą' }) > JSON.stringify({ a: 'ą' }).length);
});

test('a provider Retry-After outside the request deadline is not shortened into an early retry', async () => {
  let requests = 0;
  await assert.rejects(
    aiJSON('https://api.test', {
      retries: 2,
      timeoutMs: 1000,
      fetch: async () => {
        requests++;
        return new Response('', { status: 429, headers: { 'Retry-After': '3600' } });
      },
    }),
    /Retry-After/,
  );
  assert.equal(requests, 1);
});
test('selection context excludes adjacent source and private input values from all candidates', async (t) => {
  controlDOM(t);
  const snap = snapshot(
    '<Grid><Button Content="Selected"/><TextBlock Text="NEIGHBOR-PRIVATE"/></Grid>',
    'WPF',
    'selection',
  );
  const ai = new JevAssistant({ registry: builtins(), fetch: () => assert.fail('preview only') });
  const preview = await ai.plan(snap, 'Update selected text', { previewOnly: true });
  assert(!JSON.stringify(preview).includes('NEIGHBOR-PRIVATE'));
  const secret = 'test-value-do-not-send';
  const privateSnap = snapshot(`<Grid><PasswordBox Password="${secret}"/></Grid>`);
  const privatePreview = await ai.plan(privateSnap, 'Inspect layout', { previewOnly: true });
  assert(!JSON.stringify(privatePreview).includes(secret));
  assert(!redactJevContext(`<input type="password" value="${secret}">`).includes(secret));
});
test('typed instructions, Score legends and mandatory usage are validated', () => {
  const request = {
    model: 'jev-latest',
    state: 'state',
    questions: { q: { type: 'score', instructions: 'Rate', criteria: ['low', 'high'] } },
  };
  assert.doesNotThrow(() => validateJevRequest(request));
  for (const instructions of [true, 5, null])
    assert.throws(() =>
      validateJevRequest({
        ...request,
        questions: { q: { ...request.questions.q, instructions } },
      }),
    );
  const result = {
    model: 'jev-fixture',
    usage: { input_tokens: 1, output_tokens: 1 },
    answers: {
      q: {
        type: 'score',
        score: 0.8,
        confidence: 0.9,
        probabilities: { 0: 0.2, 1: 0.8 },
        legend: { 0: 'low', 1: 'high' },
      },
    },
  };
  assert.doesNotThrow(() => validateJevResponse(result, request));
  assert.throws(() => validateJevResponse({ ...result, usage: undefined }, request));
  assert.throws(() =>
    validateJevResponse(
      { ...result, answers: { q: { ...result.answers.q, legend: { 0: 'wrong', 1: 'high' } } } },
      request,
    ),
  );
});
for (const source of [
  '<Grid><Button Click="Injected"/></Grid>',
  '<html><body><script>unsafe()</script></body></html>',
  '<html><body><img src="https://example.test/tracking"></body></html>',
])
  test(`generated active content is rejected before semantic verification: ${source.slice(0, 45)}`, async (t) => {
    controlDOM(t);
    let verified = false;
    const framework = source.startsWith('<Grid') ? 'WPF' : 'HTML';
    const ai = new JevAssistant({
      registry: builtins(),
      settings: {
        generatorEnabled: true,
        generatorEndpoint: 'https://writer.test/chat/completions',
        generatorModel: 'fixture',
      },
      fetch: async (url, o) => {
        const body = JSON.parse(o.body);
        if (url.includes('writer.test'))
          return Response.json({
            choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ source }) } }],
          });
        if (body.questions.fits) verified = true;
        return Response.json(
          responseFor(
            body,
            body.questions.framework ? { framework } : { operation: 'generate_new:' },
          ),
        );
      },
    });
    await assert.rejects(ai.plan(snapshot('<Grid/>'), 'Generate a bespoke page'), /Generated/);
    assert.equal(verified, false);
  });
test('generated selection replacement must be a single element, not siblings or a full document', async (t) => {
  controlDOM(t);
  const snap = snapshot('<Grid><Button Content="Before"/></Grid>', 'WPF', 'selection');
  const original = JSON.stringify(snap);
  const ai = new JevAssistant({
    registry: builtins(),
    settings: {
      generatorEnabled: true,
      generatorEndpoint: 'https://writer.test/chat/completions',
      generatorModel: 'fixture',
    },
    fetch: async (url, o) => {
      const body = JSON.parse(o.body);
      if (url.includes('writer.test'))
        return Response.json({
          choices: [{ finish_reason: 'stop', message: { content: '<Button/><Button/>' } }],
        });
      return Response.json(responseFor(body, { operation: 'generate_edit:', target: 'Button' }));
    },
  });
  await assert.rejects(ai.plan(snap, 'Redesign this element'), /exactly one/);
  assert.equal(JSON.stringify(snap), original);
});
test('generator token parameter is configured explicitly and never sent to Jev', async (t) => {
  controlDOM(t);
  let generated = false;
  const ai = new JevAssistant({
    registry: builtins(),
    settings: {
      generatorEnabled: true,
      generatorEndpoint: 'https://writer.test/chat/completions',
      generatorModel: 'fixture',
      generatorTokenParameter: 'max_completion_tokens',
    },
    fetch: async (url, o) => {
      const body = JSON.parse(o.body);
      if (url.includes('writer.test')) {
        assert.equal(body.max_completion_tokens, 4096);
        assert.equal(body.max_tokens, undefined);
        generated = true;
        return Response.json({
          choices: [{ finish_reason: 'stop', message: { content: '<Grid/>' } }],
        });
      }
      assert.equal(body.max_completion_tokens, undefined);
      return Response.json(
        responseFor(
          body,
          body.questions.framework
            ? { framework: 'WPF' }
            : body.questions.fits
              ? { fits: 0.99 }
              : { operation: 'generate_new:' },
        ),
      );
    },
  });
  assert((await ai.plan(snapshot('<Grid/>'), 'Generate a bespoke XAML page')).createdDocument);
  assert(generated);
});

test('an existing private proxy access token cannot silently follow a changed endpoint', () => {
  const preferences = new JevPreferences();
  preferences.save({}, { proxyToken: 'private-access-token' });
  assert.throws(
    () =>
      preferences.save(
        { endpoint: 'https://new-destination.test' },
        { proxyToken: 'private-access-token' },
      ),
    /proxy access token/,
  );
  preferences.save(
    { endpoint: 'https://new-destination.test' },
    { proxyToken: 'private-access-token' },
    false,
    true,
  );
  assert.equal(preferences.value.endpoint, 'https://new-destination.test');
});
test('native duplication clears aliased XAML names instead of creating duplicate names', async (t) => {
  controlDOM(t);
  const snap = snapshot(
    '<Grid xmlns:q="http://schemas.microsoft.com/winfx/2006/xaml"><Button q:Name="Original" Content="Copy"/></Grid>',
  );
  const mock = fake((b) => ({
    operation: b.state.completed.length ? 'done:' : 'duplicate_node:',
    target: 'Button',
  }));
  const plan = await new JevAssistant({ registry: builtins(), fetch: mock.fetch }).plan(
    snap,
    'Duplicate the button',
  );
  assert.equal((plan.source.match(/q:Name=/g) || []).length, 1);
});
