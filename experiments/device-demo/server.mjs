// Operator controls only. The daemon owns the demo clock and display isolation.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {requestDaemon} from '../../daemon/dist/src/client.js';
const port=4877, origin=`http://127.0.0.1:${port}`;
const page=await readFile(new URL('./index.html',import.meta.url));
const actions=new Set(['stage','start','pause','next','restart','exit']);
createServer(async(req,res)=>{
 try {
  if(req.headers.host!==`127.0.0.1:${port}` || (req.headers.origin && req.headers.origin!==origin)) {
   res.writeHead(403).end();return;
  }
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  if(req.method==='GET' && req.url==='/'){res.writeHead(200,{'Content-Type':'text/html'}).end(page);return;}
  if(req.method==='GET' && req.url==='/activity') {
   res.writeHead(200,{'Content-Type':'text/html'}).end(await readFile(new URL('./activity.html',import.meta.url)));return;
  }
  if(req.method==='GET' && req.url==='/diagnostics') {
   res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(await requestDaemon({type:'activity'},5000)));return;
  }
  let command={type:'demo',action:'status'};
  if(req.method==='POST' && req.url==='/focus') {
   if(req.headers.origin!==origin || req.headers['content-type']!=='application/json') {res.writeHead(403).end();return;}
   let body='';for await(const chunk of req){body+=chunk;if(body.length>1024){res.writeHead(413).end();return;}}
   const input=JSON.parse(body);if(!['pin','next','activate'].includes(input.action)){res.writeHead(400).end();return;}
   const result=await requestDaemon({type:'focus',action:input.action},5000);
   res.writeHead(result.ok===false?400:200,{'Content-Type':'application/json'}).end(JSON.stringify(result));return;
  }
  if(req.method==='POST' && req.url==='/control') {
   if(req.headers.origin!==origin || req.headers['content-type']!=='application/json') {res.writeHead(403).end();return;}
   let body='';for await(const chunk of req){body+=chunk;if(body.length>4096){res.writeHead(413).end();return;}}
   const input=JSON.parse(body);
   if(!actions.has(input.action)) {res.writeHead(400).end();return;}
   command={type:'demo',action:input.action,...(input.action==='stage'?{context:input.context}:{})};
  } else if(!(req.method==='GET' && req.url==='/status')) {res.writeHead(404).end();return;}
  const result=await requestDaemon(command,5000);
  res.writeHead(result.ok===false?400:200,{'Content-Type':'application/json'}).end(JSON.stringify(result));
 } catch(error){res.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({error:error.message}));}
}).listen(port,'127.0.0.1',()=>console.log(`Device demo controls: ${origin}`));
