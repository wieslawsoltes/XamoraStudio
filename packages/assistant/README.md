# @wieslawsoltes/xamora-assistant

Typed TypeSafe Jev decisions and reviewable Xamora document plans. ESM, CommonJS and TypeScript declarations share the canonical implementation. No AI SDK or extra external dependency is required.

Jev is a typed decision model, not a code generator. `JevClient` uses the real `/v1/systemone` state/questions protocol and validates Choice, Noul and Score responses. `JevAssistant` builds bounded questions, selects actual candidate values and plans AST edits without mutating the caller's document. An optional separately configured Chat Completions-compatible generator supplies bespoke markup; there is no silent fallback.

```js
import { JevClient } from '@wieslawsoltes/xamora-assistant/jev-client';

const client = new JevClient({ endpoint: 'https://studio.example/api/jev', model: 'jev-latest' });
const result = await client.evaluate({ request: 'Use blue' }, {
  color: { type: 'choice', instructions: 'Which color does the request explicitly name?',
    criteria: { blue: 'Blue', red: 'Red', none: 'Neither' } },
});
// Apply host policy to result.answers.color. A typed answer is not execution authorization.
```

Keep provider credentials in a private server proxy. Direct-browser personal keys are supported with memory-only defaults and explicit endpoint-bound session storage, not encryption. Never put keys into a document snapshot. `JevPreferences` separates nonsensitive configuration from its credential vault.

The planner accepts the current document/source/revision/selection plus a selection, document or app scope. It uses the host's existing control registry and document parser; HTML planning requires a DOM-backed parser environment. `JevClient` alone is DOM-free. Hosts must present a plan for review and recheck exact source/revision/selection before applying. The Studio adapter does this with one source-history transaction, invalid-draft repair, solution history for new files, explicit allowed commands and multiwindow routing.

Full setup, API examples, budgets, native/hybrid behavior, proxy deployment and security/qualification boundaries: [Jev integration guide](../../docs/JEV-INTEGRATION.md). `npm run start:ai` at repository root serves the private loopback proxy and Studio. No paid-model semantic quality is implied by deterministic mock tests. Publication is a separate explicit action. MIT licensed.
