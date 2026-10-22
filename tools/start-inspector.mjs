#!/usr/bin/env node
// Reopen the local inspector without replacing the installed companion service or firmware.
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const url='http://127.0.0.1:4877/activity';
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<24 || (major===24 && minor<11)) {
 console.error('Use Node.js 24.11 or newer, then run npm run inspector again.');process.exit(1);
}
if(!existsSync(new URL('../daemon/dist/src/client.js',import.meta.url))) {
 console.log('Building the local daemon client…');
 const build=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['run','build','--prefix','daemon'],{cwd:root,stdio:'inherit'});
 if(build.status!==0){console.error('Install dependencies with npm ci --prefix daemon, then retry.');process.exit(1);}
}
const {requestDaemon}=await import('../daemon/dist/src/client.js');
try {
 const status=await requestDaemon({type:'activity'},3000);
 if(!status?.ok || !Array.isArray(status.events))throw Error('The service does not support activity diagnostics.');
} catch(error) {
 console.error('Start Agent Companion with this fork’s diagnostic runtime first. The inspector does not install or replace the service.');
 console.error(error.message);process.exit(1);
}
let existing=false;
try {
 const result=await fetch('http://127.0.0.1:4877/diagnostics',{signal:AbortSignal.timeout(1500)});
 const data=await result.json();existing=data.ok===true && Array.isArray(data.events);
} catch { /* No inspector is listening yet. */ }
if(existing)console.log('Inspector already running: '+url);
else {
 console.log('Activity inspector: '+url+'\nKeep this terminal open. Ctrl+C stops the inspector, not Agent Companion.');
 await import('../experiments/device-demo/server.mjs');
}
if(!process.argv.includes('--no-open')) {
 const {openBrowser}=await import('../daemon/dist/src/browser.js');
 if(!await openBrowser(url))console.log('Open this URL in your browser: '+url);
}
