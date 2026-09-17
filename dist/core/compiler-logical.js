/** Flow-relative box names. Cascade priority and value resolution remain compiler-owned. */
const sides = ['top', 'right', 'bottom', 'left'];
const modes = new Set([
  'horizontal-tb',
  'vertical-rl',
  'vertical-lr',
  'sideways-rl',
  'sideways-lr',
]);

/** Expand supported physical/four-side and logical/two-side shorthands without reading values. */
export function cssBoxLonghands(property) {
  if (property === 'inset') return [...sides];
  if (property === 'margin' || property === 'padding')
    return sides.map((side) => `${property}-${side}`);
  if (property === 'border-width') return sides.map((side) => `border-${side}-width`);
  const pair = property.match(/^(margin|padding|inset|border)-(inline|block)(-width)?$/);
  if (!pair || (pair[1] === 'border') !== !!pair[3]) return null;
  return ['start', 'end'].map((edge) => `${pair[1]}-${pair[2]}-${edge}${pair[3] || ''}`);
}

/** Map supported logical longhands using an already-computed writing mode and direction.
 * Unknown names are returned unchanged. Unknown writing modes return null for logical names.
 * Vertical mapping is geometry only; native vertical text still requires an adapter.
 */
export function physicalCssProperty(property, css = {}) {
  const size = property.match(/^(min-|max-)?(inline|block)-size$/);
  const edge = property.match(
    /^(margin|padding|inset|border)-(inline|block)-(start|end)(-width)?$/,
  );
  if (!size && (!edge || (edge[1] === 'border') !== !!edge[4])) return property;
  const mode = (css['writing-mode'] || 'horizontal-tb').toLowerCase();
  if (!modes.has(mode)) return null;
  const horizontal = mode === 'horizontal-tb';
  if (size) return (size[1] || '') + ((size[2] === 'inline') === horizontal ? 'width' : 'height');
  const rtl = (css.direction || 'ltr').toLowerCase() === 'rtl';
  const block = horizontal
    ? ['top', 'bottom']
    : mode.endsWith('-rl')
      ? ['right', 'left']
      : ['left', 'right'];
  const inline = horizontal
    ? ['left', 'right']
    : mode === 'sideways-lr'
      ? ['bottom', 'top']
      : ['top', 'bottom'];
  if (rtl) inline.reverse();
  const side = (edge[2] === 'inline' ? inline : block)[edge[3] === 'start' ? 0 : 1];
  return edge[1] === 'inset' ? side : `${edge[1]}-${side}${edge[4] || ''}`;
}

/** Native scalar family affected by a box declaration; used when patching reverse edits. */
export function cssBoxFamily(property, css = {}) {
  const longhands = cssBoxLonghands(property);
  if (longhands) return cssBoxFamily(longhands[0], css);
  const physical = physicalCssProperty(property, css);
  if (!physical) return null;
  if (/^(margin|padding)-(top|right|bottom|left)$/.test(physical)) return physical.split('-')[0];
  if (/^border-(top|right|bottom|left)-width$/.test(physical)) return 'border-width';
  if (sides.includes(physical)) return 'inset';
  return /^(min-|max-)?(width|height)$/.test(physical) ? physical : null;
}
