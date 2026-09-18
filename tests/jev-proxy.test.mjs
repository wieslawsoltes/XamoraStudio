import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createAIServer } from '../scripts/serve-ai.mjs';
import { responseFor } from './jev-fixture.mjs';
async function fixture(t, options = {}) {
  const calls = [];
  const server = createAIServer({
    apiKey: 'server-private',
    authToken: 'access-private',
    fetch: async (url, o) => {
      calls.push({ url, o });
      return Response.json(
        url.endsWith('/models')
          ? { models: [{ name: 'jev-latest' }] }
          : responseFor(JSON.parse(o.body), { q: 'yes' }),
      );
    },
    ...options,
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(
    () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  );
  const port = server.address().port,
    base = 'http://127.0.0.1:' + port;
  const send = (path, { method = 'GET', headers = {}, data } = {}) =>
    new Promise((resolve, reject) => {
      const req = request(
        base + path,
        {
          method,
          headers: {
            Origin: base,
            'X-Xamora-AI-Token': 'access-private',
            ...(data ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
          },
        },
        (res) => {
          let text = '';
          res.on('data', (chunk) => (text += chunk));
          res.on('end', () => resolve({ status: res.statusCode, text }));
        },
      );
      req.on('error', reject);
      req.end(data ? JSON.stringify(data) : undefined);
    });
  return { send, calls, base };
}
test('private proxy forwards only typed requests to fixed upstream with server-held credentials', async (t) => {
  const { send, calls } = await fixture(t);
  const data = {
    model: 'jev-latest',
    state: { request: 'test' },
    questions: { q: { type: 'choice', instructions: 'yes?', criteria: { yes: 'yes', no: 'no' } } },
  };
  const result = await send('/api/jev/v1/systemone', { method: 'POST', data });
  assert.equal(result.status, 200);
  assert.equal(calls[0].url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(calls[0].o.headers.Authorization, 'Bearer server-private');
  assert(!result.text.includes('server-private'));
});
test('private proxy rejects foreign/null origins, rebinding hosts and wrong access tokens', async (t) => {
  const { send, calls } = await fixture(t);
  for (const headers of [
    { Origin: 'https://evil.test' },
    { Origin: 'null' },
    { Host: 'evil.test' },
    { 'X-Xamora-AI-Token': 'wrong' },
  ]) {
    const result = await send('/api/jev/v1/models', { headers });
    assert([401, 403].includes(result.status));
  }
  assert.equal(calls.length, 0);
});
test('private proxy has no arbitrary endpoint relay and enforces request/schema limits', async (t) => {
  const { send, calls } = await fixture(t);
  assert.equal((await send('/api/https://evil.test')).status, 404);
  assert.equal(
    (await send('/api/jev/v1/systemone', { method: 'POST', data: { bad: true } })).status,
    422,
  );
  const big = await send('/api/jev/v1/systemone', {
    method: 'POST',
    data: { state: 'x'.repeat(29000) },
  }).catch((e) => ({ status: 413 }));
  assert.equal(big.status, 413);
  assert.equal(calls.length, 0);
});
test('private proxy rate limits and static serving never expose repository files or env', async (t) => {
  const { send, calls } = await fixture(t, { maxRequestsPerMinute: 1 });
  assert.equal((await send('/api/jev/v1/models')).status, 200);
  assert.equal((await send('/api/jev/v1/models')).status, 429);
  assert.equal((await send('/.env')).status, 404);
  assert.equal((await send('/package.json')).status, 404);
  assert.equal(calls.length, 1);
});
