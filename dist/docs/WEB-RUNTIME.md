# Standalone Xamora web applications

Xamora's web runtime hosts the same document AST, control registry, XAML parser, DOM renderer, resource/style resolver and animation samplers used by the designer. A deployed application does not need the studio UI, a .NET runtime, WebGPU, or an application server. Serve the application files over HTTP and supply JavaScript behavior through explicit registrations.

The working reference application is [Launchboard](../examples/StandaloneApp/). Its `MainView.xaml` is rendered directly; the project fields, task collection, commands, resource/theme changes, custom control, storyboard and visual state transitions are interactive. It imports the runtime and its own app stylesheet without loading `dist/app.js` or studio CSS.

## Start an application

The source checkout needs no bundler:

```js
import {createApplication} from './core/web-runtime.js';

const application = createApplication({
  source: `<StackPanel xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
    <TextBox Text="{Binding Name, Mode=TwoWay, UpdateSourceTrigger=PropertyChanged}" />
    <TextBlock Text="{Binding Name}" />
    <Button Content="Save" Command="Save" />
  </StackPanel>`,
  data: {Name: 'Alex'},
  commands: {
    Save(parameter, {data}) { console.log('Saving', data.Name); }
  }
});

application.mount(document.querySelector('#application'));
application.data.Name = 'Morgan'; // observable: updates the bound controls

// When the route/component goes away:
application.dispose();
```

After packages have been published, the equivalent npm entry point is `@wieslawsoltes/xamora-runtime`. Package build, tarball tests and publishing infrastructure are provided in the repository; this feature does not publish packages to npm. For now, consume locally packed tarballs or the source checkout. The scoped names are a release plan, not a claim that these versions are already on the registry.

`createApplication({document})` accepts an existing universal document instead of reparsing markup. `mountXaml(host, source, options)` combines construction and mounting. `application.load(url)` fetches a view, while `updateSource(source)` returns a validity result; malformed markup leaves the last valid document available. Use the application's diagnostics to identify unsupported controls or bindings instead of treating a rendered approximation as proof of native framework compatibility.

## Observable data and bindings

An application exposes its observable root as `application.data`. Mutate this proxy, call `application.setData('Project.Title', value)`, or group changes with `application.state.batch(data => { ... })`. Mutating the original unobserved object outside the proxy does not notify the renderer. Subscribe with `application.state.subscribe((change, data) => { ... })`; the return value removes that subscription. `application.state.snapshot()` returns a plain snapshot for persistence or later remounting.

Data invalidation currently stages and replaces the rendered DOM tree, preserving the active input and selection, including inside a shadow root. It is not a keyed incremental DOM renderer. Subscription paths are notification hints; moved or aliased objects still invalidate the application. Custom control mounts therefore need to return cleanup functions, and large views should use batching and suitable custom collection controls.

The runtime supports safe dotted paths and numeric indexes, inherited `DataContext`, item-template contexts, `$root` paths, `OneWay`, `TwoWay`, `OneTime`, and `OneWayToSource` binding modes. Input property metadata supplies default binding modes. Use an explicit `Mode` when a view's intended behavior matters. Text bindings can use `UpdateSourceTrigger=PropertyChanged` to commit each input; an explicit update trigger defers the write until `application.updateSourceBinding(controlName, property)`.

Binding adapters include local `ElementName` references, `RelativeSource Self` and `TemplatedParent`, fallback/null values, basic `StringFormat`, and registered converters. The browser property system does not reproduce every .NET markup extension or binding feature. Unsupported ancestor lookups, unavailable sources, converter failures and unresolved paths produce runtime diagnostics.

```js
const app = createApplication({
  source,
  data: {Progress: 0.5},
  converters: {
    Percent: {
      convert: value => Number(value) * 100,
      convertBack: value => Number(value) / 100
    }
  }
});
```

Reference the registered converter with `Converter={StaticResource Percent}`. Two-way conversion requires `convertBack`; the runtime reports a failed reverse conversion instead of silently rewriting data with the wrong type.

## Commands and events

`Command="Save"` resolves an explicitly registered JavaScript command. `CommandParameter` accepts a value or binding, including an item-template property. Command functions receive `(parameter, context)` where context includes `application`, root `data`, local `context`, AST `node`, DOM `element`, and interaction details. An object command can provide `execute` and `canExecute`; disabled command targets reflect the latter when data refreshes.

`Click="OnSave"`, `TextChanged="OnNameChanged"` and supported input/lifecycle event attributes resolve names in the application's `events` registration. Event callbacks receive the context object. Runtime events such as `rendered`, `interaction`, `mounted`, `unmounted` and `diagnostic` are available through `addEventListener`.

```js
const commands = {
  AddTask: {
    canExecute: (_parameter, {data}) => Boolean(data.NewTask.trim()),
    execute: (_parameter, {application, data}) => application.state.batch(() => {
      data.Tasks.push({Title: data.NewTask, Done: false});
      data.NewTask = '';
    })
  }
};
```

XAML is data. The runtime does not evaluate C# code-behind, instantiate CLR types, or execute arbitrary handler strings. Register the implementation in application JavaScript or a toolkit plugin.

## Resources, themes and properties

Local XAML resources, styles, setters, templates and supported style triggers reuse the designer's resource/style infrastructure. Application resources are supplied through `resources` and changed with `setResource(key, value)`. Values may be strings, numbers, booleans or resource AST elements. A view's local resources take precedence over application fallbacks.

`theme` accepts a `ResourceDictionary` document, AST element or XAML string. Replace it with `setTheme(dictionary)`. Register already loaded external dictionaries with `registerDictionary(source, dictionary)` or fetch one with `loadDictionary(url)`; the dictionary source must match the view's `Source` reference. The runtime does not automatically discover a native application's assembly or project resource graph.

`findName(name)` returns a rendered DOM control. `getValue(nameOrId, property)`, `setValue(nameOrId, property, value)` and `clearValue(nameOrId, property)` use the runtime property store. Property metadata is extensible through `propertyRegistry`; coercion, defaults and binding-mode metadata are shared infrastructure, not CLR dependency properties. Runtime local values and observable data do not rewrite the authored XAML. Editing persisted source remains the job of the shared `DocumentSession` used by designer tools.

## Custom controls and lifecycle

Toolkit descriptors define a control name, category, property metadata and optional DOM renderer. Plugins can install descriptors and return cleanup functions:

```js
const statusPlugin = {
  setup(application) {
    return application.registry.registerControl({
      type: 'app:StatusBadge', category: 'Application',
      properties: [{name: 'Label', type: 'string'}],
      render({properties}) {
        const element = document.createElement('span');
        element.textContent = properties.Label;
        return element;
      },
      mount({element, application}) {
        const onClick = () => application.setData('Selected', true);
        element.addEventListener('click', onClick);
        return () => element.removeEventListener('click', onClick);
      }
    });
  }
};
```

Declare the prefix in XAML, for example `xmlns:app="urn:my-application"`. Existing `ControlTemplate`, `DataTemplate` and `TemplateBinding` support can supply a visual structure without custom rendering code. Namespaces and unknown properties remain in the AST; supporting their behavior requires the corresponding runtime adapter.

Control `mount` disposers run before a refresh replaces controls and when the application unmounts. Plugin disposers run during application disposal. The runtime owns its data subscription, rendered controls, animation players and state clock. Call `dispose()` when a route or host component is removed. Use a data snapshot to construct a new application if that route returns.

## Storyboards and visual states

XAML animation uses the shared timeline and property-path samplers. Start a resource storyboard with `playStoryboard('Entrance')`; the returned player exposes `pause`, `play`, `seek`, `stop` and `dispose`. Player time is in seconds. Use `goToState('CommonStates', 'Selected', {transitions: true})` for a visual state group. `stopAnimations()` stops clocks and restores the rendered baseline.

Supported samples include double, color, thickness, point, object and Boolean tracks, keyframes, supported easing functions, repeat/auto-reverse timing, transforms and generated/explicit state transitions. The source AST remains authored XAML rather than a DOM animation snapshot. Native framework animation behavior outside the implemented sampler/property-path set needs an adapter. HTML documents retain their own CSS/JavaScript animation semantics through the HTML renderer.

Applications should make their motion choices respect user preferences, for example choosing not to start a decorative storyboard when `matchMedia('(prefers-reduced-motion: reduce)').matches` is true. The Launchboard celebration is explicitly started by the user.

## Optional custom element

The custom element adapter has no DOM dependency at module evaluation time. Register it after the browser DOM exists:

```js
import {registerXamlElement} from './core/runtime-element.js';

registerXamlElement('my-xaml-view', {commands: {Save: () => save()}, shadow: true});
const view = document.createElement('my-xaml-view');
view.data = {Name: 'Alex'};
view.source = '<TextBox Text="{Binding Name, Mode=TwoWay}" />';
view.addEventListener('xamora-ready', event => console.log(event.detail.application));
view.addEventListener('xamora-error', event => console.error(event.detail.error));
document.body.append(view);
```

Alternatively use `src="./MainView.xaml"` or a child `<script type="application/xaml">` element. The optional `framework` attribute controls parsing. Explicit `.source` wins over `src`. `reload()` returns a promise for the mounted application and rejects load failures. Replacing a `src` or removing the element aborts outstanding requests; a late response cannot replace a newer view. `disconnectedCallback` disposes the host, and reconnection mounts the latest source with retained data. Calling `.dispose()` explicitly also releases the host; `.reload()` can mount it again while connected.

Shadow DOM is enabled by default. Set `shadow: false` to render into a light-DOM host. Runtime base styles are scoped and injected into the host; a consuming application can use the exported runtime stylesheet and its own styles. Styles and control code from the studio are not required.

Plain `data` defaults supplied at registration are copied for each element, so separate hosts do not share mutations accidentally. Supply an explicit `ObservableState` when sharing state is intentional. The adapter retains that state object across reloads and reconnections instead of creating nested observation proxies.

## Browser support and current boundaries

The implementation targets modern browsers with ES modules, DOM/CSS Grid/Flexbox, Proxy, custom elements and requestAnimationFrame. WebGPU is optional for designer rendering work and is not required by standalone applications. Browser tests run in Chromium. Other browser engines require their own release qualification.

| Area        | Implemented browser behavior                                                                        | Boundary                                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout      | Grid tracks/spans, StackPanel, WrapPanel, UniformGrid, DockPanel, Canvas, sizes, margins, alignment | DOM/CSS layout is not the native WPF/Avalonia measure-arrange engine; virtualization and every native attached property are not implemented. |
| Controls    | Shared built-in DOM control mappings, templates and toolkit render/mount adapters                   | Native accessibility contracts, keyboard behavior and platform controls need adapter-specific validation.                                    |
| Collections | Observable arrays, ItemsSource, item templates, editing and commands in item contexts               | The shared built-in renderer displays up to 500 items and reports larger collections; use a virtualizing custom control for larger views.    |
| Data        | Observable nested objects, registered commands/events/converters and supported binding modes        | No CLR objects, C# execution, reflection, full .NET binding engine or automatic network persistence.                                         |
| Styling     | Supported resource lookup, style inheritance, templates and theme dictionaries                      | Dynamic style/selector/property semantics beyond the shared subset require adapters.                                                         |
| Motion      | Shared storyboard/keyframe/state sampling and explicit application controls                         | Unsupported native animation types, composition effects or clocks are not translated into equivalent browser implementations automatically.  |
| Documents   | XAML AST rendering and existing HTML document rendering                                             | Importing a document successfully does not mean every native or arbitrary script behavior is portable.                                       |

The runtime's first package release is a browser framework based on Xamora's supported control and document semantics. It is not a binary-compatible WPF or Avalonia implementation. Runtime diagnostics and the standalone browser example are part of that support contract.
