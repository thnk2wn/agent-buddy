import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {captionText} from './task-captions.js';

// Optional, read-only adapter for T3's local projection. Never match by cwd/title
// or rewrite provider metadata. Unknown schemas and ambiguous bindings fall back.
export function t3Title(home:string, agent:string, sessionId:string):string {
  const driver=agent==='claude'?'claudeAgent':agent==='codex'?'codex':null;
  if(!driver)return '';
  const path=join(home,'.t3','userdata','statev2.sqlite');
  if(!existsSync(path))return '';
  let db:DatabaseSync|undefined;
  try {
    db=new DatabaseSync(path,{readOnly:true});
    const rows=db.prepare(`SELECT DISTINCT t.thread_id, t.title
      FROM orchestration_v2_projection_provider_threads p
      JOIN orchestration_v2_projection_threads t ON t.thread_id=p.thread_id
      WHERE p.driver=? AND p.owner_node_id IS NULL AND t.deleted_at IS NULL
        AND json_extract(p.payload_json,'$.nativeThreadRef.nativeId')=?
        AND json_extract(p.payload_json,'$.nativeThreadRef.strength')='strong'
      LIMIT 2`).all(driver,sessionId);
    return rows.length===1 && typeof rows[0]!.title==='string' ? captionText(rows[0]!.title) : '';
  }catch {return '';}
  finally {db?.close();}
}
