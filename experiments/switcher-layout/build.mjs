// Render the existing packs with the native engine; produce a portable layout study.
// This does not mutate packs, install firmware, or contact the companion service.
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,symlink,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {deflateSync} from 'node:zlib';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const packs=process.argv[2],out=process.argv[3];
if(!packs||!out)throw Error('Usage: node experiments/switcher-layout/build.mjs PACK_FOLDER OUTPUT_FOLDER');
await mkdir(out,{recursive:true});
const work=await mkdtemp(join(homedir(),'temp/buddy-layout-render-'));
function crc32(b){let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,sum]);}
function png(raw){
 const header=Buffer.alloc(13);header.writeUInt32BE(412);header.writeUInt32BE(466,4);header[8]=8;header[9]=2;
 const pixels=Buffer.alloc(466*(412*3+1));
 for(let y=0;y<466;y++)for(let x=0;x<412;x++){
  const v=raw.readUInt16BE((y*412+x)*2),p=y*(412*3+1)+1+x*3;
  pixels[p]=Math.round(((v>>11)&31)*255/31);pixels[p+1]=Math.round(((v>>5)&63)*255/63);pixels[p+2]=Math.round((v&31)*255/31);
 }
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
try{
 await mkdir(join(work,'build/characters'),{recursive:true});
 for(const id of ['jobot','jax'])await symlink(resolve(packs,id+'.acpk'),join(work,'build/characters',id+'.acpk'));
 const assets={};
 for(const id of ['jobot','jax']){
  assets[id]={};
  for(const [state,mode]of Object.entries({idle:0,working:2,attention:4,complete:3,sleep:5})){
   const commands=[`0 ${mode} 1 ${id} -1|`];for(let i=0;i<12;i++)commands.push(`0.1 -1 1 ${id} -1|`);
   const run=spawnSync(join(root,'build/caption-lab'),[],{cwd:work,input:commands.join('\n')+'\n',maxBuffer:16*1024*1024});
   if(run.status!==0)throw Error(run.stderr.toString()||'Renderer failed');
   let offset=0,frame;
   while(offset<run.stdout.length){const end=run.stdout.indexOf(10,offset);const header=run.stdout.subarray(offset,end).toString();if(!header.startsWith('OK '))throw Error(header);const bytes=Number(header.split(' ')[1]);frame=run.stdout.subarray(end+1,end+1+bytes);offset=end+1+bytes;}
   await writeFile(join(out,`${id}-${state}.rgb565`),frame);
   const image=png(frame);assets[id][state]='data:image/png;base64,'+image.toString('base64');
  }
 }
 const fontSource=await readFile(join(root,'firmware/AgentCompanion/src/CharacterEffects.cpp'),'utf8');
 const glyphs=Object.fromEntries([...fontSource.matchAll(/\{'(.)', \{([^}]+)\}\}/g)].map(m=>[m[1],m[2].split(',').map(v=>Number(v.trim()))]));
 const html=(await readFile(join(root,'experiments/switcher-layout/index.html'),'utf8')).replace('/*ASSETS*/',JSON.stringify(assets)).replace('/*GLYPHS*/',JSON.stringify(glyphs));
 await writeFile(join(out,'Switcher-layout-study.html'),html);
 console.log(join(out,'Switcher-layout-study.html'));
}finally{await rm(work,{recursive:true,force:true});}
