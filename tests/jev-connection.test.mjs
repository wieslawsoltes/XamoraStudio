import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import {
  aiJSON,
  JevClient,
  jevSettings,
  jevEndpoint,
  AITransportError,
} from '../dist/core/jev-client.js';
import { createAIServer, aiServerCLI } from '../scripts/serve-ai.mjs';
import { responseFor } from './jev-fixture.mjs';
const origin = 'https://wieslawsoltes.github.io';
const token = 'local-private-access-1234567890123456';
const payload = {
  model: 'jev-latest',
  state: 'A local fixture, not user context',
  questions: { q: { type: 'noul', instructions: 'Is this a test?' } },
};
async function fixture(t, options = {}) {
  const calls = [];
  const server = createAIServer({
    allowedOrigins: [origin],
    authToken: token,
    allowClientKeys: true,
    fetch: async (url, o) => {
      calls.push({ url, ...o });
      return Response.json(
        url.endsWith('/models')
          ? { models: [{ name: 'jev-latest' }] }
          : responseFor(JSON.parse(o.body)),
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
  const base = 'http://127.0.0.1:' + server.address().port;
  const send = (path, { method = 'GET', headers = {}, data } = {}) =>
    new Promise((resolve, reject) => {
      const req = request(
        base + path,
        { method, headers: { Origin: origin, ...headers } },
        (res) => {
          let text = '';
          res.on('data', (c) => (text += c));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
        },
      );
      req.on('error', reject);
      req.end(data ? JSON.stringify(data) : undefined);
    });
  return { server, base, calls, send };
}
const actualHeaders = {
  'X-Xamora-AI-Token': token,
  Authorization: 'Bearer client-fixture',
  'Content-Type': 'application/json',
};
const preflightHeaders = {
  'Access-Control-Request-Method': 'POST',
  'Access-Control-Request-Headers': 'authorization,content-type,x-xamora-ai-token',
};

test('copied Jev root/v1/operation URLs normalize without double API paths', () => {
  for (const suffix of ['', '/', '/v1', '/v1/', '/v1/models', '/v1/systemone/'])
    assert.equal(jevEndpoint('https://api.typesafe.ai' + suffix), 'https://api.typesafe.ai');
  assert.equal(
    jevSettings({ endpoint: '/api/jev/v1/models' }, origin).endpoint,
    origin + '/api/jev',
  );
  assert.equal(
    jevEndpoint('https://private.test/prefix/v1/systemone'),
    'https://private.test/prefix',
  );
  assert.throws(() => jevEndpoint('https://api.typesafe.ai?key=private'), /query/);
});

test('private bridge token is not leaked to the direct TypeSafe endpoint', async () => {
  const urls = [];
  const client = new JevClient({
    endpoint: 'https://api.typesafe.ai/v1/systemone',
    apiKey: 'client-key',
    proxyToken: token,
    fetch: async (url, o) => {
      urls.push(url);
      assert.equal(o.headers['X-Xamora-AI-Token'], undefined);
      assert.equal(o.headers.Authorization, 'Bearer client-key');
      return Response.json(
        url.endsWith('/models') ? { models: [{ name: 'jev-latest' }] } : responseFor(payload),
      );
    },
  });
  await client.models();
  await client.evaluate(payload.state, payload.questions);
  assert.deepEqual(urls, [
    'https://api.typesafe.ai/v1/models',
    'https://api.typesafe.ai/v1/systemone',
  ]);
});

test('transport reports direct and loopback failures without raw error credentials', async () => {
  for (const [url, pattern] of [
    ['https://api.typesafe.ai/v1/models', /private bridge/],
    ['http://127.0.0.1:8080/api/jev/v1/models', /Local Network Access/],
    ['https://private.test/v1/models', /exact network/],
  ]) {
    await assert.rejects(
      aiJSON(url, {
        apiKey: 'secret',
        fetch: async () => {
          throw new TypeError('bad secret');
        },
      }),
      (error) => {
        assert(error instanceof AITransportError);
        assert.equal(error.code, 'network');
        assert.match(error.message, pattern);
        assert(!JSON.stringify(error).includes('secret'));
        assert(!error.message.includes('secret'));
        return true;
      },
    );
  }
});

test('malformed credentials are diagnosed before fetch rather than reported as CORS', async () => {
  let calls = 0;
  for (const key of ['paste key here', 'key\nsecret', '密钥'])
    await assert.rejects(
      aiJSON('https://api.typesafe.ai/v1/models', {
        apiKey: key,
        fetch: async () => {
          calls++;
        },
      }),
      (e) => e.code === 'configuration',
    );
  assert.equal(calls, 0);
});

test('known bridge errors are actionable and not retried as provider overloads', async () => {
  let calls = 0;
  await assert.rejects(
    aiJSON('https://private.test/api/jev/v1/models', {
      retries: 3,
      fetch: async () => {
        calls++;
        return new Response('private secret', {
          status: 503,
          headers: { 'X-Xamora-AI-Error': 'proxy_not_configured' },
        });
      },
    }),
    (error) =>
      error.code === 'proxy_not_configured' &&
      /TYPESAFE_API_KEY/.test(error.message) &&
      !error.message.includes('private secret'),
  );
  assert.equal(calls, 1);
});

test('unknown proxy error strings cannot inject untrusted diagnostics', async () => {
  await assert.rejects(
    aiJSON('https://private.test/api/jev/v1/models', {
      fetch: async () =>
        new Response('secret', {
          status: 401,
          headers: { 'X-Xamora-AI-Error': '<script>secret</script>' },
        }),
    }),
    (error) => error.code === 'http' && error.status === 401 && !error.message.includes('secret'),
  );
});

test('an HTML static fallback is identified as a missing JSON API', async () => {
  await assert.rejects(
    aiJSON(origin + '/api/jev/v1/models', { fetch: async () => new Response('<html>site</html>') }),
    (error) => error.code === 'invalid_response' && /static site/.test(error.message),
  );
});

test('cross-origin OPTIONS grants only exact origin, requested route/method/headers with no provider call', async (t) => {
  const { send, calls } = await fixture(t);
  const result = await send('/api/jev/v1/systemone', {
    method: 'OPTIONS',
    headers: { ...preflightHeaders, 'Access-Control-Request-Private-Network': 'true' },
  });
  assert.equal(result.status, 204);
  assert.equal(result.text, '');
  assert.equal(result.headers['access-control-allow-origin'], origin);
  assert.equal(result.headers['access-control-allow-methods'], 'POST');
  assert.equal(result.headers['access-control-allow-private-network'], 'true');
  assert.equal(result.headers['access-control-allow-credentials'], undefined);
  assert.match(result.headers.vary, /Origin/);
  assert.equal(calls.length, 0);
});

test('allowed preflight never bypasses actual bridge authentication', async (t) => {
  const { send, calls } = await fixture(t);
  for (const headers of [
    { Authorization: 'Bearer provider-key' },
    { 'X-Xamora-AI-Token': 'wrong', Authorization: 'Bearer provider-key' },
  ]) {
    const result = await send('/api/jev/v1/models', { headers });
    assert.equal(result.status, 401);
    assert.equal(result.headers['access-control-allow-origin'], origin);
    assert.equal(result.headers['x-xamora-ai-error'], 'proxy_token_required');
  }
  assert.equal(calls.length, 0);
});

test('foreign, null and prefix-matching origins and rebinding hosts remain denied', async (t) => {
  const { send, calls } = await fixture(t);
  for (const headers of [
    { Origin: 'https://evil.test' },
    { Origin: 'null' },
    { Origin: origin + '.evil.test' },
    { Host: 'evil.test' },
    { Origin: origin + '/XamoraStudio/' },
  ]) {
    const result = await send('/api/jev/v1/systemone', {
      method: 'OPTIONS',
      headers: { ...preflightHeaders, ...headers },
    });
    assert.equal(result.status, 403);
    assert.equal(result.headers['access-control-allow-origin'], undefined);
  }
  assert.equal(calls.length, 0);
});

test('preflights cannot enable arbitrary methods, headers or relay destinations', async (t) => {
  const { send, calls } = await fixture(t);
  for (const headers of [
    { 'Access-Control-Request-Method': 'DELETE' },
    { 'Access-Control-Request-Headers': 'x-arbitrary-target' },
  ])
    assert.equal(
      (
        await send('/api/jev/v1/systemone', {
          method: 'OPTIONS',
          headers: { ...preflightHeaders, ...headers },
        })
      ).status,
      403,
    );
  assert.equal(
    (await send('/api/evil', { method: 'OPTIONS', headers: preflightHeaders })).status,
    404,
  );
  assert.equal(calls.length, 0);
});

test('cross-origin bridge forwards authorized browser key only to fixed TypeSafe host', async (t) => {
  const { send, calls } = await fixture(t);
  const result = await send('/api/jev/v1/systemone', {
    method: 'POST',
    headers: actualHeaders,
    data: payload,
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers['access-control-allow-origin'], origin);
  assert.equal(calls[0].url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(calls[0].headers.Authorization, 'Bearer client-fixture');
  assert.equal(calls[0].headers['X-Xamora-AI-Token'], undefined);
  assert.equal(calls[0].headers.Origin, undefined);
  assert(!result.text.includes(token));
  assert(!result.text.includes('client-fixture'));
  assert.deepEqual(JSON.parse(calls[0].body), payload);
});

test('server-held key wins and client-key opt-in does not change the default private mode', async (t) => {
  const serverHeld = await fixture(t, { apiKey: 'server-fixture' });
  assert.equal(
    (await serverHeld.send('/api/jev/v1/models', { headers: actualHeaders })).status,
    200,
  );
  assert.equal(serverHeld.calls[0].headers.Authorization, 'Bearer server-fixture');
  const noClient = await fixture(t, { allowClientKeys: false });
  const result = await noClient.send('/api/jev/v1/models', { headers: actualHeaders });
  assert.equal(result.status, 503);
  assert.equal(result.headers['x-xamora-ai-error'], 'proxy_not_configured');
  assert.equal(noClient.calls.length, 0);
});

test('protected health is local-only metadata, no provider calls or key disclosure', async (t) => {
  const { send, calls } = await fixture(t, { apiKey: 'server-fixture' });
  assert.equal((await send('/api/jev/health')).status, 401);
  const result = await send('/api/jev/health', { headers: actualHeaders });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.text), {
    service: 'xamora-ai-proxy',
    version: 1,
    serverKeyConfigured: true,
    clientKeysAllowed: true,
    generatorConfigured: false,
  });
  assert.equal(calls.length, 0);
  assert(!result.text.includes('server-fixture'));
});

test('upstream network failures and missing generator produce CORS-readable diagnostics', async (t) => {
  const { send } = await fixture(t, {
    fetch: async () => {
      throw new TypeError('secret from upstream');
    },
  });
  const result = await send('/api/jev/v1/models', { headers: actualHeaders });
  assert.equal(result.status, 502);
  assert.equal(result.headers['x-xamora-ai-error'], 'upstream_network');
  assert.equal(result.headers['access-control-allow-origin'], origin);
  assert(!result.text.includes('secret'));
  const generator = await send('/api/generate', {
    method: 'POST',
    headers: actualHeaders,
    data: {},
  });
  assert.equal(generator.status, 503);
  assert.equal(generator.headers['x-xamora-ai-error'], 'generator_not_configured');
});

test('cross-origin mode retains whole request validation and limits', async (t) => {
  const { send, calls } = await fixture(t, { maxRequestsPerMinute: 1 });
  const invalid = await send('/api/jev/v1/systemone', {
    method: 'POST',
    headers: actualHeaders,
    data: { bad: true },
  });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.headers['access-control-allow-origin'], origin);
  const limited = await send('/api/jev/v1/models', { headers: actualHeaders });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['x-xamora-ai-error'], 'proxy_limit');
  assert.equal(calls.length, 0);
});

test('exact origin and strong token are required when enabling cross-origin/client-key mode', () => {
  for (const options of [
    { allowedOrigins: ['*'], authToken: token },
    { allowedOrigins: ['null'], authToken: token },
    { allowedOrigins: [origin + '/'], authToken: token },
    { allowedOrigins: [origin] },
    { allowedOrigins: [origin], authToken: 'short' },
    { allowClientKeys: true },
  ])
    assert.throws(() => createAIServer(options));
});

test('CLI bridge mode generates a fresh token without provider secrets and preserves explicit config', () => {
  const args = ['--allow-origin=' + origin, '--allow-client-keys'];
  const first = aiServerCLI(args, {}),
    second = aiServerCLI(args, {});
  assert.equal(first.authToken.length, 64);
  assert.notEqual(first.authToken, second.authToken);
  assert.equal(first.apiKey, '');
  assert.equal(first.allowClientKeys, true);
  assert.deepEqual(first.allowedOrigins, [origin]);
  assert.equal(aiServerCLI([], { XAMORA_AI_TOKEN: token }).authToken, token);
  assert.equal(aiServerCLI([], {}).authToken, '');
  assert.throws(() => aiServerCLI(['--bad'], {}), /Unknown/);
  assert.throws(() => aiServerCLI([], { PORT: '-1' }), /PORT/);
});
