/** Pure command catalog/search helpers. No DOM, storage, or document mutations. */
const normalize = (text) =>
  String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
export function commandCatalog(menus) {
  const found = new Map();
  const visit = (entries, path = []) => {
    for (const entry of entries || []) {
      if (entry.children) {
        visit(typeof entry.children === 'function' ? entry.children() : entry.children, [
          ...path,
          entry.label,
        ]);
      } else if (!entry.separator && entry.id && typeof entry.run === 'function') {
        found.set(entry.id, { ...entry, category: path[0] || 'Commands', path: path.join(' › ') });
      }
    }
  };
  visit(menus);
  return [...found.values()];
}
export function searchCommands(
  catalog,
  query = '',
  { scope = 'all', recent = [], limit = 60 } = {},
) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const ranked = [];
  for (const [index, command] of catalog.entries()) {
    const isWindow = command.id.startsWith('window:');
    const isFile = command.category === 'File' || command.id.startsWith('window:document:');
    if (scope === 'windows' && !isWindow) continue;
    if (scope === 'files' && !isFile) continue;
    const label = normalize(command.label),
      context = normalize(`${command.path} ${command.id.replace(/[-:]/g, ' ')}`);
    let score = 0;
    for (const term of terms) {
      if (label === term) score += 100;
      else if (label.startsWith(term)) score += 50;
      else if (label.split(/\W+/).some((word) => word.startsWith(term))) score += 25;
      else if (label.includes(term)) score += 15;
      else if (context.includes(term)) score += 5;
      else {
        score = -1;
        break;
      }
    }
    if (score < 0) continue;
    const at = recent.indexOf(command.id);
    if (!terms.length && at >= 0) score += 1000 - at;
    ranked.push({ command, score, index });
  }
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return {
    total: ranked.length,
    items: ranked.slice(0, Math.max(1, limit)).map(({ command }) => command),
  };
}
export function readRecentCommands(storage) {
  try {
    const value = JSON.parse(storage?.getItem('xamora-command-recents-v1') || '[]');
    return Array.isArray(value)
      ? [...new Set(value.filter((id) => typeof id === 'string' && id.length <= 160))].slice(0, 8)
      : [];
  } catch {
    return [];
  }
}
export function rememberCommand(storage, recent, id) {
  const next = [id, ...recent.filter((value) => value !== id)].slice(0, 8);
  try {
    storage?.setItem('xamora-command-recents-v1', JSON.stringify(next));
  } catch {}
  return next;
}
