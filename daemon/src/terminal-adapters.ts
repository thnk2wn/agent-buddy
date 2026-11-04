import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec = promisify(execFile);
export interface TerminalTarget {id: string; title: string; cwd: string}
export interface TerminalTab {id:string; title:string; terminals:{id:string;title:string}[]}
export interface TabLabels {
  tabs():Promise<TerminalTab[]>;
  setTabTitle(tab:TerminalTab,terminal:string,title:string):Promise<boolean>;
}
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
const tabScript = `const app=Application('com.mitchellh.ghostty');
if (!app.running()) throw Error('Ghostty is not running');
JSON.stringify(app.windows().flatMap(w=>w.tabs().map(t=>({id:t.id(),title:t.name(),
 terminals:t.terminals().map(s=>({id:s.id(),title:s.name()}))}))));`;
// Compare immediately before mutation; never focus, type, or open a title prompt.
const labelScript = `function run(args) {
 const app=Application('com.mitchellh.ghostty');
 if(!app.running()) return 'false';
 const tab=app.windows().flatMap(w=>w.tabs()).find(t=>t.id()===args[0]);
 if(!tab || tab.name()!==args[1]) return 'false';
 const terminals=tab.terminals();
 if(terminals.length!==1 || terminals[0].id()!==args[2] || terminals[0].name()!==args[3]) return 'false';
 return String(app.performAction('set_tab_title:'+args[4],{on:terminals[0]}));
}`;
export class GhosttyAdapter implements TerminalAdapter, TabLabels {
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
  async tabs():Promise<TerminalTab[]> {
    const rows:unknown=JSON.parse(await this.run(tabScript));
    if(!Array.isArray(rows))throw Error('Unexpected Ghostty tabs');
    return rows.filter((r):r is TerminalTab=>r && typeof r.id==='string' && r.id.length<128
      && typeof r.title==='string' && Array.isArray(r.terminals) && r.terminals.every((t:TerminalTarget)=>
        t && terminalId(t.id) && typeof t.title==='string')).slice(0,128);
  }
  async setTabTitle(tab:TerminalTab,terminal:string,title:string):Promise<boolean> {
    if(!terminalId(terminal)||tab.terminals.length!==1||tab.terminals[0]?.id!==terminal
      || /[\x00-\x1f\x7f-\x9f]/.test(title)||title.length>8192)throw Error('Invalid tab label');
    return (await this.run(labelScript,[tab.id,tab.title,terminal,tab.terminals[0].title,title])).trim()==='true';
  }
  async focus(id: string): Promise<void> {
    if (!terminalId(id)) throw Error('Invalid Ghostty terminal ID');
    await this.run(activate,[id]);
  }
}
