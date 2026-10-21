import {readFile, open, readdir, realpath} from 'node:fs/promises';
import {join, basename, sep} from 'node:path';
import {homedir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {codexHome, claudeHome} from './agents/homes.js';
import {CaptionPlayback, captionContextFromHook, captionText, wrapCaption, type CaptionMode} from './task-captions.js';
import type {CharacterState, HookPayload, HookEvent} from './protocol.js';
import type {PersistedCoordinatorState as PersistedState} from './state-coordinator.js';

interface Metadata {project: string; title: string}
interface Source {payload: HookPayload; explicit: Metadata}
export interface CaptionSettings {enabled: boolean; mode: CaptionMode; phrases: Partial<Record<CharacterState, string>>; idleAfterMs: number; idleMessages: string[]}
const phrases: Record<CharacterState, string> = {
  working: 'working', attention: 'needs input', complete: 'finished', idle: 'Ready', surprise: 'Hello there',
};

// Reads bounded metadata only; never interprets prompt/tool text as a task title.
async function tail(path: string, limit = 2 * 1024 * 1024): Promise<string> {
  const file = await open(path, 'r');
  try {
    const size = (await file.stat()).size;
    const start = Math.max(0, size - limit);
    const buffer = Buffer.alloc(Math.min(size, limit));
    const {bytesRead} = await file.read(buffer, 0, buffer.length, start);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    return start ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {await file.close();}
}
function records(text: string): Record<string, unknown>[] {
  return text.split('\n').flatMap(line => {
    try {const item: unknown = JSON.parse(line); return item && typeof item === 'object' && !Array.isArray(item)
      ? [item as Record<string, unknown>] : [];} catch {return [];}
  });
}
function string(value: unknown): string {return typeof value === 'string' ? value : '';}

export async function sessionMetadata(agent: string, id: string, payload: HookPayload,
    home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<Metadata> {
  const result = captionContextFromHook(payload);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return result;
  if (agent === 'codex') {
    const folder = codexHome(home, env);
    // The desktop's `name` is the sidebar title. Its `title` can be the full first prompt.
    const databases = (await readdir(folder).catch(() => []))
      .filter(name => /^state_\d+\.sqlite$/.test(name)).sort((a,b) => b.localeCompare(a, undefined, {numeric:true}));
    for (const name of databases) {
      let db: DatabaseSync | undefined;
      try {
        db = new DatabaseSync(join(folder, name), {readOnly: true});
        const row = db.prepare('SELECT name, cwd FROM threads WHERE id = ?').get(id);
        if (row) {
          result.title ||= captionText(string(row.name));
          result.project ||= captionText(basename(string(row.cwd)));
          break;
        }
      } catch { /* CLI versions without a name column fall back to the explicit title index. */ }
      finally {db?.close();}
    }
    if (!result.title) {
      const rows = records(await tail(join(folder, 'session_index.jsonl')).catch(() => ''));
      for (const row of rows) if (row.id === id && typeof row.thread_name === 'string')
        result.title = captionText(row.thread_name);
    }
  } else if (agent === 'claude') {
    const root = join(claudeHome(home, env), 'projects');
    const cwd = string(payload.cwd);
    const transcript = string(payload.transcript_path);
    const candidate = transcript || (cwd ? join(root, cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`) : '');
    // Only this session's transcript under Claude's own projects directory is eligible.
    const [resolved, base] = await Promise.all([realpath(candidate).catch(() => ''), realpath(root).catch(() => '')]);
    if (resolved && base && resolved.startsWith(base + sep) && basename(resolved) === `${id}.jsonl`) {
      for (const row of records(await tail(resolved).catch(() => '')))
        if (row.type === 'custom-title' && row.sessionId === id && typeof row.customTitle === 'string')
          result.title = captionText(row.customTitle);
    }
  }
  return result;
}

export class LiveCaptions {
  #settings: CaptionSettings = {enabled:false, mode:'pages', phrases:{}, idleAfterMs:60000, idleMessages:[]};
  #sources = new Map<string, Source>();
  #metadata = new Map<string, Metadata>();
  #selected = '';
  #promptSession = '';
  #selectedUntil = 0;
  #idleSince: number | null = null;
  #playback = new CaptionPlayback();
  #refreshing = false;
  constructor(readonly configPath: string, readonly home = homedir(), readonly env = process.env) {}
  observe(payload: HookPayload, event?: HookEvent): void {
    const id = string(payload.sessionId);
    if (!id) return;
    if (event === 'userPromptSubmitted') this.#promptSession = id;
    // Keep only metadata fields: never retain prompts, commands or tool arguments.
    const previous = this.#sources.get(id);
    const safe: HookPayload = {sessionId:id};
    for (const key of ['cwd','transcript_path','projectName','project_name','sessionTitle','session_title','threadTitle','thread_title'])
      if (typeof payload[key] === 'string') safe[key] = payload[key];
    const merged = {...previous?.payload, ...safe};
    this.#sources.set(id, {payload:merged, explicit:captionContextFromHook(merged)});
  }
  async refresh(snapshot: PersistedState): Promise<void> {
    if (this.#refreshing) return;
    this.#refreshing = true;
    try {
      try {
        const value = JSON.parse(await readFile(this.configPath, 'utf8'));
        this.#settings = {enabled:value.enabled === true,
          mode:['pages','ticker'].includes(value.mode) ? value.mode : 'pages',
          idleAfterMs:Number.isFinite(value.idleAfterSeconds) ? Math.max(15, Math.min(3600,value.idleAfterSeconds))*1000 : 60000,
          idleMessages:Array.isArray(value.idleMessages) ? value.idleMessages.filter((v:unknown) => typeof v === 'string').slice(0,16).map(captionText).filter(Boolean) : [],
          phrases:Object.fromEntries(Object.entries(value.phrases ?? {}).filter(([key,value]) =>
            key in phrases && typeof value === 'string').map(([key,value]) => [key, captionText(value as string)]))};
      } catch {this.#settings = {enabled:false,mode:'pages',phrases:{},idleAfterMs:60000,idleMessages:[]};}
      const ids = new Set(snapshot.sessions.map(session => session.id));
      for (const id of this.#sources.keys()) if (!ids.has(id)) this.#sources.delete(id);
      for (const id of this.#metadata.keys()) if (!ids.has(id)) this.#metadata.delete(id);
      if (!this.#settings.enabled) return;
      // Bound metadata reads; attention and most recently active sessions take priority.
      const sessions = [...snapshot.sessions].sort((a,b) => b.attentionUntil-a.attentionUntil || b.lastSeenAt-a.lastSeenAt).slice(0,16);
      for (const session of sessions) {
        const colon = session.id.indexOf(':');
        if (colon < 0) continue;
        const source = this.#sources.get(session.id);
        this.#metadata.set(session.id, await sessionMetadata(session.id.slice(0,colon), session.id.slice(colon+1),
          source?.payload ?? {}, this.home, this.env).catch(() => source?.explicit ?? {project:'',title:''}));
      }
    } finally {this.#refreshing = false;}
  }
  lines(state: CharacterState, snapshot: PersistedState, now = Date.now(), drivers: readonly string[] = []): string[] | null {
    if (state === 'idle') this.#idleSince ??= now;
    else this.#idleSince = null;
    if (!this.#settings.enabled) return null;
    if (state === 'idle') {
      const elapsed = now - this.#idleSince! - this.#settings.idleAfterMs;
      const messages = this.#settings.idleMessages;
      // Alternate a quiet idle message with the normal token display after a minute.
      if (elapsed >= 0 && messages.length && elapsed % 10000 < 5000)
        return wrapCaption(messages[Math.floor(elapsed / 10000) % messages.length]!).slice(0,2);
      return null;
    }
    if (!['working','attention','complete'].includes(state)) return null;
    const eligible = snapshot.sessions.filter(session => state === 'attention' ? session.attentionUntil > now
      : state === 'working' ? session.activeUntil > now || session.subagents.some(agent => agent.leaseUntil > now)
      : drivers.includes(session.id.split(':')[0] ?? '')).sort((a,b) => b.lastSeenAt-a.lastSeenAt);
    // A new user prompt wins immediately; background tool bursts cannot steal its title.
    // Without a prompt event (e.g. after restart), follow recent activity in readable chunks.
    const prompted = eligible.find(session => session.id === this.#promptSession);
    const held = now < this.#selectedUntil ? eligible.find(session => session.id === this.#selected) : undefined;
    const selected = prompted ?? held ?? eligible[0];
    if (!selected) return null;
    if (selected.id !== this.#selected) this.#selectedUntil = now + 5000;
    this.#selected = selected.id;
    const metadata = this.#metadata.get(selected.id) ?? this.#sources.get(selected.id)?.explicit;
    const agent = selected.id.split(':')[0] ?? '';
    const name = ({codex:'Codex',claude:'Claude',copilot:'Copilot',grok:'Grok',hermes:'Hermes',openclaw:'OpenClaw'} as Record<string,string>)[agent] || agent;
    return this.#playback.frame({status:`${name} ${this.#settings.phrases[state] || phrases[state]}`,
      project:metadata?.project || agent, title:metadata?.title || ''}, now, this.#settings.mode).lines;
  }
}
