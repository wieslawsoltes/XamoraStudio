import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';
const paths = Array.from({ length: 9 }, (_, i) => `tools/browser-window-data${i}.txt`);
const patch = brotliDecompressSync(Buffer.from(paths.map(path => readFileSync(path, 'utf8').trim()).join(''), 'base64'));
if (createHash('sha256').update(patch).digest('hex') !== '0ffaa224a7ab3b656a9a0967f7e8a661cf4365ed850fbc240ceb122da7ee5158') throw Error('Browser-window patch checksum mismatch');
execFileSync('git', ['apply', '--index', '-'], { input: patch, stdio: ['pipe', 'inherit', 'inherit'] });
paths.forEach(path => unlinkSync(path));
