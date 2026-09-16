/** Run every real-browser suite; new runtime/compiler suites join the same gate. */
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const suites = (await readdir(new URL('../tests/', import.meta.url)))
  .filter((name) => /^browser-.*\.mjs$/.test(name))
  .sort();
for (const suite of suites) {
  console.log(`\nRunning ${suite}`);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`tests/${suite}`], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
  if (code) {
    process.exitCode = code;
    break;
  }
}
