# Launchboard standalone application

Launchboard renders `MainView.xaml` directly in a browser. It uses the shared Xamora runtime, with no dependency on the studio application or studio stylesheets.

From the repository root:

```sh
npm start
```

Open `http://localhost:8080/examples/StandaloneApp/`. The copy under `dist/examples/StandaloneApp/` is served by the development server and GitHub Pages. Keep both example directories identical.

The example exercises:

- Two-way project and item-template bindings, with text updates on every input event.
- An observable task collection, add/remove commands, and `canExecute` disabling an empty task submission.
- Shared application resources, a replaceable resource dictionary theme, and local XAML styles.
- The registered `launch:StatusBadge` toolkit control.
- A XAML storyboard and a visual state group with a generated transition.
- Disposal, remounting, and data snapshots that preserve the current session.
- Keyboard-accessible inspector tabs displaying source, live data and activity.

The app fetches its XAML using `fetch`; serve it over HTTP rather than opening `index.html` with `file://`. All task data stays in memory. Remount retains data, while reloading the browser starts a new session.

`app.js` imports `../../core/web-runtime.js` so this checkout works without a build. In an npm consumer, use `createApplication` from `@wieslawsoltes/xamora-runtime` and include the stylesheet through `@wieslawsoltes/xamora-runtime/runtime.css` if your host needs the exported base styles. The host also injects scoped runtime styles automatically.

See [`docs/WEB-RUNTIME.md`](../../docs/WEB-RUNTIME.md) for the support contract, browser hosting, extension APIs and release preparation.

To verify both this source example and the built standalone browser package:

```sh
npm ci
npm run build
npx playwright install chromium
node tests/browser-runtime-example.mjs
```

The browser suite covers data/visual synchronization, collection commands, resources/themes, states and storyboards, mobile layout, disposal/remounting, custom-element reconnect and fetch races, and an isolated page importing only the package's browser bundle.
