import type {FocusAction,SessionView} from './session-focus.js';
interface Display {sessionView?:SessionView;focusSession(action:FocusAction):boolean|void}
interface Launcher {status():{enabled:boolean};deviceActivated(id:string|null):void}
// Current firmware calls a character tap "pin" on the wire. In switcher mode
// interpret it as activate; keep the legacy pin behavior when switching is off.
export function deviceSessionAction(action:FocusAction,display:Display,launcher:Launcher):void {
 const activate=launcher.status().enabled && action==='pin';
 const accepted=display.focusSession(activate?'activate':action);
 if(activate || (typeof action==='object' && action.activate && accepted===true))launcher.deviceActivated(display.sessionView?.sessionId??null);
}
