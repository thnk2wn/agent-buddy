import {isFocusAction} from './session-focus.js';
import {localSessionRoster, type SessionRoster} from './session-roster.js';
import {deviceSessionAction} from './device-session-actions.js';
import {GhosttyTitleProbe} from './ghostty-title-probe.js';
import {SessionLauncher, liveClaudeSessions} from './session-launch.js';
import {GhosttyAdapter} from './terminal-adapters.js';
import {ActivityTitles} from './activity-titles.js';
import {ActivityHistory} from './activity-history.js';
import {DeviceDemo} from './device-demo.js';
import {chmod, mkdir, rm, unlink} from 'node:fs/promises';
import {createConnection, createServer, type Socket} from 'node:net';
import {dirname, join} from 'node:path';
import {characterStates, hookEvents, type DaemonRequest} from './protocol.js';
import {isNamedPipe, serviceStoppedPath, socketPath, statePath} from './paths.js';
import {StateCoordinator} from './state-coordinator.js';
import {StateStore} from './state-store.js';
import {DeviceTransport} from './device-transport.js';
import {isConnectionMode, loadConnectionMode} from './connection-mode.js';
import {CompanionService} from './companion-service.js';
import {startSettingsServer} from './settings-server.js';
import {isAgentId} from './agents/types.js';
import {defaultAgentContext, normalizeAgentHook, namespaceAgentPayload, otherAgentLocations} from './agents/index.js';
import {loadAgentBadgeIcons} from './agent-badges.js';
import {desktopBackdrops, isDesktopBackdrop, isDesktopVolume} from './display-settings.js';
import {isUsageWindow, usageWindows} from './usage-tracker.js';

const autoInstallRetryMs = 5 * 60 * 1000;

export async function runDaemon(): Promise<void> {
  let lastAutoInstall = 0;
  let service: CompanionService | undefined;
  let launcher: SessionLauncher | undefined;
  // A device that lost its pack (for example, an interrupted install) gets the preferred one back.
  let settingsUrl: string | null = null;
  // A stop on request has ended: this service runs again.
  await rm(serviceStoppedPath(), {force: true}).catch(() => undefined);
  const transport = new DeviceTransport(() => {
    if (!service || !service.onboardingStatus().completed || transport.installing
      || Date.now() - lastAutoInstall < autoInstallRetryMs) return;
    lastAutoInstall = Date.now();
    service.restoreCharacter().catch(error => console.error(`[character] automatic install failed: ${
      error instanceof Error ? error.message : String(error)}`));
  }, () => void service?.openSettings(settingsUrl), action => {
    if(service && launcher && !transport.demoFrame && !transport.installing)deviceSessionAction(action,service,launcher);
  });
  const store = new StateStore(statePath());
  const restored = await store.load();
  const history = new ActivityHistory(join(dirname(statePath()), 'activity-history.json'));
  await history.load();
  const agentContext = defaultAgentContext();
  const activityTitles = new ActivityTitles(agentContext.home, agentContext.env);
  const ghostty=new GhosttyAdapter();
  const titleProbe=new GhosttyTitleProbe(ghostty,join(agentContext.dataDir,'ghostty-title-probe.json'));
  launcher = new SessionLauncher(join(agentContext.dataDir,'session-launch.json'),
    ()=>liveClaudeSessions(agentContext.home,agentContext.env),[ghostty],process.platform==='darwin',session=>titleProbe.discover(session));
  await launcher.load();
  agentContext.locations = otherAgentLocations(agentContext);
  const badgeIcons = await loadAgentBadgeIcons(agentContext.dataDir);
  const demo = new DeviceDemo(frame => transport.setDemo(frame), badgeIcons);
  // While the service stops on request, the device stays idle.
  const coordinator = new StateCoordinator(state => { if (service) service.syncUsage(); else transport.setState(state); }, {
    restored,
    onEvent: event => history.add(event),
    onMutation: state => {
      store.schedule(state);
      service?.syncBadges();
      service?.syncUsage();
    },
  });
  service = new CompanionService(transport, coordinator, agentContext, badgeIcons);
  const roster=localSessionRoster(join(agentContext.dataDir,'session-roster.json'),agentContext.home,agentContext.env);
  await roster.load(restored?.sessions.map(s=>s.id)??[]);
  let rosterRefreshing=false;
  const refreshRoster=async()=>{
    if(rosterRefreshing)return;rosterRefreshing=true;
    try {
      if(!launcher!.status().enabled){service!.setSwitchableSessions(null);launcher!.setDesktopSessions([]);return;}
      const sessions=await roster.refresh();
      if(!launcher!.status().enabled)return;
      launcher!.setDesktopSessions(sessions.filter(s=>s.id.startsWith('codex:')).map(s=>s.id));
      service!.setSwitchableSessions(sessions);
      if(!demo.status().active && !transport.installing)for(const session of sessions)if(session.id.startsWith('claude:'))launcher!.observe(session.id);
    } catch(error){console.error('[session-roster]',error instanceof Error?error.message:String(error));}
    finally{rosterRefreshing=false;}
  };
  await refreshRoster();
  const rosterTimer=setInterval(()=>void refreshRoster(),5000);rosterTimer.unref();
  // Picks up characters added or changed since the last run before anyone opens the settings page.
  void service.refreshCharacterPacks();
  await service.refreshWifiPairing();
  await service.refreshCharacterPreference();
  void service.loadSavedRelease();
  transport.setState(coordinator.state);
  service.syncBadges();
  service.startUsage();
  const path = socketPath();
  const pipe = isNamedPipe(path);
  if (!pipe) await mkdir(dirname(path), {recursive: true, mode: 0o700});
  await removeStaleSocket(path);

  const companion = service;
  const server = createServer({allowHalfOpen: true},
    socket => handleSocket(socket, coordinator, transport, companion, () => settingsUrl, demo, history, activityTitles, launcher, roster));
  server.on('error', error => {
    console.error(`[daemon] ${error.message}`);
    process.exitCode = 1;
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      server.off('error', reject);
      resolve();
    });
  });
  if (!pipe) await chmod(path, 0o600);
  const connectionMode = await loadConnectionMode();
  const setup = service.onboardingStatus();
  const preparingUsb = !setup.completed && setup.port && setup.display !== 'desktop' && !setup.deviceDeferred;
  await transport.start(preparingUsb ? 'auto' : connectionMode, service.deviceEnabled, preparingUsb ? setup.port : null);
  console.log(`[daemon] listening ${path}`);
  settingsUrl = await startSettingsServer(companion);

  const shutdown = async () => {
    clearInterval(rosterTimer);
    demo.close();
    companion.stopUsage();
    coordinator.close();
    await store.flush(coordinator.snapshot());
    await history.flush();
    await transport.stop();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (!pipe) await unlink(path).catch(() => undefined);
  };
  // A stop on request ends with the service manager's signal, or with 'stop' when no manager runs it.
  let exiting: Promise<void> | undefined;
  const exit = () => void (exiting ??= shutdown().then(() => process.exit(0)));
  companion.once('stop', exit);
  process.once('SIGINT', exit);
  process.once('SIGTERM', exit);
  // Windows sends SIGBREAK for Ctrl+Break and when a console closes.
  if (process.platform === 'win32') process.once('SIGBREAK', exit);
}

export const agentHookTimeoutMs = 45_000;

export function handleSocket(socket: Socket, coordinator: StateCoordinator, transport: DeviceTransport,
                      service: CompanionService, settingsUrl: () => string | null, demo?: DeviceDemo, history?: ActivityHistory, titles?: ActivityTitles, launcher?: SessionLauncher, roster?: SessionRoster): void {
  socket.setEncoding('utf8');
  socket.setTimeout(2000, () => socket.destroy());
  socket.on('error', () => undefined);
  let input = '';
  let handled = false;
  // Requests end at the first newline. Windows named pipes cannot half-close reliably, so clients
  // there keep the pipe open; Unix clients still half-close, and 'end' covers older clients.
  const handleOnce = (text: string) => {
    if (handled) return;
    handled = true;
    handleRequest(text);
  };
  socket.on('data', chunk => {
    input += chunk;
    const newline = input.indexOf('\n');
    if (newline >= 0) handleOnce(input.slice(0, newline));
    else if (input.length > 65536) socket.destroy();
  });
  socket.on('end', () => handleOnce(input));
  const reply = (work: Promise<unknown>) => void work.then(
    result => respond(socket, result),
    error => respond(socket, {ok: false, error: error instanceof Error ? error.message : String(error)}));
  const handleRequest = (text: string) => {
    try {
      const request = JSON.parse(text.trim()) as DaemonRequest;
      if (request.type === 'hook') {
        const agent = isAgentId(request.agent) ? request.agent : 'copilot';
        const eventName = typeof request.event === 'string' ? request.event : undefined;
        const canonical = hookEvents.includes(eventName as never) && !request.nativeEvent
          ? [{event: eventName as typeof hookEvents[number], payload: request.payload ?? {}}]
          : normalizeAgentHook(agent, request.nativeEvent ?? eventName, request.payload ?? {});
        for (const hook of canonical) {
          if (service.handleHook(agent, hook.event, hook.payload)) {
            const payload=namespaceAgentPayload(agent,hook.payload);titles?.observe(payload);
            const rosterId=payload.sessionId ?? payload.session_id;
            if(typeof rosterId==='string')roster?.observe(rosterId,hook.event==='sessionEnd');
            if (agent==='claude' && ['sessionStart','userPromptSubmitted','preToolUse'].includes(hook.event)
                && !demo?.status().active && !transport.installing) {
              const id=payload.sessionId ?? payload.session_id;
              if(typeof id==='string')launcher?.observe(id);
            }
          }
        }
        // A manual `send` only lasts until the next agent event; otherwise the device keeps it for
        // as long as the coordinator stays in one state, which can be hours while agents work.
        service.syncUsage();
        respond(socket, {ok: true, state: coordinator.state});
      } else if (request.type === 'sessionLaunch') {
        if (!launcher) throw Error('Session launching is unavailable');
        socket.setTimeout(15000,()=>socket.destroy());
        if (request.action==='open' && (demo?.status().active || transport.installing)) throw Error('Finish the demo or installation first');
        reply(launcher.command(request).then(result=>({ok:true,...result})));
      } else if (request.type === 'focus') {
        if (!isFocusAction(request.action)) throw new Error('Invalid focus action');
        const accepted=service.focusSession(request.action);
        if((request.action==='activate'||(typeof request.action==='object'&&request.action.activate&&accepted)) && !demo?.status().active && !transport.installing)launcher?.deviceActivated(service.sessionView?.sessionId??null);
        respond(socket,{ok:true,sessionView:service.sessionView});
      } else if (request.type === 'activity') {
        socket.setTimeout(10000, () => socket.destroy());
        const diagnostics=coordinator.diagnostics(), events=history?.recent() ?? [];
        const ids=[...service.switchableSessions.map(s=>s.id),...diagnostics.sessions.map(s=>s.id), ...events.slice().reverse().flatMap(e=>e.sessionId?[e.sessionId]:[])];
        reply((async()=>({ok:true,...diagnostics,events,sessionTitles:await titles?.resolve(ids) ?? {},
          demoActive:demo?.status().active ?? false,deviceState:transport.state,sessionView:service.sessionView,switchableSessions:service.switchableSessions,sessionLaunch:launcher?.status()}))());
      } else if (request.type === 'demo') {
        if (!demo) throw new Error('Demo mode is unavailable.');
        if (!['stage','start','pause','next','restart','exit','status'].includes(request.action)) throw new Error('Invalid demo action.');
        if (request.action === 'stage') {
          if (!transport.connected || service.installBusy) throw new Error('Connect the device and finish any installation first.');
          if (!request.context || typeof request.context.project !== 'string' || typeof request.context.title !== 'string'
              || request.context.project.length > 512 || request.context.title.length > 512) throw new Error('Invalid demo context.');
        }
        respond(socket, {ok:true,demo:demo.command(request.action,request.context)});
      } else if (request.type === 'send' && characterStates.includes(request.state)) {
        transport.setState(request.state);
        respond(socket, {ok: true, state: request.state});
      } else if (request.type === 'status') {
        const command = request.client === 'desktop'
          ? service.desktopSeen({
            executable: request.executable, environment: request.environment, flasher: request.flasher,
            version: request.version,
          }) : null;
        respond(socket, command ? {...service.status(), desktopCommand: command} : service.status());
      } else if (request.type === 'agents') {
        respond(socket, service.agentStatuses());
      } else if (request.type === 'agentEnable' && isAgentId(request.agent)) {
        reply(service.setAgentEnabled(request.agent, Boolean(request.enabled)).then(agents => ({ok: true, agents})));
      } else if (request.type === 'agentInstall' && isAgentId(request.agent)) {
        // OpenClaw runs several of its own CLI commands, each allowed up to 10 seconds.
        socket.setTimeout(agentHookTimeoutMs, () => socket.destroy());
        reply(service.installAgentHook(request.agent).then(agents => ({ok: true, agents})));
      } else if (request.type === 'agentUninstall' && isAgentId(request.agent)) {
        socket.setTimeout(agentHookTimeoutMs, () => socket.destroy());
        reply(service.uninstallAgentHook(request.agent).then(agents => ({ok: true, agents})));
      } else if (request.type === 'reloadWifi') {
        reply(service.reloadWifi().then(() => ({ok: true})));
      } else if (request.type === 'configureWifi') {
        socket.setTimeout(10000, () => socket.destroy());
        reply(service.configureWifi(request.ssid, request.password).then(deviceId => ({ok: true, deviceId})));
      } else if (request.type === 'setConnection' && isConnectionMode(request.mode)) {
        const mode = request.mode;
        reply(service.setConnection(mode).then(() => ({ok: true, mode})));
      } else if (request.type === 'badges' && typeof request.enabled === 'boolean') {
        reply(service.setAgentBadgesEnabled(request.enabled).then(() => ({ok: true, enabled: request.enabled})));
      } else if (request.type === 'desktop') {
        if (request.visible !== undefined && typeof request.visible !== 'boolean')
          throw new Error('Desktop visibility must be true or false.');
        if (request.backdrop !== undefined && !isDesktopBackdrop(request.backdrop))
          throw new Error(`Desktop backdrop must be one of: ${desktopBackdrops.join(', ')}.`);
        if (request.sounds !== undefined && typeof request.sounds !== 'boolean')
          throw new Error('Desktop sounds must be on (true) or off (false).');
        if (request.volume !== undefined && !isDesktopVolume(request.volume))
          throw new Error('Desktop volume must be a whole number from 0 to 100.');
        if (request.character !== undefined && typeof request.character !== 'string')
          throw new Error('Desktop character must be a character id.');
        if (request.deviceEnabled !== undefined && typeof request.deviceEnabled !== 'boolean')
          throw new Error('Device use must be on (true) or off (false).');
        const change = {visible: request.visible, backdrop: request.backdrop, sounds: request.sounds,
                        volume: request.volume, character: request.character, deviceEnabled: request.deviceEnabled};
        reply(service.setDesktop(change).then(() => ({ok: true, desktop: service.status().desktop})));
      } else if (request.type === 'usage') {
        if (request.enabled !== undefined && typeof request.enabled !== 'boolean')
          throw new Error('Usage must be on (true) or off (false).');
        if (request.window !== undefined && !isUsageWindow(request.window))
          throw new Error(`Usage window must be one of: ${usageWindows.join(', ')}.`);
        reply(service.setUsage({enabled: request.enabled, window: request.window})
          .then(() => ({ok: true, usage: service.status().usage})));
      } else if (request.type === 'listCharacters') {
        reply(service.characters());
      } else if (request.type === 'settings') {
        respond(socket, {url: settingsUrl()});
      } else if (request.type === 'stopService') {
        reply(service.stopService().then(() => ({ok: true})));
      } else if (request.type === 'restartService') {
        reply(Promise.resolve().then(() => service.restartService()).then(() => ({ok: true})));
      } else if (request.type === 'installCharacter' && typeof request.character === 'string') {
        // Installs take about a minute, so progress streams as JSON lines until the result.
        socket.setTimeout(0);
        let shown = -1;
        reply(service.installCharacter(request.character, (sent, total) => {
          const percent = Math.floor(sent * 100 / total);
          if (percent === shown || socket.destroyed) return;
          shown = percent;
          socket.write(`${JSON.stringify({progress: percent})}\n`);
        }));
      } else {
        throw new Error('Unknown daemon request.');
      }
    } catch (error) {
      respond(socket, {ok: false, error: error instanceof Error ? error.message : String(error)});
    }
  };
}

function respond(socket: Socket, response: unknown): void {
  if (socket.destroyed) return;
  socket.end(`${JSON.stringify(response)}\n`);
}

async function removeStaleSocket(path: string): Promise<void> {
  const active = await new Promise<boolean>(resolve => {
    const socket = createConnection(path);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', error => {
      const code = (error as NodeJS.ErrnoException).code;
      resolve(code !== 'ENOENT' && code !== 'ECONNREFUSED');
    });
  });
  if (active) throw new Error(`Agent Companion daemon is already listening at ${path}`);
  // A named pipe goes away with its last handle, so there is no file to remove.
  if (isNamedPipe(path)) return;
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
