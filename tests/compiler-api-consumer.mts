import {
  compileDocument,
  compileRenderedDocument,
  observeRenderedDocument,
  compileResponsiveVariants,
  evaluateMediaQuery,
  evaluateSupportsCondition,
  type CompilerOptions,
  type CompilerResult,
} from '@wieslawsoltes/xamora-compiler';
const options: CompilerOptions = {
  from: 'html',
  nativeOutput: true,
  environment: { type: 'screen', width: 900, height: 700, colorScheme: 'dark' },
  stylesheets: new Map([['main.css', 'button {width:10px}']]),
  selectorState: { hover: ['action'] },
  evaluateCondition: (kind, query, node) => kind === 'container' && !!query && !!node.id,
  supports: (condition) => CSS.supports(condition),
};
const result: CompilerResult = compileDocument('<button>Test</button>', options);
const capture: CompilerResult = compileRenderedDocument(document.body, { framework: 'Avalonia' });
const observer = observeRenderedDocument(document.body, {
  onResult: (value) => console.log(value.metadata.browserCapture),
});
observer.refresh();
observer.dispose();
const variants = compileResponsiveVariants('<button>Test</button>', {
  ...options,
  variants: [{ name: 'phone', width: 380, height: 700 }],
});
const query: boolean | null = evaluateMediaQuery('(width > 10px)', { width: 20 });
evaluateSupportsCondition('(display:grid)', { 'display:grid': true });
console.log(result, capture, variants, query);
