# Jev assistant: design and app control

Xamora integrates TypeSafe's **System One HTTP API**, not an imitation chat endpoint. Jev evaluates state with typed Choice, Noul and Score questions. It cannot generate arbitrary strings or code. The native assistant therefore selects operations, authored targets and pre-parsed literal values; ordinary code edits the existing AST or dispatches an allowed application command. Bespoke XAML/HTML is available through a **separately configured, opt-in text generator**, followed by Jev verification and the same review/validation gates. A TypeSafe key alone does not enable unconstrained code generation.

## Open the assistant

Use **Ask Jev · selection** above the design canvas, **Ask Jev** above the XAML/HTML source editor, or **Jev · app** in the top bar. The **Jev AI** submenu and command search expose all three scopes and settings. The assistant is a normal dockable tool: it can be moved, tabbed, auto-hidden or placed in a dependent browser window. It shares the owner Studio's document session and settings; opening a popup does not duplicate an AI conversation or editor.

1. Open **Settings**, configure a TypeSafe key or private proxy, and use **Test connection / list models**. This sends no document context.
2. Choose **Selected elements**, **Current document**, or **Entire app**. Enter a prompt and select **Preview context** to inspect the exact first native request without making a network request.
3. Choose **Run** or press **Ctrl/Command+Enter**. Without prior checkbox approval, an **Allow Jev to use this context?** dialog shows the destination, scope, first-request size and expandable outbound payload. Choose **Allow and run** to approve this run only, or Cancel/Escape/close to send nothing. Alternatively, explicitly check **Allow sending this prompt…** for the current prompt and context before Run. This can incur provider charges. Each subsequent request is displayed as it is prepared; later questions depend on earlier decisions.
4. Review the operations, before/after source, confidence, selected probability, model and usage. **Apply reviewed proposal** is a separate action. **Discard** leaves the document untouched. **Cancel** aborts the current request and prevents a late answer becoming a proposal.

The unchecked checkbox is a privacy gate, not an API failure. Run now offers the approval dialog instead of the old “Review the endpoint/scope and allow sending context before running” error. Checking the box does not send a request. Its permission is invalidated when the prompt, scope, source, selection, document or configuration changes. Dialog approval is never remembered for another run; a stale dialog cannot approve edited context or a changed endpoint. The main Studio owns the dialog even when the assistant is detached, and cancellation returns focus to the prompt. The programmatic `run` API remains consent-guarded and does not silently send or approve context.

Examples for native mode: `Set the selected button background to "#2563EB"`; `Set Width to "240"`; `Change the text to "Continue"`; `Add a TextBlock inside the selected Grid`; `Duplicate the button` in document scope; `Create a blue HTML login starter`; `Show the property inspector`; `Switch the app to dark theme`. Quote exact replacement strings. Jev chooses from supplied values; the app does not pretend that it invented an arbitrary new string.

Bespoke mode examples: `Generate a bespoke XAML settings page with a two-column form`; `Redesign this selected HTML section as a responsive pricing card`; `Repair the current invalid XAML source draft`. Enable and configure the separate generator first. Invalid-draft repair requires current-document scope, complete source sharing, and no locked elements. Repair is staged; Apply creates one source-history entry and Undo restores the original invalid draft verbatim.

## GitHub Pages: connect without moving your workspace

**A CORS error is not necessarily a bad API key.** On 18 September 2026, an unauthenticated OPTIONS preflight from `https://wieslawsoltes.github.io` to both TypeSafe `/v1/systemone` and `/v1/models` returned HTTP 400 without `Access-Control-Allow-Origin`. The [credential-free diagnostic run](https://github.com/wieslawsoltes/XamoraStudio/actions/runs/35399728829) records the response headers. Browsers cannot read the API response when the provider does not allow the Studio origin. A static GitHub Pages deployment cannot host a Node API, and changing frontend headers or using `no-cors` cannot make the protected JSON response readable.

Use the included **private local bridge** to keep using the published Studio tab and its existing browser-local workspace. From an up-to-date repository checkout with Node 22 or later:

```sh
git pull
npm run start:ai:pages
```

The bridge uses Node built-ins; this command does not require an AI SDK or an npm install. It binds only `127.0.0.1`, explicitly permits `https://wieslawsoltes.github.io`, and prints a freshly generated **Private proxy access token**. Keep that terminal running. In the existing Studio tab:

1. Open **Jev → Settings** (or **Connection setup…** below a failed request) and choose **Use local bridge**. The default Jev base URL is `http://127.0.0.1:8080/api/jev`.
2. Paste the printed token into **Private proxy access token**. Re-enter your own TypeSafe API key, or leave it empty when the bridge process has `TYPESAFE_API_KEY` set. The preset intentionally clears inherited credentials instead of silently forwarding them to a new destination.
3. Check the destination confirmation, choose **Test connection / list models**, then **Save settings**. If the browser asks for **Local Network Access**, approve it for this trusted Studio tab. Run still asks for context approval, and Apply still requires review.

**Do not clear site data or move your documents to a localhost Studio tab.** The bridge works from the existing Pages tab; a localhost tab would have a different browser-storage origin. Keep the token private and paste it only into your trusted Studio. The script's client-key mode forwards a supplied TypeSafe key only to the fixed `api.typesafe.ai` upstream, without persisting or logging it. A configured server key takes precedence. No token, provider credential or inference is sent during a CORS preflight.

Stopping the process disconnects the bridge. Restarting generates a new token unless `XAMORA_AI_TOKEN` supplies a fixed one (at least 24 printable, non-space ASCII characters). Set `PORT` to use another port and update the UI URL accordingly. The bridge cannot start itself from a static web page. Browsers or enterprise policies may deny local-network access; in that case use an authenticated HTTPS proxy you control. Never disable browser security, publish the token, or send credentials through a public CORS relay.

For a different trusted Studio deployment, use its **exact origin** without a path:

```sh
node scripts/serve-ai.mjs --allow-origin=https://studio.example --allow-client-keys
```

`--allow-origin` can be repeated; `XAMORA_AI_ALLOWED_ORIGINS` also accepts a comma-separated list. `XAMORA_AI_ALLOW_CLIENT_KEYS=1` is the environment equivalent of `--allow-client-keys`. Cross-origin and client-key modes require the access token; the CLI generates one when omitted. Origin approval is not authentication: GitHub project pages share their owner's origin, and every actual API call must also carry the private token. No origin wildcards or arbitrary upstream URLs are accepted.

For optional generation from the Pages tab, configure the server variables described below, and use the **full** local endpoint `http://127.0.0.1:8080/api/generate` in generator settings. A relative `/api/generate` URL on GitHub Pages does not become a backend.

## Local Studio or server-held provider keys

The same dependency-free bridge can serve Studio and its fixed API routes. To keep provider keys entirely out of browser credentials, set `TYPESAFE_API_KEY` in the server process environment, not in a project document, and run:

```sh
npm run start:ai
```

Open `http://127.0.0.1:8080`, choose **Use same-origin proxy** in Jev settings (base `/api/jev`), set model `jev-latest`, and leave the browser TypeSafe key empty. Optional `XAMORA_AI_TOKEN` restricts this same-origin mode to clients holding that token. Default same-origin mode does not accept browser provider keys. To serve the existing published tab with server-held keys, add `--allow-origin=https://wieslawsoltes.github.io` without `--allow-client-keys`, or use the Pages command with `TYPESAFE_API_KEY` configured. The latter always prefers the server key.

The server reads process environment variables and does not automatically load `.env`. Node's explicit `node --env-file=.env scripts/serve-ai.mjs` is an alternative; `.env` must stay uncommitted. Its static root is the repository's `dist` directory regardless of the launch directory.

For optional generation, configure `XAMORA_GENERATOR_ENDPOINT` as a full chat-completions URL, `XAMORA_GENERATOR_KEY`, and `XAMORA_GENERATOR_MODEL` on that process. Enable the generator in the UI, use `/api/generate` for the locally served Studio (or its full URL for a different Studio origin), enter the same model identifier, and leave the browser generator provider key empty. Select the endpoint's documented output-limit parameter: `max_tokens` or `max_completion_tokens`. Both provider keys remain server-side in this mode. This is a Chat Completions-compatible adapter, not an adapter for every vendor's distinct API.

The bridge permits only same-origin requests by default. Explicit allowed origins receive exact CORS headers only after origin validation; OPTIONS cannot bypass actual token authentication. Fixed routes are `GET /api/jev/v1/models`, `POST /api/jev/v1/systemone`, `POST /api/generate`, and `GET /api/jev/health`. The protected health endpoint returns only service/version and configured-capability booleans, never keys or provider data, and makes no upstream call. Method/header checks, Host validation against DNS rebinding, request/concurrency limits, schema/response bounds, static-root confinement and client-disconnect cancellation remain enforced. Provider errors are redacted.

**Do not expose this development bridge publicly as an unauthenticated paid gateway.** Production deployment needs TLS, authenticated users, per-user budgets and a deliberately configured reverse proxy. This repository update does not provision a hosted API service.

## Connection diagnostics and credentials

**Use direct TypeSafe** selects `https://api.typesafe.ai`. Direct browser mode still depends on the provider allowing your origin; Studio cannot change that policy. Copied Jev `/v1`, `/v1/models` and `/v1/systemone` URLs are normalized to the base so they do not acquire a second API path. Custom proxy path prefixes are retained. Generator URLs remain full, explicitly configured URLs.

Network failures now show destination-specific recovery guidance and **Connection setup…**. The browser does not reveal whether every rejected fetch was caused by DNS, TLS, CORS or network policy; the message does not pretend otherwise. Recognized bridge responses distinguish a missing/incorrect private token, a missing TypeSafe/server generator configuration, local limits, upstream network failure and timeout. An HTML static-site response is identified as a missing JSON API. Configuration failures are not retried like provider overload. Malformed keys are rejected before transport without echoing their contents. The private bridge token is never added to requests addressed directly to TypeSafe.

Opening setup, choosing a preset and editing fields make no network calls and do not change saved settings. **Test connection / list models** is explicit and sends no project context. Changing any settings or forgetting keys aborts an in-flight test; a late model list cannot overwrite the state of edited fields. Saving and context approval are still required before the next inference. There is no automatic relay selection, fallback, provider probe or local-network scan.

Credentials remain accessible to trusted scripts on the Studio origin; there is no browser-side encryption claim. They stay in memory by default. **Remember credentials in this tab session** explicitly opts into endpoint-bound `sessionStorage`; project documents and `localStorage` never contain these credential fields. Settings persist only nonsensitive preferences. **Forget all stored keys** clears the memory/session vault. Password-field values are cleared on dialog dismissal. Destination changes clear inherited UI credentials and require confirmation before existing credentials can be sent to the new endpoint. Direct shared production keys are not recommended.

## Configuration and bounded context

| Setting                                           | Default / behavior                                                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Jev endpoint/model                                | Official API / `jev-latest`; model-list lookup and explicit version pin supported                                                   |
| Request timeout / retries                         | 30 seconds / 2 retries for 429, 503 and 529; bounded exponential backoff honors Retry-After without retrying earlier than requested |
| Request budget                                    | 20,000 UTF-8 JSON bytes; configurable 4,096–28,000; applies to the **entire request**, including questions/candidates               |
| Native operation limit                            | 4; configurable 1–8. Additional dependent questions may be required per operation                                                   |
| Consumed Choice confidence / selected probability | 0.65 / 0.70; configurable policy thresholds, not empirically qualified accuracy guarantees                                          |
| Source sharing                                    | A bounded excerpt is on; other open document **names** are off unless explicitly enabled for app switching                          |
| Generator                                         | Off; separate endpoint, model, credential, output limit and token-limit parameter                                                   |

Context prioritizes selected/authored targets and prompt-relevant candidates: at most 32 nodes, 8 short property values per node, 24 relevant allowed commands, and 28 panel candidates. Selection mode does not include neighboring source. Document mode may include a short nearby source excerpt, not the entire solution. Global context includes current view/theme/density and allowed actions; other documents' source is not collected. Optional excerpts and property detail are dropped before exceeding the byte budget. The prompt and candidate contract are never silently truncated. Missing candidates produce an unsupported/clarification outcome rather than an invented identifier.

TypeSafe currently documents 64k tokens for a whole request and 32k for state plus its longest question. The UI reports full JSON bytes, state-plus-largest-question bytes through the API, and a **rough** bytes-based token estimate; it is not the provider tokenizer. Conservative byte limits leave headroom and keep small judgments focused. Actual token usage comes from the response. Each step reconstructs relevant state instead of appending an unlimited chat transcript. No screenshot, hidden DOM, entire filesystem, credential store or background conversation is sent.

The optional generator receives the **complete requested target** and pertinent namespace/framework information. It does not receive a lossy snippet for a whole-document rewrite. Generation/verification refuse oversize requests, disabled source sharing or a detected secret redaction that would destroy source fidelity. Selection replacement must be one element, not siblings or a whole HTML document. Jev's verification request includes the original and proposed source and is subject to the same budget; a proposal too large to verify is rejected, not silently applied. Prompts containing detected credentials are rejected for generation. Secret minimization is best-effort, not a complete secrets detector: inspect what you send.

## Action execution and safety

Native edits are planned on a cloned DocumentStore/DocumentSession. They use registered controls, namespace-aware inline/content rules, contextual HTML insertion, literal-text authoring and targeted property/style changes. Bound or structured text is not flattened, locked subtrees cannot be deleted, and duplication refreshes AST identity and removes authored names. Deterministic starters cover blank, card, list, login, contact, settings and dashboard forms for WPF, Avalonia, WinUI and HTML. They are templates assembled by code, not claimed model-generated designs.

Global prompting selects from an explicit allowlist of existing menu actions, panel IDs and optionally open document IDs. This includes views, theme/density, canvas tools, layout settings, resource/property/animation authoring entrypoints and normal conversion/export dialogs. It cannot evaluate JavaScript, select an arbitrary method by name, configure credentials, publish code or bypass existing file/export confirmations. A global dispatch ends that plan; independent additional actions require another request. The same source-freshness guards apply even when the requested action only opens a panel.

Before Apply, the adapter checks active document, revision, exact source, editor buffer, selection, input composition, read-only/recording state, locks and—on app-scoped plans—app/layout state. Changed context invalidates the plan. Normal source edits apply as **one undoable source transaction**, including a multi-step native plan. New files use existing solution history, preserve open documents and allocate a unique filename. App/layout actions retain their existing history behavior rather than claiming that every UI command has document Undo.

No model-provided code is evaluated. Generated responses must contain bounded source, parse correctly, pass deterministic known active-content checks and pass the configured Jev verification threshold. Scripts, embedded browsing elements, direct event hooks and obvious resource/network-loading values are rejected; authors can add intentional hooks/assets manually. These guards are **not a general HTML/CSS sanitizer or proof of semantic correctness**. The normal script-free design preview and separate explicit interactive-preview policy remain unchanged. Review is mandatory regardless of confidence; Jev confidence measures its decision distribution, not permission to perform an action.

## Reusable package

`@wieslawsoltes/xamora-assistant` exports `JevClient`, `jevEndpoint`, `AITransportError` (safe `code`/`status` diagnostics), typed request/answer validators (Choice/Noul/Score), `JevPreferences`, `JevAssistant`, context packing/redaction helpers and starter templates. ESM, CommonJS and TypeScript declarations are generated from the same canonical modules; no duplicated application state or required AI SDK is introduced. DOM-backed HTML planning needs the host's normal parser environment. The transport alone is DOM-free.

```js
import { JevAssistant } from '@wieslawsoltes/xamora-assistant';

const assistant = new JevAssistant({
  registry, // the existing control registry
  settings: { endpoint: 'https://your-studio.example/api/jev', model: 'jev-latest' },
});
const plan = await assistant.plan({
  document: store.document,
  source: store.session.source,
  revision: store.revision,
  selection: [...store.selection],
  scope: 'selection',
}, 'Set Width to "240"', { signal });
// Present plan, verify context freshness and obtain user approval in your host.
// The planner itself has not modified store.
```

Studio exposes `window.xamora.jev.open(scope)`, `preview()`, `run(prompt?, scope?)`, `cancel()`, `discard()`, `apply()`, `settings()` and `status()` (including `running` and `awaitingConsent`). Running through this API still requires the panel's explicit sending consent. It is not a backdoor around review, source validation or stale-context checks.

## Validation and known boundaries

Tests use faithful **mocked HTTP responses**, not a real paid key. Unit suites exercise typed protocol, credentials, limits, retry/abort, probabilities, candidates, scope/locks, AST operations, hybrid verification, draft repair, preferences and private proxy boundaries. The Chromium suite uses the full Studio and an actual detached tool window with intercepted provider requests, checking settings, context preview, staged execution, exact Undo, stale rejection, cancellation, global routing, starter creation and optional generation. Clean installed package consumers verify ESM/CommonJS/types. `npm run test:jev:live` is a separate explicit opt-in smoke check requiring `TYPESAFE_API_KEY`; it sends only a nonsensitive color-choice question and may incur charges.

`tests/jev-connection.test.mjs` also exercises real loopback HTTP preflights, exact-origin/token enforcement, explicit browser-key forwarding, fixed upstreams, sanitized error codes, protected health metadata and CLI configuration. `tests/browser-jev-connection.mjs` serves the Studio from a real loopback HTTPS fixture (with the Pages path layout and a test-only temporary certificate) and reaches the bridge over actual loopback HTTP with native browser CORS enforcement enabled. It verifies that rejected preflight prevents POST, then exercises explicit bridge setup, model discovery, approval and a reviewed login starter without changing the Studio storage origin. Only the bridge's server-to-server provider responses are fixtures; the browser-to-bridge requests are not intercepted. There is no Playwright request interception in this connection suite, including static files: interception was found to alter preflight behavior. The test-only certificate exception does not disable CORS. A local-network permission grant represents user permission, but this loopback fixture is not a claim of qualification for every public-network/browser policy. The exact deployed Pages origin is separately covered by HTTP allowlist tests and the credential-free TypeSafe preflight probe described above.

The public TypeSafe preflight observation is unauthenticated and establishes the reported origin rejection at the time checked, not live inference/account qualification. No live semantic-quality, billing, account-quota, production-load or universal browser-policy qualification is claimed without the relevant environment and credentials. Native candidates/metadata are finite, not exhaustive native XAML/HTML semantics. Large-document wholesale rewrites, arbitrary generated behavior, unrestricted app automation and every multi-intent prompt are not supported by this bounded workflow. A no-match or low-confidence response requires a narrower prompt, exact quoted values, another step or the explicitly configured generator. No npm publication or provider SDK version bump accompanies this feature.

## Research and API sources

Checked 18 September 2026. The implementation follows the current v1 native contract and code-owned action pattern, rather than converting prompts into a fictitious chat schema:

- [TypeSafe HTTP API](https://docs.typesafe.ai/api): state/questions, typed answers, usage, errors. Question IDs are transport correlation keys and are not visible to the model; instructions carry complete meaning.
- [Models and context limits](https://docs.typesafe.ai/models): model aliases/pinning, model discovery, full-request and state-plus-question limits.
- [Function calling cookbook](https://docs.typesafe.ai/cookbooks/function_calling): typed function/argument selection and consumed-answer confidence policy.
- [Pre-parsed value extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook): source candidates rather than fabricated string output.
- [Smart home demo](https://docs.typesafe.ai/demos/smart-home): batching speculative decisions with code-owned workflow and optional generative help.
- [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast): community primary implementation of indexed action routing with a separately configured text helper. Xamora implements its own guarded AST adapter; it does not adopt arbitrary browser automation or execution of generated code.
- [TypeSafe integration guidance](https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md): live contracts, focused state, meaningful instructions, explicit uncertainty and server-side web credentials.

Connection references checked 18 September 2026:

- [MDN CORS guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS): browser-origin response authorization, preflight and the limits of frontend diagnostics.
- [Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access): explicit browser permission for public-origin requests to loopback/local services; this is not a reason to disable browser security.
- [GitHub Pages overview](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages): static hosting, not a Node API runtime.
