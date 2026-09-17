# Native compiler validation and deployment

The main validation workflow calls `native-compiler.yml` from the **same source
revision**, alongside the JavaScript, installed-package and browser checks. The
Pages publish job requires both `test` and `native` to succeed. A failed fixture
build or either native target blocks publication. Neither job is optional, and
native results are not inferred from JavaScript unit tests.

## Shared, revision-bound fixtures

A single Linux job generates static and Chromium-measured XAML using the actual
compiler. Its artifact contains both target directories and a `source.sha` in
each. WPF and Avalonia download that artifact within the same workflow run and
check the source revision before loading it. This removes duplicate npm/browser
installations and Windows Media Foundation setup while ensuring both native
runners use the same browser reference layout.

The workflow remains manually runnable with `workflow_dispatch`. Normal pull
requests and main pushes invoke it through the main CI workflow only, avoiding
duplicate independent native runs. It needs read-only repository permissions;
no publishing or application secrets are passed to the native jobs.

## What the tests prove

Each target loads twelve generated fixtures: four static viewport/metadata
combinations, two measured responsive layouts, and two RTL/form-state captures
with password capture omitted or explicitly enabled, plus four logical-box fixtures combining LTR/RTL with metadata on/off. Logical fixtures assert dimensions, direction, margin, padding, border thickness and text after logical/physical cascade, variable resolution and importance. The runners exercise real
framework loading, measure/arrange, declared dimensions and attached placement,
text, selection, checkbox state, flow direction and opacity. Reports and the
exact XAML inputs are retained as per-target workflow artifacts.

WPF additionally serializes and reloads the loaded object tree. Its native
`PasswordBox.Password` property is intentionally hidden from serialization.
The first load must still reproduce the opt-in fixture value; the native saved
XAML must not contain a password attribute, and reloading it must leave the
password empty. This is an explicit privacy assertion, not a skipped value test.

Avalonia uses its headless layout backend. Neither target's fixture pass is a
claim of pixel-identical typography, exhaustive control coverage, operating-system
input qualification or GPU rendering certification. Native loaders receive only
trusted repository fixtures, not arbitrary uploaded XAML.

See [responsive compiler contracts](RESPONSIVE-COMPILER.md) for the APIs and
[the workflow](../.github/workflows/native-compiler.yml) for the executable gate.

References: [GitHub reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows),
[workflow artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data), and
[WPF PasswordBox source](https://github.com/dotnet/wpf/blob/main/src/Microsoft.DotNet.Wpf/src/PresentationFramework/System/Windows/Controls/PasswordBox.cs).
