import {existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
/** Launch npm's JavaScript CLI directly when available, including Windows. */
export function npmInvocation(args){
  const candidates=[process.env.npm_execpath,resolve(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js')];
  const cli=candidates.find(path=>path&&/\.(?:c?js|mjs)$/.test(path)&&existsSync(path));
  if(cli)return {command:process.execPath,args:[cli,...args]};
  if(process.platform==='win32')throw Error('Run this command through npm run so npm_execpath identifies the npm JavaScript CLI.');
  return {command:'npm',args};
}
