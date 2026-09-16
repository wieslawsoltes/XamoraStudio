/** Canonical package boundaries. Studio continues to import dist/ directly. */
export const scope = '@wieslawsoltes/';
export const packageLayout = [
  {
    id: 'contracts',
    description:
      'Shared type-only contracts for the universal Xamora object model and rendering APIs',
    modules: [],
    contracts: true,
  },
  {
    id: 'model',
    description: 'Universal document AST, transaction history, and control metadata',
    modules: ['model', 'history', 'registry'],
  },
  {
    id: 'data',
    description: 'Observable design databases, bindings, and data queries',
    modules: ['design-data'],
  },
  {
    id: 'styling',
    description: 'Resources, styles, property paths, and appearance',
    modules: ['styling', 'property-path', 'appearance', 'vector'],
  },
  {
    id: 'animation',
    description: 'XAML animation clocks, storyboards, visual states, and timeline editing',
    modules: ['animation', 'states', 'motion-schema', 'motion-diagnostics', 'timeline-editing'],
  },
  {
    id: 'markup',
    description: 'XAML and HTML parsing, source synchronization, language services, and CSS motion',
    modules: [
      'xaml',
      'html',
      'source-syntax',
      'source-text-buffer',
      'document-session',
      'xaml-language',
      'language-service',
      'html-animation',
      'html-states',
    ],
  },
  {
    id: 'renderer',
    description: 'Shared browser rendering for XAML and HTML documents',
    modules: ['render', 'html-render', 'motion-render', 'gpu'],
  },
  {
    id: 'control-primitives',
    description: 'Standalone menus, scroll strips and UI density preferences',
    modules: [],
    controls: ['menu-bar', 'scroll-buttons', 'workspace-density'],
    assets: ['dist/controls/scroll-buttons.css', 'dist/controls/menu-bar.css'],
    typeContracts: false,
    standalone: true,
  },
  {
    id: 'docking',
    description: 'Standalone docking layout model and live-DOM workspace control',
    modules: ['docking'],
    controls: ['dock-workspace'],
    assets: ['dist/controls/docking.css', 'dist/controls/scroll-buttons.css'],
    typeContracts: false,
    standalone: true,
  },
  {
    id: 'code-editor',
    description: 'Standalone source editor with injectable language services and buffer history',
    modules: [],
    controls: ['code-editor'],
    assets: ['dist/controls/code-editor.css'],
    typeContracts: false,
    standalone: true,
  },
  {
    id: 'property-grid',
    description: 'Standalone controlled property grid with validation, grouping and custom fields',
    modules: [],
    controls: ['property-grid'],
    assets: ['dist/controls/property-grid.css'],
    typeContracts: false,
    standalone: true,
  },
  {
    id: 'controls',
    description: 'Reusable IDE docking, menus, scroll buttons, and density controls',
    modules: [],
    reexports: [
      { name: 'docking', source: 'dist/core/docking.js' },
      { name: 'code-editor', source: 'dist/controls/code-editor.js' },
      { name: 'property-grid', source: 'dist/controls/property-grid.js' },
      ...['dock-workspace', 'menu-bar', 'scroll-buttons', 'workspace-density'].map((name) => ({
        name,
        source: `dist/controls/${name}.js`,
      })),
    ],
    assets: [
      'dist/controls/scroll-buttons.css',
      'dist/controls/docking.css',
      'dist/styles/density.css',
    ],
  },
  {
    id: 'designer',
    description:
      'Reusable designer authoring, solution, prototype, geometry, and code editor services',
    modules: [
      'authoring',
      'design-tools',
      'prototype',
      'solution',
      'editor',
      'samples',
      'overlay-layout',
    ],
    assets: ['dist/styles/editor.css', 'dist/controls/menu-bar.css'],
  },
  {
    id: 'properties',
    description: 'Observable application state and extensible runtime property system',
    modules: ['runtime-properties'],
  },
  {
    id: 'runtime',
    description:
      'Standalone XAML browser applications with bindings, commands, resources, and motion',
    modules: ['web-runtime', 'runtime-element'],
    assets: ['dist/styles/runtime.css'],
    standalone: true,
  },
  {
    id: 'xamora',
    description: 'Xamora universal UI framework and reusable designer SDK',
    modules: [],
    umbrella: true,
    standalone: true,
  },
];
export function packageName(id) {
  return scope + (id === 'xamora' ? 'xamora' : 'xamora-' + id);
}
export function sourceModules(entry) {
  return [
    ...entry.modules.map((name) => ({ source: `dist/core/${name}.js`, name })),
    ...(entry.controls || []).map((name) => ({ source: `dist/controls/${name}.js`, name })),
    ...(entry.cli
      ? [
          { source: entry.cli, name: 'cli/index' },
          ...(entry.cliModules || []).map((name) => ({
            source: `dist/compiler-cli/${name}.js`,
            name: `cli/${name}`,
          })),
        ]
      : []),
  ];
}
