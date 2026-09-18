/** TypeSafe System One transport. No chat emulation, ambient credentials, or project storage. */
export const JEV_DEFAULTS = Object.freeze({
  endpoint: 'https://api.typesafe.ai',
  model: 'jev-latest',
  timeoutMs: 30000,
  retries: 2,
  maxRequestBytes: 20000,
  maxSteps: 4,
  minConfidence: 0.65,
  minProbability: 0.7,
  includeSource: true,
  includeOtherDocuments: false,
  generatorEndpoint: '',
  generatorModel: '',
  generatorMaxTokens: 4096,
  generatorTokenParameter: 'max_tokens',
  generatorEnabled: false,
});
const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
export const jsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
export function aiEndpoint(value, origin = globalThis.location?.origin) {
  const text = String(value || '').trim();
  if (!text) throw Error('An API endpoint is required.');
  let url;
  try {
    url = new URL(text, origin && origin !== 'null' ? origin : undefined);
  } catch {
    throw Error('Enter a valid HTTPS or same-origin endpoint.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && (local || url.origin === origin))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error(
      'Use HTTPS, a same-origin proxy, or a loopback HTTP endpoint without credentials or query parameters.',
    );
  return url.href.replace(/\/+$/, '');
}
export function jevSettings(input = {}, origin) {
  const out = {};
  for (const key of Object.keys(JEV_DEFAULTS)) out[key] = input[key] ?? JEV_DEFAULTS[key];
  out.endpoint = aiEndpoint(out.endpoint, origin);
  if (out.generatorEndpoint) out.generatorEndpoint = aiEndpoint(out.generatorEndpoint, origin);
  for (const key of ['model', 'generatorModel'])
    if (typeof out[key] !== 'string' || out[key].length > 160 || /[\x00-\x1f]/.test(out[key]))
      throw Error('Invalid model identifier.');
  if (!out.model.trim()) throw Error('A Jev model is required.');
  if (!['max_tokens', 'max_completion_tokens'].includes(out.generatorTokenParameter))
    throw Error('Choose max_tokens or max_completion_tokens for the generator.');
  for (const [key, low, high] of [
    ['timeoutMs', 1000, 120000],
    ['retries', 0, 3],
    ['maxRequestBytes', 4096, 28000],
    ['maxSteps', 1, 8],
    ['generatorMaxTokens', 256, 16000],
  ])
    if (!integer(out[key], low, high))
      throw Error(`${key} must be an integer between ${low} and ${high}.`);
  for (const key of ['minConfidence', 'minProbability'])
    if (!Number.isFinite(out[key]) || out[key] < 0.5 || out[key] > 1)
      throw Error(`${key} must be between 0.5 and 1.`);
  for (const key of ['includeSource', 'includeOtherDocuments', 'generatorEnabled'])
    if (typeof out[key] !== 'boolean') throw Error(`Invalid ${key}.`);
  return out;
}
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const probability = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
export function validateJevRequest(request, maxBytes = 28000) {
  if (
    !plain(request) ||
    typeof request.model !== 'string' ||
    !request.model.trim() ||
    request.model.length > 160 ||
    !plain(request.questions) ||
    !(typeof request.state === 'string' || plain(request.state) || Array.isArray(request.state))
  )
    throw Error('Jev requires a model, state, and typed questions.');
  const questions = Object.values(request.questions);
  if (!questions.length || questions.length > 64) throw Error('Use between 1 and 64 questions.');
  for (const q of questions) {
    if (
      !plain(q) ||
      !['choice', 'noul', 'score'].includes(q.type) ||
      !(typeof q.instructions === 'string'
        ? q.instructions.trim()
        : plain(q.instructions) || Array.isArray(q.instructions))
    )
      throw Error('Invalid Jev question.');
    if (
      q.type === 'noul' &&
      q.criteria !== undefined &&
      (!plain(q.criteria) ||
        Object.entries(q.criteria).some(
          ([key, value]) => !['true', 'false'].includes(key) || typeof value !== 'string',
        ))
    )
      throw Error('Invalid Noul criteria.');
    if (
      q.type === 'choice' &&
      (!plain(q.criteria) ||
        Object.keys(q.criteria).length < 2 ||
        Object.keys(q.criteria).length > 255 ||
        Object.values(q.criteria).some((v) => v !== null && typeof v !== 'string'))
    )
      throw Error('A Choice requires 2–255 candidates.');
    if (
      q.type === 'score' &&
      (!Array.isArray(q.criteria) ||
        q.criteria.length < 2 ||
        q.criteria.length > 255 ||
        q.criteria.some((v) => typeof v !== 'string'))
    )
      throw Error('A Score requires 2–255 ordered criteria.');
  }
  const bytes = jsonBytes(request);
  if (bytes > maxBytes)
    throw Error(
      `The request needs ${bytes} bytes; the configured budget is ${maxBytes}. Narrow the scope or increase the budget.`,
    );
  return bytes;
}
export function validateJevResponse(data, request) {
  if (!plain(data) || typeof data.model !== 'string' || !plain(data.answers))
    throw Error('Malformed Jev response.');
  if (Object.keys(data.answers).length !== Object.keys(request.questions).length)
    throw Error('Unexpected Jev answer set.');
  for (const [id, question] of Object.entries(request.questions)) {
    const answer = data.answers[id];
    if (!plain(answer) || answer.type !== question.type)
      throw Error(`Missing or mistyped Jev answer: ${id}.`);
    if (question.type === 'noul') {
      if (!probability(answer.noul)) throw Error('Invalid Noul probability.');
    } else {
      const keys =
        question.type === 'choice'
          ? Object.keys(question.criteria)
          : question.criteria.map((_, i) => String(i));
      if (
        !probability(answer.confidence) ||
        !plain(answer.probabilities) ||
        Object.keys(answer.probabilities).length !== keys.length ||
        keys.some(
          (key) =>
            !Object.hasOwn(answer.probabilities, key) || !probability(answer.probabilities[key]),
        ) ||
        Math.abs(Object.values(answer.probabilities).reduce((a, b) => a + b, 0) - 1) > 0.015
      )
        throw Error('Invalid Jev probability distribution.');
      if (
        question.type === 'choice' &&
        (!keys.includes(answer.choice) ||
          answer.probabilities[answer.choice] + 0.00001 <
            Math.max(...Object.values(answer.probabilities)))
      )
        throw Error(
          'Jev returned a choice outside the supplied candidates or inconsistent probabilities.',
        );
      if (
        question.type === 'score' &&
        (!Number.isFinite(answer.score) || answer.score < 0 || answer.score > keys.length - 1)
      )
        throw Error('Invalid Jev score.');
      if (
        question.type === 'score' &&
        (!plain(answer.legend) ||
          keys.some((key) => answer.legend[key] !== question.criteria[Number(key)]))
      )
        throw Error('Invalid Jev score legend.');
    }
  }
  if (
    !data.usage ||
    !integer(data.usage.input_tokens, 0, 1e9) ||
    !integer(data.usage.output_tokens, 0, 1e9)
  )
    throw Error('Invalid Jev usage counts.');
  return data;
}
const abortError = () => new DOMException('The AI request was canceled.', 'AbortError');
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const abort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
/** Strict bounded HTTP helper shared with the optional, explicitly configured text generator. */
export async function aiJSON(
  url,
  {
    apiKey = '',
    proxyToken = '',
    body,
    timeoutMs = 30000,
    retries = 0,
    signal,
    fetch: request = globalThis.fetch,
    maxResponseBytes = 262144,
  } = {},
) {
  if (typeof request !== 'function') throw Error('This environment has no fetch transport.');
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) throw abortError();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const deadline = Date.now() + timeoutMs;
    for (let attempt = 0; ; attempt++) {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
      if (proxyToken) headers['X-Xamora-AI-Token'] = proxyToken;
      const response = await request(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      });
      if ([429, 503, 529].includes(response.status) && attempt < retries) {
        const retry = response.headers?.get('Retry-After');
        const seconds = Number(retry);
        const retryMs =
          retry && !Number.isNaN(seconds)
            ? seconds * 1000
            : retry
              ? Date.parse(retry) - Date.now()
              : 500 * 2 ** attempt;
        await response.body?.cancel?.();
        const waitMs = Math.max(100, Number.isFinite(retryMs) ? retryMs : 500);
        if (waitMs >= deadline - Date.now())
          throw Error(
            'Provider Retry-After exceeds the remaining request timeout. Try again later.',
          );
        await delay(waitMs, controller.signal);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel?.();
        const description =
          {
            401: 'Invalid or missing API key',
            403: 'Access or proxy origin rejected',
            404: 'Endpoint not found; check proxy configuration',
            402: 'Account credit or billing limit',
            413: 'Request too large',
            422: 'Request rejected by the provider',
            429: 'Rate limit reached',
            529: 'TypeSafe is overloaded',
          }[response.status] || 'Provider request failed';
        throw Error(`${description} (HTTP ${response.status}).`);
      }
      let text = '';
      if (response.body?.getReader) {
        const reader = response.body.getReader(),
          decoder = new TextDecoder();
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxResponseBytes) {
              await reader.cancel();
              throw Error('AI response exceeds the size limit.');
            }
            text += decoder.decode(value, { stream: true });
          }
          text += decoder.decode();
        } finally {
          reader.releaseLock();
        }
      } else {
        text = await response.text();
        if (new TextEncoder().encode(text).length > maxResponseBytes)
          throw Error('AI response exceeds the size limit.');
      }
      if (controller.signal.aborted) throw abortError();
      try {
        return JSON.parse(text);
      } catch {
        throw Error('The provider did not return valid JSON.');
      }
    }
  } catch (error) {
    if (timedOut) throw Error('AI request timed out. No proposed changes were applied.');
    if (controller.signal.aborted) throw abortError();
    if (error instanceof TypeError)
      throw Error('Could not reach the AI endpoint. Check the network, CORS and proxy settings.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
export class JevClient {
  constructor(options = {}, transport = {}) {
    options = { ...options, ...transport };
    this.settings = jevSettings(options, options.origin);
    this.credentials = { apiKey: options.apiKey || '', proxyToken: options.proxyToken || '' };
    this.fetch = options.fetch;
  }
  async evaluate(state, questions, { signal } = {}) {
    const request = { model: this.settings.model, state, questions };
    validateJevRequest(request, this.settings.maxRequestBytes);
    const data = await aiJSON(this.settings.endpoint + '/v1/systemone', {
      ...this.settings,
      ...this.credentials,
      fetch: this.fetch,
      signal,
      body: request,
    });
    return validateJevResponse(data, request);
  }
  async models({ signal } = {}) {
    const data = await aiJSON(this.settings.endpoint + '/v1/models', {
      ...this.settings,
      ...this.credentials,
      fetch: this.fetch,
      signal,
    });
    if (!Array.isArray(data.models) || data.models.some((m) => typeof m.name !== 'string'))
      throw Error('The endpoint did not return a TypeSafe model list.');
    return data.models;
  }
}
