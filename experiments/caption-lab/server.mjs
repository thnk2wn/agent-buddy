// Local-only native renderer lab. No serial port, hooks, or installed app is accessed.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFile, mkdir, symlink, mkdtemp, rm, realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'../..');
const args=process.argv.slice(2);const packArg=args.indexOf('--packs');
if(packArg<0 || !args[packArg+1]) throw new Error('Usage: node experiments/caption-lab/server.mjs --packs /folder/with/jobot.acpk/and/jax.acpk');
const packDir=await realpath(args[packArg+1]);
const port=Number(process.env.CAPTION_LAB_PORT||4876);
await mkdir(join(homedir(),'temp'),{recursive:true});
const work=await mkdtemp(join(homedir(),'temp/agent-buddy-caption-lab-'));
await mkdir(join(work,'build/characters'),{recursive:true});
for(const name of ['jobot','jax']) await symlink(join(packDir,`${name}.acpk`),join(work,`build/characters/${name}.acpk`));
const native=spawn(join(root,'build/caption-lab'),[],{cwd:work,stdio:['pipe','pipe','inherit']});
let buffer=Buffer.alloc(0),pending=null,failed=null;
function drain(){
 if(!pending)return;
 const end=buffer.indexOf(10);if(end<0)return;
 const header=buffer.subarray(0,end).toString();
 if(!header.startsWith('OK ')){failed=new Error(header);pending.reject(failed);pending=null;return;}
 const size=Number(header.split(' ')[1]);
 if(size!==412*466*2){failed=new Error('Invalid native frame size');pending.reject(failed);pending=null;return;}
 if(buffer.length<end+1+size)return;
 const frame=buffer.subarray(end+1,end+1+size);buffer=buffer.subarray(end+1+size);
 pending.resolve(frame);pending=null;
}
native.stdout.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);drain();});
function fail(error){failed=error;pending?.reject(error);pending=null;}
native.on('error',fail);native.on('exit',code=>fail(new Error(`Native renderer exited: ${code}`)));
let queue=Promise.resolve();
function render(command){
 const result=queue.then(()=>new Promise((resolve,reject)=>{
  if(failed){reject(failed);return;}
  const timer=setTimeout(()=>{fail(new Error('Native renderer timeout'));native.kill();},5000);
  pending={resolve:x=>{clearTimeout(timer);resolve(x);},reject:e=>{clearTimeout(timer);reject(e);}};
  native.stdin.write(command+'\n');drain();
 }));queue=result.catch(()=>{});return result;
}
const routes=new Map([['/',['index.html','text/html']],['/task-captions.js',['../../daemon/dist/src/task-captions.js','text/javascript']]]);
for(const name of ['working','needs-attention','complete','surprise','settings-tick']) routes.set(`/audio/${name}.wav`,[`../../assets/audio/${name}.wav`,'audio/wav']);
const server=createServer(async(req,res)=>{
 try{
  const host=`127.0.0.1:${port}`;
  if(req.headers.host!==host || (req.headers.origin && req.headers.origin!==`http://${host}`)){res.writeHead(403).end();return;}
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='POST' && req.url==='/frame'){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>4096){res.writeHead(413).end();return;}}
   const data=JSON.parse(body);
   if(!['jax','jobot'].includes(data.character)||!Number.isInteger(data.mode)||data.mode< -1||data.mode>5
      ||!Number.isFinite(data.dt)||data.dt<0||data.dt>0.25||!Array.isArray(data.lines)||data.lines.length>2
      ||data.lines.some(x=>typeof x!=='string'||!/^[a-zA-Z0-9 ,.:]{1,18}$/.test(x))){res.writeHead(400).end('Invalid frame request');return;}
   const frame=await render(`${data.dt} ${data.mode} 1 ${data.character} -1|${data.lines.join('|')}`);
   res.writeHead(200,{'Content-Type':'application/octet-stream'}).end(frame);return;
  }
  const route=routes.get(req.url);
  if(req.method!=='GET'||!route){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':route[1]});res.end(await readFile(resolve(here,route[0])));
 }catch(error){console.error(error.message);if(!res.headersSent)res.writeHead(500);res.end('Preview failed. See local server output.');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Caption lab: http://127.0.0.1:${port}/ (native renderer; no device connection)`));
async function close(){server.close();native.kill();await rm(work,{recursive:true,force:true});process.exit();}
process.on('SIGINT',close);process.on('SIGTERM',close);
