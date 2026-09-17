import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
const paths = [0, 1, 2].map(i => `tools/docking-data${i}.txt`);
const patch = gunzipSync(Buffer.from(paths.map(path => readFileSync(path, 'utf8').trim()).join(''), 'base64'));
if (createHash('sha256').update(patch).digest('hex') !== 'a59ad9c159691dc1e5e863521173473c6287cad521447094f8c48b09bb4c3379') throw Error('Docking patch checksum mismatch');
execFileSync('git', ['apply', '--index', '-'], { input: patch, stdio: ['pipe', 'inherit', 'inherit'] });
paths.forEach(path => unlinkSync(path));
