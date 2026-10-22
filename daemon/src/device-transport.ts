import type {CompactCaption} from './compact-caption.js';
import type {FocusAction} from './session-focus.js';
import type {DemoFrame} from './device-demo.js';
import type {CharacterState, DeviceNetwork, InstallProgress, WifiNetwork} from './protocol.js';
import {UsbTransport, type UsbPort} from './usb-transport.js';
import {WifiTransport} from './wifi-transport.js';
import type {WifiConfig} from './wifi-config.js';
import type {ConnectionMode} from './connection-mode.js';
import type {AgentBadgeActive, AgentBadgeIconDefinition} from './agent-badges.js';
import type {DeviceOrientation} from './orientation-settings.js';

export interface CharacterInstallResult {
  character: string;
  transport: 'usb' | 'wifi';
}

// USB reports a press at once and Wi-Fi a little later, with the same count.
const samePressWithinMs = 10_000;

export class DeviceTransport {
  #desired: CharacterState = 'idle';
  #demo: DemoFrame | null = null;
  #demoSent = '';

  get demoFrame(): DemoFrame | null {return this.#demo;}
  setDemo(frame: DemoFrame | null): void {
    this.#demo = frame;
    if (!frame) this.#demoSent = '';
    this.#route();
  }
  #badgeIcons: readonly AgentBadgeIconDefinition[] = [];
  #activeBadges: readonly AgentBadgeActive[] = [];
  #usage: readonly string[] = [];
  #compact: CompactCaption | null = null;
  #installing = false;
  #mode: ConnectionMode = 'auto';
  #enabled = true;
  #lastPress: {presses: number; at: number} | null = null;
  readonly #missing: () => void;
  readonly #button: () => void;
  readonly #focus: (action: FocusAction) => void;
  readonly #usb = new UsbTransport(() => this.#route(), presses => this.#pressed(presses), {focus:action=>this.#focused(action)});
  readonly #wifi = new WifiTransport(() => this.#route(), presses => this.#pressed(presses), action=>{if(!this.#usb.connected)this.#focused(action);});

  // missingCharacter runs whenever a connected device reports that no pack is installed.
  // buttonPressed runs one time for each press of the device's BOOT button.
  constructor(missingCharacter: () => void = () => undefined, buttonPressed: () => void = () => undefined, focus: (action: FocusAction) => void = () => undefined) {
    this.#missing = missingCharacter;
    this.#button = buttonPressed;
    this.#focus = focus;
  }

  get state(): CharacterState {
    return this.#demo?.state ?? this.#desired;
  }

  get connected(): boolean {
    return this.#usb.connected || this.#wifi.connected;
  }

  get transport(): 'usb' | 'wifi' | null {
    return this.#usb.connected ? 'usb' : this.#wifi.connected ? 'wifi' : null;
  }

  get address(): string | null {
    return this.#usb.connected ? this.#usb.path : this.#wifi.endpoint;
  }

  get character(): string | null {
    return this.#usb.connected ? this.#usb.character : this.#wifi.character;
  }

  get firmware(): string | null {
    return (this.#usb.connected ? this.#usb.firmware : null) ?? this.#wifi.firmware;
  }

  // The board the connected device's firmware is built for, or null when no device says.
  // Firmware without the USB BOARD line still names its board over Wi-Fi.
  get board(): string | null {
    if (!this.#usb.connected) return this.#wifi.board;
    const usb = this.#usb.board;
    if (usb !== null) return usb;
    return this.#wifi.connected && this.#usb.firmware !== null && this.#wifi.firmware === this.#usb.firmware
      ? this.#wifi.board : null;
  }

  // Firmware updates go over Wi-Fi, to protocol 9 or later firmware, which reports its ID there.
  get firmwareOverWifi(): boolean {
    return this.#wifi.connected && this.#wifi.firmware !== null;
  }

  get adaptivePatchRam(): boolean {
    return this.#usb.connected ? this.#usb.adaptivePatchRam : this.#wifi.adaptivePatchRam;
  }

  // Wi-Fi discovery keeps checking in the background, so it's the live answer when it can reach the device.
  get network(): DeviceNetwork | null {
    return this.#wifi.network ?? this.#usb.network;
  }

  get orientation(): DeviceOrientation | null {
    return this.#usb.connected ? this.#usb.orientation : this.#wifi.orientation;
  }

  async setOrientationOffset(offsetDegrees: number): Promise<DeviceOrientation> {
    if (this.#installing) throw new Error('Wait for the current installation to finish.');
    if (!this.connected) throw new Error('Connect the Agent Companion first.');
    return this.#usb.connected ? this.#usb.setOrientationOffset(offsetDegrees)
      : this.#wifi.setOrientationOffset(offsetDegrees);
  }

  get installing(): boolean {
    return this.#installing;
  }

  get mode(): ConnectionMode {
    return this.#mode;
  }

  async start(mode: ConnectionMode = 'auto', enabled = true, selectedPort: string | null = null): Promise<void> {
    this.#enabled = enabled;
    await this.#usb.selectPort(selectedPort, true);
    await this.setMode(mode);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (this.#installing) throw new Error('Wait for the installation to finish.');
    this.#enabled = enabled;
    if (enabled) await this.setMode(this.#mode);
    else await this.stop();
  }

  async setMode(mode: ConnectionMode): Promise<void> {
    if (this.#installing) throw new Error('Wait for the installation to finish.');
    this.#mode = mode;
    if (!this.#enabled) {
      await this.stop();
      return;
    }
    if (mode === 'usb') this.#wifi.stop();
    else await this.#wifi.start();
    await this.#usb.setEnabled(mode !== 'wifi');
    this.#route();
  }

  async stop(): Promise<void> {
    this.#wifi.stop();
    await this.#usb.stop();
  }

  setState(state: CharacterState): void {
    this.#desired = state;
    this.#route();
  }

  setAgentBadges(icons: readonly AgentBadgeIconDefinition[], active: readonly AgentBadgeActive[]): void {
    this.#badgeIcons = icons;
    this.#activeBadges = active;
    if (this.#demo || this.#installing || !this.#enabled) return;
    if (this.#usb.connected) this.#usb.setAgentBadges(this.#badgeIcons,this.#activeBadges);
    else this.#wifi.setAgentBadges(this.#badgeIcons,this.#activeBadges);
  }

  // The lines shown at the bottom of the screen; none hides them.
  setUsage(lines: readonly string[]): void {
    this.#usage = [...lines];
    // Caption pages change without a character event. Re-routing would resend the current
    // state too, restarting animations/sound cues on firmware that treats it as an event.
    if (this.#demo || this.#installing || !this.#enabled) return;
    if (this.#usb.connected) this.#usb.setUsage(this.#usage);
    else this.#wifi.setUsage(this.#usage);
  }

  setCompact(caption: CompactCaption | null):void {
    this.#compact=caption;
    if(this.#demo || this.#installing || !this.#enabled)return;
    (this.#usb.connected ? this.#usb : this.#wifi).setCompact(caption);
  }

  async reloadWifi(): Promise<void> {
    await this.#wifi.reload();
    this.#route();
  }

  configureWifi(ssid: string, password: string): Promise<WifiConfig> {
    return this.#usb.configureWifi(ssid, password);
  }

  scanWifi(): Promise<WifiNetwork[]> {
    return this.#usb.scanWifi();
  }

  // USB is preferred; the device restarts after every attempt and reconnects automatically.
  async installCharacter(pack: Buffer, progress?: InstallProgress): Promise<CharacterInstallResult> {
    if (this.#installing) throw new Error('A character installation is already in progress.');
    const transport = this.transport;
    if (!transport) throw new Error('Connect the Agent Companion over USB or Wi-Fi first.');
    this.#installing = true;
    try {
      const character = transport === 'usb'
        ? await this.#usb.installCharacter(pack, progress)
        : await this.#wifi.installCharacter(pack, progress);
      return {character, transport};
    } finally {
      this.#installing = false;
    }
  }

  async installFirmware(image: Buffer, md5: string, progress?: InstallProgress,
                        waitingForButton?: () => void): Promise<void> {
    if (this.#installing) throw new Error('Wait for the current installation to finish.');
    if (!this.firmwareOverWifi)
      throw new Error('Firmware updates need the device on Wi-Fi with firmware protocol 9 or later. '
        + 'Over USB, run: bash tools/arduino.sh upload-code');
    this.#installing = true;
    // The device stops reading USB during the upload. USB commands would time out, and the port
    // would be opened again, which can reset the device in the middle of the update.
    const usb = this.#mode !== 'wifi';
    try {
      if (usb) await this.#usb.setEnabled(false);
      await this.#wifi.installFirmware(image, md5, progress, waitingForButton);
    } finally {
      if (usb) await this.#usb.setEnabled(true);
      this.#installing = false;
      this.#route();
    }
  }

  // An ESP32 on USB that does not answer as an Agent Companion: a new board, or other firmware.
  get usbUnanswered(): UsbPort | null {
    return this.#mode === 'wifi' ? null : this.#usb.unanswered;
  }

  // Looks for the device now over the links that the mode uses. `error` is why the USB device
  // on its port was not reached, when there is one.
  async detect(): Promise<{ports: UsbPort[]; error: string | null}> {
    if (!this.#enabled || this.#installing) return {ports: await this.#usb.ports(), error: null};
    const [usb] = await Promise.all([
      this.#mode === 'wifi' ? null : this.#usb.scanNow(),
      this.#mode === 'usb' || this.#usb.connected ? null : this.#wifi.scanNow(),
    ]);
    return usb ?? {ports: await this.#usb.ports(), error: null};
  }

  usbPorts(): Promise<UsbPort[]> {
    return this.#usb.ports();
  }

  selectUsbPort(path: string | null): Promise<void> {
    return this.#usb.selectPort(path);
  }

  findUsbPort(selected?: string | null): Promise<UsbPort | null> {
    return this.#usb.findPort(selected);
  }

  matchesUsbPort(port: UsbPort): boolean {
    return this.#usb.matches(port);
  }

  // Closes the USB port while `run` uses it (to install firmware), then opens it again.
  async withUsbReleased<T>(run: () => Promise<T>): Promise<T> {
    if (this.#installing) throw new Error('Wait for the current installation to finish.');
    this.#installing = true;
    try {
      await this.#usb.setEnabled(false);
      return await run();
    } finally {
      await this.#usb.setEnabled(this.#enabled && this.#mode !== 'wifi');
      this.#installing = false;
      this.#route();
    }
  }

  #focused(action: FocusAction): void {
    if (!this.#demo && !this.#installing && this.#enabled) this.#focus(action);
  }

  #pressed(presses: number): void {
    const now = Date.now();
    if (this.#lastPress?.presses === presses && now - this.#lastPress.at < samePressWithinMs) return;
    this.#lastPress = {presses, at: now};
    console.log(`[device] BOOT button pressed (${presses} since the device started)`);
    this.#button();
  }

  #route(): void {
    if (this.#installing || !this.#enabled) return;
    if (this.#demo) {
      if (!this.connected) {this.#demoSent = '';return;}
      const target = this.#usb.connected ? this.#usb : this.#wifi;
      this.#wifi.setEnabled(!this.#usb.connected);
      const signature = `${this.transport}:${this.address}:${this.#demo.key}`;
      if (signature !== this.#demoSent) {target.setState(this.#demo.state);this.#demoSent = signature;}
      target.setAgentBadges(this.#demo.icons, this.#demo.active);
      target.setUsage(this.#demo.lines);
      target.setCompact(null);
      return;
    }
    if (this.#usb.connected) {
      this.#wifi.setEnabled(false);
      this.#usb.setState(this.#desired);
      this.#usb.setAgentBadges(this.#badgeIcons, this.#activeBadges);
      this.#usb.setUsage(this.#usage);
      this.#usb.setCompact(this.#compact);
    } else {
      this.#wifi.setEnabled(true);
      this.#wifi.setState(this.#desired);
      this.#wifi.setAgentBadges(this.#badgeIcons, this.#activeBadges);
      this.#wifi.setUsage(this.#usage);
      this.#wifi.setCompact(this.#compact);
    }
    if (this.connected && this.character === 'none') this.#missing();
  }
}
