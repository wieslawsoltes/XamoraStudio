/** Explicit opt-in paid live qualification. No document content or key values are printed. */
import { JevClient } from '../dist/core/jev-client.js';
if (!process.env.TYPESAFE_API_KEY)
  throw Error('Set TYPESAFE_API_KEY to opt into a live (potentially billed) smoke test.');
const client = new JevClient(
  { model: process.env.JEV_MODEL || 'jev-latest', retries: 0 },
  { apiKey: process.env.TYPESAFE_API_KEY },
);
const result = await client.evaluate(
  { request: 'Make the button blue', candidates: ['red', 'blue'] },
  {
    color: {
      type: 'choice',
      instructions: 'Which candidate color is explicitly requested?',
      criteria: { red: 'Red', blue: 'Blue', none: 'Neither candidate' },
    },
  },
);
if (result.answers.color.choice !== 'blue')
  throw Error('The live model did not select the expected smoke-test color.');
console.log(
  JSON.stringify({
    model: result.model,
    usage: result.usage,
    selected: result.answers.color.choice,
    confidence: result.answers.color.confidence,
  }),
);
