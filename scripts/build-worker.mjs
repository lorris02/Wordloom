import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
const root = new URL('../', import.meta.url);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const assets={};
for(const file of await readdir(new URL('public/',root))){
  if(!types[path.extname(file)])continue;
  assets['/'+file]={content:await readFile(new URL('public/'+file,root),'utf8'),type:types[path.extname(file)]};
}
const handler=await readFile(new URL('cloudflare/worker.mjs',root),'utf8');
await mkdir(new URL('.deploy/',root),{recursive:true});
await writeFile(new URL('.deploy/worker.mjs',root),`${handler}\nconst assets=${JSON.stringify(assets)};\nexport default createWorker(assets);\n`);
console.log(`Built Wordloom Worker with ${Object.keys(assets).length} assets.`);
