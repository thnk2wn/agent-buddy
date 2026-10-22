#!/usr/bin/env node
// Optional setup utility. The background service handles device taps after this exits.
import {requestDaemon} from '../daemon/dist/src/client.js';
const [action='status',sessionId,terminalId]=process.argv.slice(2);
if(!['status','list','enable','disable','pair','unpair','open','auto-enable','auto-disable','discover'].includes(action)) {
 console.error('Usage: npm run session-launch -- status|list|enable|disable|auto-enable|auto-disable|discover <id>|pair <claude:session-id> <Ghostty-terminal-id>|unpair <id>|open <id>');
 process.exit(1);
}
try {
 const result=await requestDaemon({type:'sessionLaunch',action,sessionId,terminalId,adapter:'ghostty'},15000);
 if(result.ok===false)throw Error(result.error);
 console.log(JSON.stringify(result,null,2));
} catch(error){console.error(error.message);process.exitCode=1;}
