import {execFile} from 'node:child_process';
import {join} from 'node:path';

export type DesktopCue = 'working' | 'attention' | 'complete' | 'surprise' | 'switch';
const files: Record<DesktopCue, string> = {
  switch: 'settings-tick.wav', working: 'working.wav', attention: 'needs-attention.wav', complete: 'complete.wav', surprise: 'surprise.wav',
};
type Player = (cue: DesktopCue, volume: number, finished: () => void) => () => void;

/** Native playback keeps working with the webview hidden or the desktop app closed.
 * Only owns audio while Show on desktop is off; the visible app retains its player.
 * No queue: obsolete alerts must not play later when headphones reconnect.
 */
export class DesktopAudio {
  #enabled = false;
  #volume = 0;
  #stop: (() => void) | undefined;
  #generation = 0;
  constructor(private readonly player: Player, private readonly supported = process.platform === 'darwin') {}
  configure(sounds: boolean, visible: boolean, volume: number): void {
    const next = Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : 0;
    const enabled = this.supported && sounds && !visible && next > 0;
    if (!enabled || next !== this.#volume) this.stop();
    this.#enabled = enabled;
    this.#volume = next;
    // Enabling, restarting, or changing visibility never replays the current state.
  }
  play(cue: string): void {
    if (!this.#enabled || !Object.hasOwn(files, cue)) return;
    // A navigation tick must never cut off an important activity alert.
    if (cue === 'switch' && this.#stop) return;
    this.stop();
    const generation = this.#generation;
    this.#stop = this.player(cue as DesktopCue, this.#volume, () => {
      if (generation === this.#generation) this.#stop = undefined;
    });
  }
  stop(): void {
    ++this.#generation;
    this.#stop?.();
    this.#stop = undefined;
  }
  close(): void {this.#enabled = false; this.stop();}
}

export function macAudioPlayer(assetDirectory: string): Player {
  return (cue, volume, finished) => {
    console.log(`[desktop-audio] play cue=${cue} volume=${volume}`);
    const gain = volume / 100 * (cue === 'switch' ? 0.45 : 1);
    const child = execFile('/usr/bin/afplay', ['-v', String(gain), join(assetDirectory, files[cue])],
      {timeout: 5000}, error => {
        if (error && !error.killed) console.error(`[desktop-audio] ${error.message}`);
        if (!error) console.log(`[desktop-audio] played cue=${cue}`);
        finished();
      });
    return () => {child.kill();};
  };
}
