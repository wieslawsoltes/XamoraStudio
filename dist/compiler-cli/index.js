#!/usr/bin/env node
/** Node entrypoint for the shared semantic compiler. No browser globals are installed. */
import { lstat, readFile, readdir, realpath, mkdir, open, unlink } from 'node:fs/promises';
import { resolve, relative, dirname, basename, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePath } from '../core/solution.js';
import { preloadCompilerStylesheets } from '../core/compiler-resources.js';
import { compilerStylesheetUrl } from '../core/compiler-css.js';
import { collectReferencedAssets } from './assets.js';

export const HELP = `Xamora semantic document converter

Usage: xamora-convert <file|folder|solution.json> --to html|xaml --out-dir <folder>

  --from auto|xaml|html       Filter input format (default: auto)
  --to html|xaml             Target document format (required)
  --framework WPF|Avalonia   XAML dialect (default: WPF)
  --out-dir <folder>         Output root; existing files are never overwritten
  --solution                Treat input as a solution / conversion manifest
  --strict                  Reject conversions with semantic losses
  --no-metadata             Omit round-trip metadata from generated documents
  --viewport <width>x<height> Evaluate responsive CSS at this CSS-pixel viewport
  --media screen|print      Media type (default: screen when a viewport is supplied)
  --dry-run                 Compile and report without creating files
  --report <file|->          JSON report destination; '-' writes to stdout
  --help                    Display help

Folders are scanned recursively in path order. Symlinks are not followed.
The output folder is excluded from scanning. Referenced local assets are copied,
including CSS imports and URLs. All conversions must succeed before any output
is written. A report is saved beside output by default.
`;

const SOURCE_LIMIT = 2_000_000;
const directoryExclusions = new Set(['node_modules', '.git', '.svn', '.hg']);
const sourceFormat = (path) =>
  /\.(?:xaml|axaml|xml)$/i.test(path) ? 'xaml' : /\.html?$/i.test(path) ? 'html' : null;
const comparePaths = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const containsPath = (root, path) => {
  const value = relative(root, path);
  return !value || (!value.startsWith('..' + sep) && value !== '..' && !isAbsolute(value));
};
const displayError = (error) => (error instanceof Error ? error.message : String(error));

/** Parse arguments without touching the filesystem. */
export function parseArguments(argv) {
  const options = {
    from: 'auto',
    framework: 'WPF',
    preserveMetadata: true,
    strict: false,
    dryRun: false,
    solution: false,
  };
  const values = new Map([
    ['--from', 'from'],
    ['--to', 'to'],
    ['--framework', 'framework'],
    ['--out-dir', 'outDir'],
    ['--report', 'report'],
    ['--viewport', 'viewport'],
    ['--media', 'media'],
  ]);
  let positional = false;
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === '--' && !positional) {
      positional = true;
      continue;
    }
    if (!positional && argument === '--help') {
      options.help = true;
      continue;
    }
    if (
      !positional &&
      ['--strict', '--dry-run', '--solution', '--no-metadata'].includes(argument)
    ) {
      if (argument === '--strict') options.strict = true;
      if (argument === '--dry-run') options.dryRun = true;
      if (argument === '--solution') options.solution = true;
      if (argument === '--no-metadata') options.preserveMetadata = false;
      continue;
    }
    if (!positional && values.has(argument)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw Error('Missing value for ' + argument + '.');
      options[values.get(argument)] = value;
      continue;
    }
    if (!positional && argument.startsWith('-')) throw Error('Unknown option: ' + argument + '.');
    if (options.input) throw Error('Choose one input file, folder, or solution manifest.');
    options.input = argument;
  }
  if (options.help) return options;
  if (!options.input) throw Error('An input file, folder, or solution manifest is required.');
  if (!['html', 'xaml'].includes(options.to)) throw Error('--to must be html or xaml.');
  if (!['auto', 'html', 'xaml'].includes(options.from))
    throw Error('--from must be auto, html, or xaml.');
  if (!['WPF', 'Avalonia'].includes(options.framework))
    throw Error('--framework must be WPF or Avalonia.');
  if (!options.outDir && !options.dryRun)
    throw Error('--out-dir is required unless --dry-run is used.');
  if (options.dryRun && options.report && options.report !== '-')
    throw Error('--dry-run writes no files; use --report - for a JSON report.');
  if (options.viewport) {
    const match = options.viewport.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/);
    if (!match || !match.slice(1).every((v) => Number(v) > 0 && Number(v) <= 100000))
      throw Error('--viewport must be positive WIDTHxHEIGHT in CSS pixels (maximum 100000).');
    options.environment = {
      width: Number(match[1]),
      height: Number(match[2]),
      type: options.media || 'screen',
    };
  }
  if (options.media && !['screen', 'print'].includes(options.media))
    throw Error('--media must be screen or print.');
  if (options.media && !options.environment) options.environment = { type: options.media };
  return options;
}

async function statIfPresent(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Reject symlinks in an output path, including pre-existing parent directories. */
async function checkOutputPath(path) {
  let cursor = resolve(path);
  let first = true;
  while (true) {
    const stat = await statIfPresent(cursor);
    if (stat?.isSymbolicLink())
      throw Error('Output paths must not contain symbolic links: ' + cursor);
    if (first && stat) throw Error('Output already exists; choose an empty destination: ' + cursor);
    if (!first && stat && !stat.isDirectory())
      throw Error('Output parent is not a directory: ' + cursor);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    first = false;
    cursor = parent;
  }
}

async function readSource(path, limit = SOURCE_LIMIT) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw Error('Input must be a regular file: ' + path);
  if (stat.size > limit * 4)
    throw Error('Input exceeds the ' + limit + ' character limit: ' + path);
  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path));
  } catch (error) {
    if (error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA')
      throw Error('Input is not valid UTF-8 text: ' + path);
    throw error;
  }
  if (source.length > limit)
    throw Error('Input exceeds the ' + limit + ' character limit: ' + path);
  return source;
}

async function manifestFile(root, path) {
  const normalized = normalizePath(path);
  const absolute = resolve(root, normalized);
  const canonicalRoot = await realpath(root);
  let cursor = root;
  for (const part of normalized.split('/')) {
    cursor = resolve(cursor, part);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink())
      throw Error('Manifest paths must not contain symbolic links: ' + path);
  }
  if (!containsPath(canonicalRoot, await realpath(absolute)))
    throw Error('Manifest input escapes its folder: ' + path);
  return readSource(absolute);
}

/** Collect sources; manifest paths always remain relative to the manifest folder. */
export async function collectConversionEntries(
  input,
  { cwd = process.cwd(), from = 'auto', solution = false, outDir } = {},
) {
  const absolute = resolve(cwd, input);
  const stat = await lstat(absolute);
  if (stat.isSymbolicLink()) throw Error('Input must not be a symbolic link: ' + input);
  const entries = [],
    skipped = [];
  const accept = (entry) => {
    entry.path = normalizePath(entry.path);
    const format =
      entry.framework === 'HTML'
        ? 'html'
        : sourceFormat(entry.path) || (entry.framework ? 'xaml' : null);
    if (!format) {
      skipped.push({ path: entry.path, reason: 'Unsupported file extension.' });
      return;
    }
    if (from !== 'auto' && format !== from) {
      skipped.push({ path: entry.path, reason: 'Excluded by --from.' });
      return;
    }
    entries.push({
      ...entry,
      id: entry.id || entry.path,
      framework: entry.framework || (format === 'html' ? 'HTML' : 'WPF'),
    });
  };
  if (stat.isDirectory()) {
    const excludedOutput = outDir ? resolve(cwd, outDir) : null;
    if (excludedOutput === absolute)
      throw Error('The output folder must differ from the input folder.');
    const scan = async (folder) => {
      const items = (await readdir(folder, { withFileTypes: true })).sort((a, b) =>
        comparePaths(a.name, b.name),
      );
      for (const item of items) {
        const full = resolve(folder, item.name),
          path = relative(absolute, full).split(sep).join('/');
        if (excludedOutput && containsPath(excludedOutput, full)) continue;
        if (item.isSymbolicLink()) {
          skipped.push({ path, reason: 'Symbolic link was not followed.' });
          continue;
        }
        if (item.isDirectory()) {
          if (!directoryExclusions.has(item.name)) await scan(full);
          continue;
        }
        if (!item.isFile() || !sourceFormat(path)) continue;
        if (from !== 'auto' && sourceFormat(path) !== from) {
          skipped.push({ path, reason: 'Excluded by --from.' });
          continue;
        }
        accept({ path, source: await readSource(full) });
      }
    };
    await scan(absolute);
  } else if (stat.isFile() && (solution || /(?:\.json|\.xamora)$/i.test(absolute))) {
    const manifest = JSON.parse(await readSource(absolute, 15_000_000));
    if (manifest.format === 'xamora-workspace' && Array.isArray(manifest.documents)) {
      for (const document of manifest.documents) {
        if (!document || typeof document !== 'object' || !document.root)
          throw Error('Invalid document in Xamora workspace.');
        accept({
          id: document.id,
          path: document.metadata?.solutionPath || document.name,
          document,
          framework: document.framework,
        });
      }
    } else if (
      manifest.format === 'xamora-conversion' &&
      manifest.version === 1 &&
      Array.isArray(manifest.files)
    ) {
      for (const item of manifest.files) {
        const entry = typeof item === 'string' ? { path: item } : item;
        if (!entry || typeof entry !== 'object')
          throw Error(
            'Manifest files must be paths or objects containing path and optional source.',
          );
        const path = normalizePath(entry.path);
        if (entry.source !== undefined && typeof entry.source !== 'string')
          throw Error('Embedded source must be text: ' + path);
        if (entry.source?.length > SOURCE_LIMIT)
          throw Error('Embedded source exceeds the 2 MB text limit: ' + path);
        const source = entry.source ?? (await manifestFile(dirname(absolute), path));
        accept({ path, source, framework: entry.framework });
      }
    } else throw Error('Expected a Xamora workspace or a version 1 xamora-conversion manifest.');
  } else if (stat.isFile()) {
    if (!sourceFormat(absolute))
      throw Error('Input must be a .xaml, .axaml, .xml, .html, or .htm document.');
    accept({ path: basename(absolute), source: await readSource(absolute) });
  } else throw Error('Input must be a file or folder.');
  const paths = new Set();
  for (const entry of entries) {
    const key = entry.path.toLowerCase();
    if (paths.has(key)) throw Error('Duplicate manifest path: ' + entry.path);
    paths.add(key);
  }
  entries.sort((a, b) => comparePaths(a.path, b.path));
  skipped.sort((a, b) => comparePaths(a.path, b.path));
  return { entries, skipped, root: stat.isDirectory() ? absolute : dirname(absolute) };
}

async function loadNodeParser() {
  try {
    const { Window } = await import('happy-dom');
    const window = new Window({
      settings: {
        disableJavaScriptEvaluation: true,
        disableCSSFileLoading: true,
        disableJavaScriptFileLoading: true,
        enableFileSystemHttpRequests: false,
      },
    });
    return window.DOMParser;
  } catch (error) {
    throw Error(
      'HTML conversion requires the compiler package dependency happy-dom. Run npm install before using HTML inputs. ' +
        displayError(error),
    );
  }
}

function makeReport(plan, collected, options, assets) {
  return {
    format: 'xamora-conversion-report',
    version: 1,
    dryRun: options.dryRun,
    target: options.to,
    framework: options.framework,
    strict: options.strict,
    success:
      !plan.entries.some((entry) => entry.status === 'failed') &&
      !(options.strict && assets.diagnostics.length),
    summary: {
      ...plan.summary,
      inputSkipped: collected.skipped.length,
      assets: assets.files.length,
      assetWarnings: assets.diagnostics.length,
    },
    entries: plan.entries.map((entry) => ({
      sourcePath: entry.sourcePath,
      targetPath: entry.targetPath,
      status: entry.status,
      diagnostics: entry.diagnostics || entry.result?.diagnostics || [],
      losses: entry.result?.losses || [],
      sourceMap: entry.result?.sourceMap || [],
    })),
    skippedInputs: collected.skipped,
    assets: assets.files.map((file) => ({ path: file.path, bytes: file.content.length })),
    assetDiagnostics: assets.diagnostics,
  };
}

async function validateNewFiles(files) {
  const seen = new Set();
  for (const file of files) {
    const key = file.path.toLowerCase();
    if (seen.has(key)) throw Error('Two outputs resolve to the same file: ' + file.path);
    seen.add(key);
    await checkOutputPath(file.path);
  }
}

async function writeNewFiles(files) {
  await validateNewFiles(files);
  const created = [];
  try {
    for (const file of files) {
      await mkdir(dirname(file.path), { recursive: true });
      // Recheck parent links after creation. Exclusive open also protects against
      // an output appearing between planning and writing.
      await checkOutputPath(file.path);
      const handle = await open(file.path, 'wx', 0o644);
      created.push(file.path);
      try {
        await handle.writeFile(file.content, 'utf8');
      } finally {
        await handle.close();
      }
    }
  } catch (error) {
    const rollback = await Promise.allSettled(created.map((path) => unlink(path)));
    const incomplete = rollback.some((result) => result.status === 'rejected');
    throw Error(
      displayError(error) +
        (incomplete
          ? ' Some new output files could not be removed; inspect the destination.'
          : ' No converted files were retained.'),
    );
  }
}

/** Execute a complete batch. Return an exit code; importing this module does not execute it. */
export async function runCli(
  argv,
  {
    cwd = process.cwd(),
    stdout = (text) => process.stdout.write(text),
    stderr = (text) => process.stderr.write(text),
    planner,
    Parser,
  } = {},
) {
  let options, report;
  try {
    options = parseArguments(argv);
    if (options.help) {
      stdout(HELP);
      return 0;
    }
    const collected = await collectConversionEntries(options.input, { ...options, cwd });
    if (!collected.entries.length)
      throw Error('No supported input documents matched the requested format.');
    if (!planner)
      ({ planProjectConversion: planner } = await import('../core/conversion-project.js'));
    if (
      !Parser &&
      collected.entries.some(
        (entry) => entry.framework === 'HTML' && typeof entry.source === 'string',
      )
    )
      Parser = await loadNodeParser();
    let stylesheets = new Map();
    for (const entry of collected.entries)
      if (entry.framework === 'HTML') {
        const input = entry.source ?? entry.document;
        if (!input) continue;
        stylesheets = await preloadCompilerStylesheets(input, {
          Parser,
          stylesheets,
          environment: options.environment,
          baseUrl: compilerStylesheetUrl(entry.path),
          allowMissingStylesheets: true,
          async loadStylesheet(url) {
            const parsed = new URL(url);
            if (parsed.origin !== 'https://xamora.invalid') return undefined;
            const path = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
            try {
              return await manifestFile(collected.root, path);
            } catch (error) {
              if (error.code === 'ENOENT') return undefined;
              throw error;
            }
          },
        });
      }
    const plan = planner(collected.entries, {
      to: options.to,
      framework: options.framework,
      scope: 'solution',
      outputFolder: '',
      collision: 'error',
      preserveMetadata: options.preserveMetadata,
      strict: options.strict,
      environment: options.environment,
      stylesheets,
      Parser,
    });
    const assets = await collectReferencedAssets(plan, collected.root);
    report = makeReport(plan, collected, options, assets);
    const json = JSON.stringify(report, null, 2) + '\n';
    const ready = plan.entries.filter((entry) => entry.status === 'ready');
    if (!report.success) {
      if (options.report === '-') stdout(json);
      else stderr(json);
      stderr('Conversion failed; no output files were written.\n');
      return 1;
    }
    const files = ready.map((entry) => {
      const path = normalizePath(entry.targetPath);
      const content = entry.result?.source ?? entry.source;
      if (typeof content !== 'string')
        throw Error('Compiler returned no source for ' + entry.sourcePath + '.');
      return { path: resolve(cwd, options.outDir || '.', path), content };
    });
    for (const asset of assets.files)
      files.push({
        path: resolve(cwd, options.outDir || '.', normalizePath(asset.path)),
        content: asset.content,
      });
    if (options.outDir && options.report !== '-')
      files.push({
        path: options.report
          ? resolve(cwd, options.report)
          : resolve(cwd, options.outDir, 'conversion-report.json'),
        content: json,
      });
    if (!options.dryRun) {
      await writeNewFiles(files);
    } else if (options.outDir) await validateNewFiles(files);
    if (options.report === '-') stdout(json);
    if (options.report !== '-') {
      stdout(
        `${options.dryRun ? 'Dry run: ' : ''}${ready.length} document(s) ${options.dryRun ? 'ready' : 'converted'}, ${plan.summary.skipped || 0} skipped, ${plan.summary.losses || 0} semantic loss(es).\n`,
      );
      for (const entry of plan.entries) {
        stdout(
          `${entry.status}: ${entry.sourcePath}${entry.targetPath ? ' → ' + entry.targetPath : ''}\n`,
        );
        for (const diagnostic of entry.diagnostics || entry.result?.diagnostics || [])
          stdout(
            `  ${diagnostic.severity || 'info'}: ${diagnostic.message || diagnostic.code || JSON.stringify(diagnostic)}\n`,
          );
      }
      for (const diagnostic of assets.diagnostics)
        stdout(`  warning: ${diagnostic.path}: ${diagnostic.message}\n`);
      if (assets.files.length)
        stdout(
          `${assets.files.length} referenced asset(s) ${options.dryRun ? 'will be copied' : 'copied'}.\n`,
        );
      if (options.dryRun) stdout('No files were written.\n');
    }
    return 0;
  } catch (error) {
    if (options?.report === '-')
      stdout(
        JSON.stringify(
          {
            ...report,
            format: 'xamora-conversion-report',
            version: 1,
            success: false,
            error: { code: 'CLI_INPUT_OUTPUT', message: displayError(error) },
          },
          null,
          2,
        ) + '\n',
      );
    stderr('xamora-convert: ' + displayError(error) + '\n');
    return 2;
  }
}

const invokedPath = process.argv[1]
  ? await realpath(resolve(process.argv[1])).catch(() => null)
  : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
