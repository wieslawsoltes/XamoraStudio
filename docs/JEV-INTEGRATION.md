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

## Recommended setup: keep provider keys server-side

The repository includes a dependency-free **private loopback proxy** serving Studio and three fixed API routes. From the repository root with Node 22 or later:

```sh
npm ci
# Set TYPESAFE_API_KEY in your local process environment, not in a project file.
# Optional XAMORA_AI_TOKEN restricts the proxy to clients holding your local access token.
npm run start:ai
```

Open `http://127.0.0.1:8080`. In Jev settings, set **Jev API base URL** to `/api/jev`, model to `jev-latest`, and leave the browser TypeSafe key empty. Enter the private proxy access token when `XAMORA_AI_TOKEN` is set. `PORT` can change the loopback port. The proxy reads environment variables; it does not automatically read `.env`. Node's explicit `node --env-file=.env scripts/serve-ai.mjs` is an alternative, and `.env` must stay uncommitted.

For optional generation, configure `XAMORA_GENERATOR_ENDPOINT` as a full chat-completions URL, `XAMORA_GENERATOR_KEY`, and `XAMORA_GENERATOR_MODEL` on that process. In the UI, enable the generator, use `/api/generate`, enter the same model identifier, and leave its browser provider key empty. Select the endpoint's documented output-limit parameter: `max_tokens` or `max_completion_tokens`. Both keys remain server-side in this mode. This is a Chat Completions-compatible adapter, not an adapter for every vendor's distinct API.

The proxy accepts only same-origin browser requests and fixed TypeSafe upstream routes, checks Host/Origin against loopback (or an explicitly supplied origin for embedders), rejects arbitrary relay URLs, bounds JSON bodies/responses and concurrent/request-rate usage, and does not serve repository files outside `dist`. Client disconnects abort upstream calls. It binds only `127.0.0.1`. **Do not expose this development proxy publicly as an unauthenticated paid gateway.** Production deployment needs authenticated users, TLS, per-user budgets and a deliberately configured reverse proxy. GitHub Pages cannot run the Node server; use the locally served Studio or your own appropriately secured deployment.

Direct browser mode uses `https://api.typesafe.ai`, your personal TypeSafe key and a configured model. It depends on the provider allowing your origin through CORS. Credentials are accessible to trusted scripts on the Studio origin: there is no browser-side encryption claim. They remain in memory by default. **Remember credentials in this tab session** explicitly opts into endpoint-bound `sessionStorage`; project documents and `localStorage` never contain these credential fields. Settings store only nonsensitive preferences. **Forget all stored keys** clears the memory/session vault. Dialog password-field values are cleared on dismissal. Destination changes clear inherited UI credentials and require confirmation before an existing private token can be forwarded to a changed endpoint. Direct shared production keys are not recommended.

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

`@wieslawsoltes/xamora-assistant` exports `JevClient`, typed request/answer validators (Choice/Noul/Score), `JevPreferences`, `JevAssistant`, context packing/redaction helpers and starter templates. ESM, CommonJS and TypeScript declarations are generated from the same canonical modules; no duplicated application state or required AI SDK is introduced. DOM-backed HTML planning needs the host's normal parser environment. The transport alone is DOM-free.

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

No live semantic-quality, billing, CORS, account-quota or production-load qualification is claimed without such credentials. Native candidates/metadata are finite, not exhaustive native XAML/HTML semantics. Large-document wholesale rewrites, arbitrary generated behavior, unrestricted app automation and every multi-intent prompt are not supported by this bounded workflow. A no-match or low-confidence response requires a narrower prompt, exact quoted values, another step or the explicitly configured generator. No npm publication or provider SDK version bump accompanies this feature.

## Research and API sources

Checked 18 September 2026. The implementation follows the current v1 native contract and code-owned action pattern, rather than converting prompts into a fictitious chat schema:

- [TypeSafe HTTP API](https://docs.typesafe.ai/api): state/questions, typed answers, usage, errors. Question IDs are transport correlation keys and are not visible to the model; instructions carry complete meaning.
- [Models and context limits](https://docs.typesafe.ai/models): model aliases/pinning, model discovery, full-request and state-plus-question limits.
- [Function calling cookbook](https://docs.typesafe.ai/cookbooks/function_calling): typed function/argument selection and consumed-answer confidence policy.
- [Pre-parsed value extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook): source candidates rather than fabricated string output.
- [Smart home demo](https://docs.typesafe.ai/demos/smart-home): batching speculative decisions with code-owned workflow and optional generative help.
- [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast): community primary implementation of indexed action routing with a separately configured text helper. Xamora implements its own guarded AST adapter; it does not adopt arbitrary browser automation or execution of generated code.
- [TypeSafe integration guidance](https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md): live contracts, focused state, meaningful instructions, explicit uncertainty and server-side web credentials.
