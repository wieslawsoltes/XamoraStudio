# Semantic conversion from the command line

The `xamora-convert` executable uses the same semantic compiler and batch planner as the Studio conversion panel. It converts XAML and HTML documents without launching the designer. The compiler package includes its Node HTML parser; source scripts are not evaluated during conversion.

The npm publishing workflow is configured but these packages have not been published as part of this implementation. From the repository, run the CLI with `node dist/compiler-cli/index.js`. After installing a locally packed compiler package, run `xamora-convert` or `npx --no-install xamora-convert`.

```sh
# Convert one XAML document into a separate output directory.
node dist/compiler-cli/index.js Views/MainWindow.xaml --to html --out-dir converted

# Inspect a complete folder without writing any files.
node dist/compiler-cli/index.js src --from xaml --to html --dry-run --report -

# Convert a folder to Avalonia XAML, preserving relative paths.
node dist/compiler-cli/index.js pages --from html --to xaml --framework Avalonia --out-dir generated

# Convert an exported Studio solution; reject semantic losses.
node dist/compiler-cli/index.js MySolution.xamora.json --to html --out-dir generated --strict

# Save a report to an explicit, new destination.
node dist/compiler-cli/index.js Views --to html --out-dir generated --report reports/conversion.json
```

## Inputs and manifests

A single document may use `.xaml`, `.axaml`, `.xml`, `.html`, or `.htm`. Folder conversion scans these extensions recursively in deterministic path order. It excludes `.git`, `.svn`, `.hg`, `node_modules`, and the selected output directory. Symbolic links are reported and skipped during folder scanning.

An exported Studio workspace (`format: "xamora-workspace"`) supplies the existing universal AST documents directly to the shared planner. Document names and `metadata.solutionPath` determine the output paths. Invalid source drafts remain failures rather than silently falling back to an older valid tree.

For build automation, a portable manifest can combine relative files and inline sources:

```json
{
  "format": "xamora-conversion",
  "version": 1,
  "files": [
    "Views/MainWindow.xaml",
    {
      "path": "Views/Inline.xaml",
      "framework": "Avalonia",
      "source": "<StackPanel xmlns=\"https://github.com/avaloniaui\"><TextBlock Text=\"Hello\"/></StackPanel>"
    }
  ]
}
```

File paths resolve relative to the manifest. Paths must be portable relative solution paths: absolute paths, drive prefixes, traversal segments, duplicate names ignoring case, and symbolic link traversal are rejected. Source and manifest files must contain valid UTF-8 text; invalid byte sequences cause a failure before any output is written. Inline source text is limited to two million characters per document; manifests are limited to fifteen million characters.

## Output and diagnostics

The CLI preserves the folder structure beneath the input root and changes the document extension to `.html` or `.xaml`. Documents already using the requested target language are skipped. A source name collision is reported as a failure; use `--from` to select one input language in folders containing both original and converted documents.

Generated output includes portable round-trip metadata by default. `--no-metadata` removes that metadata. Review compiler diagnostics before omitting metadata when the source contains controls, native properties, external styles, bindings, or scripts that have no equivalent in the target format. `--strict` rejects conversions with semantic losses and unresolved local asset references.

Referenced local images, fonts, stylesheets, and other static element URLs are copied into corresponding output paths. CSS `@import` and `url(...)` references are followed recursively. Binary assets retain their exact bytes. Assets must remain within the input root and cannot traverse symbolic links. External, root-relative, and data URLs stay unchanged. Dynamic script imports, computed URLs, and filesystem paths outside the input root require application integration; they are not fetched or executed. A `srcset` mixing data URLs and local candidates produces an asset warning for manual review.

All documents are planned and compiled before any converted file is written. Existing output files are never overwritten, including report files and assets. The CLI preflights every destination, writes with exclusive file creation, and removes files created by the current batch if a later write fails. This protects against ordinary input, conversion, and write failures; it is not a crash-atomic filesystem transaction. Empty directories may remain after a failed write.

`--out-dir` accepts an absolute path or a path relative to the current working directory. An existing directory may contain unrelated files; those files remain unchanged. The input and output directory cannot be identical. Existing symbolic links in any output path component are rejected, including parent-directory links, and generated relative paths cannot contain traversal segments. Use the physical directory path when a platform exposes a directory through a symbolic link. These checks protect ordinary filesystem operations; the CLI does not claim isolation from another process actively replacing directories during a write.

`--dry-run` writes neither documents, assets, reports, nor directories. With `--out-dir`, it also checks for existing destinations. Use `--report -` to return a JSON report on stdout; a file report is incompatible with dry-run mode. Successful conversions save `conversion-report.json` alongside generated files unless another report destination is selected. A failed batch prints its report without writing converted output.

Reports contain per-document source and target paths, readiness status, compiler diagnostics, semantic losses, source maps, copied asset paths and byte counts, and asset warnings. Exit codes are:

| Exit code | Meaning                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------- |
| `0`       | All selected conversions succeeded, or a dry run completed successfully.                                  |
| `1`       | A conversion failed or strict mode rejected semantic losses / unresolved assets.                          |
| `2`       | Invalid arguments, unreadable inputs, malformed manifests, destination conflicts, or filesystem failures. |

The shared AST, compiler, and batch planner remain browser-compatible. Filesystem access and the Node HTML parser are isolated in the compiler package's CLI entrypoint.

## Local external CSS, environments and native output

```sh
xamora-convert ./views --to xaml --out-dir ./converted --native --load-css \
  --viewport 900x700 --media-type screen --color-scheme light
```

`--load-css` is explicit opt-in. It reads linked sheets and recursive imports only
inside the collected project root, including safely encoded local filenames and
query-qualified references. Network URLs, absolute paths, root traversal,
symlinks, invalid UTF-8, missing files and oversized graphs are rejected before
output writes. Import cycles terminate and remain compiler diagnostics. A single
file uses its containing directory as the project root; convert the encompassing
folder when sheets live beside a sibling views directory.

`--viewport` sets media-query width/height in CSS pixels. `--media-type` supports
screen or print; `--color-scheme` supports light or dark. Unknown capabilities
still report conditional losses; CLI conversion does not pretend to render an
intrinsic browser layout. `--native` enables native property/layout adapters and
omits round-trip metadata. Existing `--strict`, `--dry-run`, JSON reports and
new-files-only atomic batch semantics continue to apply.
