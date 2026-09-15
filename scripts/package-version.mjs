import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {layout,root} from './package-graph.mjs';
const version=process.argv[2];
if(process.argv.length!==3||! /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version||'') || (version?.split('-').slice(1).join('-').split('.').some(part=>/^0\d+$/.test(part))))throw Error('Usage: npm run version:packages -- 0.8.1 (updates manifests only; never tags or publishes)');
for(const path of [resolve(root,'package.json'),...(await layout()).map(item=>resolve(root,'packages',item.id,'package.json'))]){
  const manifest=JSON.parse(await readFile(path,'utf8'));manifest.version=version;
  for(const name of Object.keys(manifest.dependencies||{}))if(name.startsWith('@wieslawsoltes/xamora'))manifest.dependencies[name]=version;
  await writeFile(path,JSON.stringify(manifest,null,2)+'\n');
}
console.log(`Set package versions to ${version}. Run npm install --package-lock-only, then npm run release:check. No tag or publication created.`);
