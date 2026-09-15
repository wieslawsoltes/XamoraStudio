# GitHub Pages hosting

The designer is published at https://wieslawsoltes.github.io/XamoraStudio/.

The complete application source is on `main`. The public static files come from `dist/`, which contains the app, reusable modules, styles, documentation and examples. No dependency installation or application build step is required.

The **Validate and publish Xamora** workflow runs `npm run check` and `npm test`. Pull requests validate only. A successful `main` push or manual run publishes the app and verifies six deployed files against the source commit, including the HTML authoring module and docking example.

The workflow reads the repository's Pages configuration. With branch publishing, it updates `gh-pages` using a normal fast-forward commit and requests a Pages build explicitly. With GitHub Actions publishing, it uploads the official Pages artifact and deploys it. It does not change repository visibility or Pages source settings.

For a new fork, enable Pages with `gh-pages` / or select GitHub Actions as the source. The workflow needs contents write, Pages write and OIDC permissions in its publishing job. It uses the automatic GitHub token; no personal token or deployment secret is required.

The app stores workspace documents in browser storage. Projects saved on a different origin do not automatically appear here. Use **File → Save solution** on the previous site and **File → Open solution** on GitHub Pages to transfer them.

The standalone docking example is at https://wieslawsoltes.github.io/XamoraStudio/examples/DockingDemo.html.
