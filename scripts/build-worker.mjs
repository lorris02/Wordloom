import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root = new URL('../', import.meta.url);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const assets={};
for(const file of await readdir(new URL('public/',root))){
  if(!types[path.extname(file)])continue;
  assets['/'+file]={content:await readFile(new URL('public/'+file,root),'utf8'),type:types[path.extname(file)]};
}
await mkdir(new URL('.deploy/',root),{recursive:true});
const frontend=await build({entryPoints:[fileURLToPath(new URL('public/app.js',root))],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:true});
assets['/app.js'].content=frontend.outputFiles[0].text;
await writeFile(new URL('.deploy/app.js',root),frontend.outputFiles[0].text);
const worker=await build({stdin:{contents:`import {createWorker} from './cloudflare/worker.mjs'; const assets=${JSON.stringify(assets)}; export default createWorker(assets);`,resolveDir:fileURLToPath(root)},bundle:true,write:false,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','browser','import'],external:['node:crypto'],target:'es2022',minify:true});
await writeFile(new URL('.deploy/worker.mjs',root),worker.outputFiles[0].text);
console.log(`Built Wordloom Worker with ${Object.keys(assets).length} assets.`);
