/** Private loopback AI proxy + static Studio. No arbitrary upstream URLs or ambient provider keys in responses. */
import { createServer } from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import {
  aiJSON,
  aiEndpoint,
  validateJevRequest,
  validateJevResponse,
} from '../dist/core/jev-client.js';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
};
const send = (res, status, data) => {
  if (!res.destroyed)
    res
      .writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(JSON.stringify(data));
};
function equal(a, b) {
  const x = Buffer.from(a || ''),
    y = Buffer.from(b || '');
  return x.length === y.length && timingSafeEqual(x, y);
}
async function body(req, limit) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))
    throw Object.assign(Error('JSON required'), { status: 415 });
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(Error('Invalid JSON'), { status: 400 });
  }
}
export function createAIServer({
  root = resolve('dist'),
  apiKey = '',
  authToken = '',
  origin,
  generatorEndpoint = '',
  generatorKey = '',
  generatorModel = '',
  fetch = globalThis.fetch,
  maxRequestsPerMinute = 60,
  maxConcurrent = 4,
} = {}) {
  if (origin && new URL(origin).origin !== origin)
    throw Error('Proxy origin must be an exact origin without a path.');
  if (generatorEndpoint) generatorEndpoint = aiEndpoint(generatorEndpoint);
  let active = 0,
    minute = Date.now(),
    count = 0;
  return createServer(async (req, res) => {
    const address = req.socket.localPort;
    const trusted = origin || `http://127.0.0.1:${address}`;
    const hosts = origin
      ? [new URL(origin).host]
      : [`127.0.0.1:${address}`, `localhost:${address}`];
    if (!hosts.includes(req.headers.host)) return send(res, 403, { error: 'Host rejected' });
    let path;
    try {
      path = decodeURIComponent(new URL(req.url, trusted).pathname);
    } catch {
      return send(res, 400, { error: 'Invalid path' });
    }
    if (path.startsWith('/api/')) {
      const expected = origin || `http://${req.headers.host}`;
      if (
        (req.headers.origin && req.headers.origin !== expected) ||
        (!req.headers.origin && req.headers['sec-fetch-site'] !== 'same-origin')
      )
        return send(res, 403, { error: 'Same-origin browser requests required' });
      if (authToken && !equal(req.headers['x-xamora-ai-token'], authToken))
        return send(res, 401, { error: 'Private proxy token required' });
      const models = path === '/api/jev/v1/models' && req.method === 'GET';
      const evaluate = path === '/api/jev/v1/systemone' && req.method === 'POST';
      const generate = path === '/api/generate' && req.method === 'POST';
      if (!models && !evaluate && !generate) return send(res, 404, { error: 'Unknown API route' });
      if (!generate && !apiKey)
        return send(res, 503, { error: 'TypeSafe key is not configured on the server' });
      if (generate && (!generatorEndpoint || !generatorKey || !generatorModel))
        return send(res, 503, { error: 'Generator is not configured on the server' });
      if (Date.now() - minute >= 60000) {
        minute = Date.now();
        count = 0;
      }
      if (active >= maxConcurrent || count >= maxRequestsPerMinute)
        return send(res, 429, { error: 'Private proxy request limit reached' });
      active++;
      count++;
      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) controller.abort();
      });
      try {
        const payload = models ? undefined : await body(req, 28000);
        if (evaluate) {
          try {
            validateJevRequest(payload, 28000);
          } catch {
            return send(res, 422, { error: 'Invalid typed Jev request' });
          }
        }
        const generatorLimit = payload?.max_tokens ?? payload?.max_completion_tokens;
        if (
          generate &&
          (payload?.model !== generatorModel ||
            payload.stream !== false ||
            !Number.isInteger(generatorLimit) ||
            generatorLimit < 1 ||
            generatorLimit > 16000 ||
            (payload.max_tokens !== undefined && payload.max_completion_tokens !== undefined) ||
            !Array.isArray(payload.messages) ||
            payload.messages.length !== 2 ||
            payload.messages.some(
              (m) => !['user', 'system'].includes(m.role) || typeof m.content !== 'string',
            ))
        )
          return send(res, 422, { error: 'Invalid generator request or model' });
        const result = await aiJSON(
          generate
            ? generatorEndpoint
            : 'https://api.typesafe.ai/v1/' + (models ? 'models' : 'systemone'),
          {
            apiKey: generate ? generatorKey : apiKey,
            body: payload,
            fetch,
            signal: controller.signal,
            timeoutMs: 60000,
            retries: 0,
          },
        );
        if (evaluate) validateJevResponse(result, payload);
        if (
          models &&
          (!Array.isArray(result.models) || result.models.some((m) => typeof m.name !== 'string'))
        )
          throw Error('Invalid model listing');
        // Only expected provider data; never echo request headers, environment or upstream errors.
        send(res, 200, result);
      } catch (error) {
        const match = /HTTP (401|402|403|404|413|422|429|503|529)/.exec(error.message || '');
        send(res, error.status || (match ? Number(match[1]) : 502), {
          error: 'AI proxy request failed; check configuration, limits and provider availability.',
        });
      } finally {
        active--;
      }
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method))
      return send(res, 405, { error: 'Method not allowed' });
    try {
      const base = await realpath(root);
      let file = resolve(base, '.' + path);
      if (file !== base && !file.startsWith(base + sep))
        return send(res, 403, { error: 'Outside application root' });
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      file = await realpath(file);
      if (!file.startsWith(base + sep))
        return send(res, 403, { error: 'Outside application root' });
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': mime[extname(file)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
        'Referrer-Policy': 'no-referrer',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      send(res, 404, { error: 'Not found' });
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid PORT');
  createAIServer({
    apiKey: process.env.TYPESAFE_API_KEY,
    authToken: process.env.XAMORA_AI_TOKEN,
    generatorEndpoint: process.env.XAMORA_GENERATOR_ENDPOINT,
    generatorKey: process.env.XAMORA_GENERATOR_KEY,
    generatorModel: process.env.XAMORA_GENERATOR_MODEL,
  }).listen(port, '127.0.0.1', () => {
    console.log(
      `Studio and private AI proxy: http://127.0.0.1:${port}\nJev settings base: /api/jev; generator URL: /api/generate. Provider keys stay server-side.`,
    );
  });
}
