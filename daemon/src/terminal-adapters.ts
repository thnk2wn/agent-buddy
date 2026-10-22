import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec = promisify(execFile);
export interface TerminalTarget {id: string; title: string; cwd: string}
export interface TerminalAdapter {
  id: string;
  list(): Promise<TerminalTarget[]>;
  focus(id: string): Promise<void>;
}
export const terminalId = (id: unknown): id is string => typeof id === 'string'
  && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);

// No shell, terminal input, commands, or new windows. IDs are passed as data.
const enumerate = `const app=Application('com.mitchellh.ghostty');
if (!app.running()) throw Error('Ghostty is not running');
JSON.stringify(app.terminals().map(t=>({id:t.id(),title:t.name(),cwd:t.workingDirectory()})));`;
const activate = `function run(args) {
 const app=Application('com.mitchellh.ghostty');
 if (!app.running()) throw Error('Ghostty is not running');
 const target=app.terminals().find(t=>t.id()===args[0]);
 if (!target) throw Error('The paired Ghostty terminal has closed');
 app.focus(target);
}`;
export class GhosttyAdapter implements TerminalAdapter {
  readonly id = 'ghostty';
  constructor(private readonly run = async (script: string, args: string[] = []) => {
    const result = await exec('/usr/bin/osascript', ['-l','JavaScript','-e',script,...args],
      {timeout: 8000, maxBuffer: 128 * 1024});
    return result.stdout;
  }) {}
  async list(): Promise<TerminalTarget[]> {
    const rows: unknown = JSON.parse(await this.run(enumerate));
    if (!Array.isArray(rows)) throw Error('Unexpected Ghostty response');
    return rows.filter((r): r is TerminalTarget => r && terminalId(r.id)
      && typeof r.title === 'string' && typeof r.cwd === 'string').slice(0,128);
  }
  async focus(id: string): Promise<void> {
    if (!terminalId(id)) throw Error('Invalid Ghostty terminal ID');
    await this.run(activate,[id]);
  }
}
