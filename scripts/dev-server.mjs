import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createApi } from '../src/api-core.mjs';
const data = new Map(); let version = 0;
const store = {
  async getWithMetadata(key) { const entry=data.get(key); return entry?{data:structuredClone(entry.data),etag:entry.etag}:null; },
  async setJSON(key,value,opts={}) { const old=data.get(key); if(opts.onlyIfNew && old)return {modified:false}; if(opts.onlyIfMatch && (!old || old.etag!==opts.onlyIfMatch))return {modified:false}; const etag=`"local-${++version}"`;data.set(key,{data:structuredClone(value),etag});return {modified:true,etag}; }
};
const api=createApi({store});
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/game'||url.pathname==='/.netlify/functions/game'){
    const response=await api(new Request(`http://localhost${req.url}`,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:await new Promise(resolve=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>resolve(b));})}));
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
  }
  const path=url.pathname==='/'?'/index.html':url.pathname;
  let safe=normalize(path).replace(/^([.][.][/\\])+/, '').replace(/^[/\\]/,'');
  if (safe === 'app.js') safe = 'src/app.js';
  try{const file=await readFile(join(process.cwd(),safe));res.writeHead(200,{'content-type':types[extname(safe)]||'application/octet-stream'});res.end(file)}catch{res.writeHead(404);res.end('Not found')}
});
server.listen(4173,'0.0.0.0',()=>console.log('Mafia local dev server: http://localhost:4173'));
