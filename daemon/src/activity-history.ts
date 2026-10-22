import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import type {ActivityEvent} from './state-coordinator.js';

// Only bounded routing metadata is persisted, never prompts, commands, messages or tool results.
export class ActivityHistory {
  #events: ActivityEvent[] = [];
  #timer: NodeJS.Timeout | undefined;
  #write = Promise.resolve();
  constructor(readonly path: string, readonly limit = 250) {}
  async load() {
    try {
      const rows: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (Array.isArray(rows)) this.#events = rows.slice(-this.limit).flatMap(row => {
        const clean = sanitize(row); return clean ? [clean] : [];
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[activity] Could not load recent history.');
    }
  }
  add(event: ActivityEvent) {
    const clean = sanitize(event); if (!clean) return;
    this.#events.push(clean); this.#events = this.#events.slice(-this.limit);
    this.#timer ??= setTimeout(() => {this.#timer = undefined; void this.flush();}, 250);
    this.#timer.unref();
  }
  recent() {return structuredClone(this.#events);}
  async flush() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    const text = JSON.stringify(this.#events) + '\n';
    this.#write = this.#write.then(async () => {
      await mkdir(dirname(this.path), {recursive:true,mode:0o700});
      const temporary = this.path + '.' + process.pid + '.tmp';
      await writeFile(temporary, text, {mode:0o600});
      await rename(temporary, this.path);
    }).catch(() => {console.error('[activity] Could not persist recent history.');});
    await this.#write;
  }
}
function sanitize(value: unknown): ActivityEvent | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const states = ['idle','surprise','working','complete','attention','sleep'];
  if (typeof v.at !== 'number' || !Number.isFinite(v.at) || typeof v.event !== 'string'
      || !states.includes(String(v.before)) || !states.includes(String(v.after)) || typeof v.accepted !== 'boolean') return null;
  const result: ActivityEvent = {at:v.at,event:v.event.slice(0,256),before:v.before as ActivityEvent['before'],
    after:v.after as ActivityEvent['after'],accepted:v.accepted};
  if (v.automaticApproval === true) result.automaticApproval = true;
  for (const key of ['sessionId','nativeEvent','tool','notification','source'] as const)
    if (typeof v[key] === 'string') result[key] = v[key].slice(0,256);
  return result;
}
