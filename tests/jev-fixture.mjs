export function responseFor(request, selections = {}) {
  const answers = Object.fromEntries(
    Object.entries(request.questions).map(([id, q]) => {
      if (q.type === 'noul') return [id, { type: 'noul', noul: selections[id] ?? 0.98 }];
      const keys = Object.keys(q.criteria),
        match = selections[id];
      const choice =
        keys.find(
          (k) =>
            k === match || (typeof q.criteria[k] === 'string' && q.criteria[k].includes(match)),
        ) || keys[0];
      return [
        id,
        {
          type: 'choice',
          choice,
          confidence: 0.96,
          probabilities: Object.fromEntries(
            keys.map((k) => [k, k === choice ? 0.98 : 0.02 / (keys.length - 1)]),
          ),
        },
      ];
    }),
  );
  return { model: 'jev-1.13.0', answers, usage: { input_tokens: 120, output_tokens: 12 } };
}
