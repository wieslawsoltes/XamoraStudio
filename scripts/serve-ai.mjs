/** Private AI bridge + static Studio. Cross-origin use is explicit, exact-origin and token protected. */
import { createServer } from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, randomBytes } from 'node:crypto';
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
const send = (res, status, data, code) => {
  if (code) res.setHeader('X-Xamora-AI-Error', code);
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
  root = fileURLToPath(new URL('../dist/', import.meta.url)),
  apiKey = '',
  authToken = '',
  origin,
  allowedOrigins = [],
  allowClientKeys = false,
  generatorEndpoint = '',
  generatorKey = '',
  generatorModel = '',
  fetch = globalThis.fetch,
  maxRequestsPerMinute = 60,
  maxConcurrent = 4,
} = {}) {
  const exactOrigin = (value) => {
    const url = new URL(aiEndpoint(value));
    if (url.origin !== value)
      throw Error(
        'Proxy origins must be exact HTTPS or loopback origins without paths or wildcards.',
      );
    return value;
  };
  if (origin) exactOrigin(origin);
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length > 16)
    throw Error('Use an array of at most 16 exact allowed origins.');
  const origins = new Set(allowedOrigins.map(exactOrigin));
  if (typeof allowClientKeys !== 'boolean') throw Error('Invalid client-key policy.');
  if ((origins.size || allowClientKeys) && !/^[\x21-\x7e]{24,4096}$/.test(authToken))
    throw Error(
      'Cross-origin/client-key mode requires a private access token of at least 24 printable ASCII characters.',
    );
  if (
    ![apiKey, authToken, generatorKey].every(
      (key) => typeof key === 'string' && key.length <= 4096 && !/[\x00-\x20\x7f-\uffff]/.test(key),
    )
  )
    throw Error('Invalid server credential.');
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
      const requestOrigin = req.headers.origin;
      const sameOrigin =
        requestOrigin === expected ||
        (!requestOrigin && req.headers['sec-fetch-site'] === 'same-origin');
      const allowed = sameOrigin || origins.has(requestOrigin);
      if (!allowed) return send(res, 403, { error: 'Studio origin is not allowed' });
      // Origin is checked before adding CORS headers, parsing data or making any upstream call.
      // Preflight carries no token; the subsequent real request MUST authenticate.
      res.setHeader(
        'Vary',
        'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
      );
      if (requestOrigin) res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Access-Control-Expose-Headers', 'X-Xamora-AI-Error, Retry-After');
      const method = {
        '/api/jev/v1/models': 'GET',
        '/api/jev/v1/systemone': 'POST',
        '/api/jev/health': 'GET',
        '/api/generate': 'POST',
      }[path];
      if (!method) return send(res, 404, { error: 'Unknown API route' });
      if (req.method === 'OPTIONS') {
        const requested = String(req.headers['access-control-request-headers'] || '')
          .split(',')
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean);
        if (
          !requestOrigin ||
          req.headers['access-control-request-method'] !== method ||
          requested.some(
            (x) => !['authorization', 'content-type', 'x-xamora-ai-token', 'accept'].includes(x),
          )
        )
          return send(res, 403, { error: 'Preflight method or headers rejected' });
        res.setHeader('Access-Control-Allow-Methods', method);
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Authorization, Content-Type, X-Xamora-AI-Token, Accept',
        );
        res.setHeader('Access-Control-Max-Age', '300');
        if (req.headers['access-control-request-private-network'] === 'true')
          res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.writeHead(204).end();
        return;
      }
      if (authToken && !equal(req.headers['x-xamora-ai-token'], authToken))
        return send(res, 401, { error: 'Private proxy token required' }, 'proxy_token_required');
      if (req.method !== method) return send(res, 405, { error: 'Method not allowed' });
      if (path === '/api/jev/health')
        return send(res, 200, {
          service: 'xamora-ai-proxy',
          version: 1,
          serverKeyConfigured: !!apiKey,
          clientKeysAllowed: allowClientKeys,
          generatorConfigured: !!(generatorEndpoint && generatorKey && generatorModel),
        });
      const models = path === '/api/jev/v1/models';
      const evaluate = path === '/api/jev/v1/systemone';
      const generate = path === '/api/generate';
      // Never accept arbitrary URLs, and never forward the bridge token to a provider.
      // Server-held keys take precedence. Browser keys are a separately opted-in private mode.
      const clientKey =
        allowClientKeys && /^Bearer [\x21-\x7e]{1,4096}$/.test(req.headers.authorization || '')
          ? req.headers.authorization.slice(7)
          : '';
      const typeSafeKey = apiKey || clientKey;
      if (!generate && !typeSafeKey)
        return send(res, 503, { error: 'TypeSafe key is not configured' }, 'proxy_not_configured');
      if (generate && (!generatorEndpoint || !generatorKey || !generatorModel))
        return send(
          res,
          503,
          { error: 'Generator is not configured on the server' },
          'generator_not_configured',
        );
      if (Date.now() - minute >= 60000) {
        minute = Date.now();
        count = 0;
      }
      if (active >= maxConcurrent || count >= maxRequestsPerMinute)
        return send(res, 429, { error: 'Private proxy request limit reached' }, 'proxy_limit');
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
            apiKey: generate ? generatorKey : typeSafeKey,
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
        const code =
          error.code === 'network'
            ? 'upstream_network'
            : error.code === 'timeout'
              ? 'upstream_timeout'
              : !error.status && !match
                ? 'upstream_invalid_response'
                : undefined;
        send(
          res,
          error.status || (match ? Number(match[1]) : 502),
          {
            error:
              'AI proxy request failed; check configuration, limits and provider availability.',
          },
          code,
        );
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
/** CLI parsing is separate so allowlist/credential behavior can be regression tested. */
export function aiServerCLI(args = [], env = process.env) {
  const allowedOrigins = (env.XAMORA_AI_ALLOWED_ORIGINS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  let allowClientKeys = env.XAMORA_AI_ALLOW_CLIENT_KEYS === '1';
  for (const arg of args) {
    if (arg.startsWith('--allow-origin=')) allowedOrigins.push(arg.slice('--allow-origin='.length));
    else if (arg === '--allow-client-keys') allowClientKeys = true;
    else
      throw Error(
        'Unknown bridge option. Use --allow-origin=https://your-studio-origin and optionally --allow-client-keys.',
      );
  }
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid PORT');
  const authToken =
    env.XAMORA_AI_TOKEN ||
    (allowedOrigins.length || allowClientKeys ? randomBytes(32).toString('hex') : '');
  return {
    port,
    allowedOrigins,
    allowClientKeys,
    authToken,
    apiKey: env.TYPESAFE_API_KEY || '',
    generatorEndpoint: env.XAMORA_GENERATOR_ENDPOINT || '',
    generatorKey: env.XAMORA_GENERATOR_KEY || '',
    generatorModel: env.XAMORA_GENERATOR_MODEL || '',
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = aiServerCLI(process.argv.slice(2));
  const server = createAIServer(config);
  server.on('error', (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? 'Bridge port is in use. Set PORT to an available port and use it in Jev settings.'
        : 'Could not start the private AI bridge. Check its local configuration.',
    );
    process.exitCode = 1;
  });
  server.listen(config.port, '127.0.0.1', () => {
    console.log(
      `Studio and private AI bridge: http://127.0.0.1:${config.port}\nJev API base URL: http://127.0.0.1:${config.port}/api/jev`,
    );
    if (config.allowedOrigins.length)
      console.log(
        'Allowed browser origins: ' +
          config.allowedOrigins.join(', ') +
          '\nKeep your existing Studio tab open; its workspace does not need to move.',
      );
    if (config.authToken)
      console.log(
        'Private proxy access token (paste only into your trusted Studio settings): ' +
          config.authToken,
      );
    console.log(
      config.apiKey
        ? 'TypeSafe key: configured on server.'
        : config.allowClientKeys
          ? 'TypeSafe key: enter your own key in Studio settings. It is forwarded only to api.typesafe.ai and is not persisted by the bridge.'
          : 'Set TYPESAFE_API_KEY in the server environment before calling Jev.',
    );
    console.log(
      'Keep this process running. Allow Local Network Access if your browser requests it. Never publish this token or disable browser security.',
    );
  });
}
