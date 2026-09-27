const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const publicFiles=new Set(['index.html','Sammelbuch.html','data-model.js','cloud-store.js','sw.js','manifest.json','icon-192.svg','icon-512.svg']);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml'};
http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(!publicFiles.has(name)){res.writeHead(404);res.end('Not found');return;}
  fs.readFile(path.join(root,name),(error,data)=>{
    if(error){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':types[path.extname(name)],'Cache-Control':'no-store'});res.end(data);
  });
}).listen(4178,'127.0.0.1',()=>console.log('Sammelbuch: http://localhost:4178/Sammelbuch.html'));
