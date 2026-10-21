# Long-title caption lab

An isolated experiment for reading real conversation titles on the 466 × 466
Agent Buddy display. The original two-line proposal clipped titles after 18
characters. This version preserves the title across word-wrapped pages while
keeping the character visible.

- **Word pages (default):** status/project card for 3 seconds, then two-line
  title pages for 5 seconds each. Long status/project labels page too.
- **Slow ticker:** an 18-character window moves one character every 350 ms,
  pausing at each end. This demonstrates existing protocol limits; smooth
  pixel scrolling would require firmware layout/animation changes.
- **Truncate:** the previous approach for comparison.
- Pause, restart, next-page and direct page selection help compare layouts.
- A collapsible badge/sound guide plays the original cue files on this computer.
- Both custom Jobot and Jax packs animate using the actual native C++ engine.
  Text is rendered by firmware code, not approximated with a browser font.

## Run locally

Requires Node >= 24.11, Python 3, clang++, zlib, and the two custom character
packs already delivered separately. Run from the repository root:

```sh
npm ci --ignore-scripts --prefix daemon
npm run build --prefix daemon
python3 experiments/caption-lab/build.py
node experiments/caption-lab/server.mjs --packs '/absolute/path/to/Agent Buddy'
```

Open <http://127.0.0.1:4876/>. The packs folder must contain `jobot.acpk` and
`jax.acpk`. The server binds only to loopback and validates the Host/Origin.
It reads these packs without changing them and uses temporary symlinks under
`~/temp`; Ctrl-C removes its temporary working directory. A single native
renderer backs the lab, so use one preview tab at a time.

This does **not** run the companion daemon, rewrite hooks, contact the device,
flash firmware, replace the desktop application, or publish entered titles.
The experiment leaves the installed Agent Buddy working normally.

## Implementation and limits

`daemon/src/task-captions.ts` contains the reusable presentation model and an
explicit hook-title adapter. `CaptionPlayback` keeps its reading position when
identical tool events repeat; a changed title/status resets it. The device integration is now available in `daemon/src/live-captions.ts` and
`CompanionService`, opt-in through a local `task-captions.json` configuration.

The live adapter reads explicit hook titles, Codex desktop sidebar `name` metadata
(read-only SQLite, with the CLI session-name index as fallback), and Claude
`custom-title` records from the matching session transcript under its own projects
folder. It never substitutes prompts or tool arguments for a missing title. Claude
sessions without a custom-title record show the project/status only. Reads are
bounded and refreshed every five seconds. Attention sessions take priority; a
new user prompt selects its session immediately. Background tool bursts do not
steal that prompt's caption; after a restart without a prompt event, recent activity
takes over within five seconds. Active captions identify the agent explicitly.
When idle, the normal usage display returns. Completion captions use the same
agent that drives the completion animation.

Create `task-captions.json` in the daemon data directory to opt in:

```json
{
  "enabled": true,
  "mode": "pages",
  "phrases": {
    "working": "working",
    "attention": "needs input",
    "complete": "finished"
  },
  "idleAfterSeconds": 60,
  "idleMessages": ["Dreaming in code", "Ready when you are", "All systems cozy"]
}
```

The agent name prefixes active status phrases. Playful `idleMessages` appear only
after `idleAfterSeconds` (minimum 15 seconds, default 60), alternating with token
usage every five seconds; any work or attention interrupts them immediately.

`mode` also accepts `ticker`. Edits reload within five seconds. Disable by setting
`enabled` to false or removing the file. No Settings toggle is implemented yet.
Caption updates send only usage packets, without replaying animation events or
sound cues. These changes require the accompanying firmware font update; the
stock desktop WASM renderer has not been rebuilt for arbitrary caption text.

The current packet accepts 2 × 18 characters. Input is capped at 512 characters;
Latin accents normalize, and unsupported punctuation/symbols become spaces.
Full titles remain available within that limit; long unbroken identifiers split
across lines. Reading an unusually long title can take a long cycle. This is a
tradeoff to evaluate on the physical device rather than shrinking the type.

The stock font accepts letters at the parser but lacks 40 glyphs. This branch
adds them to `CharacterEffects.cpp`, preserving every existing glyph. Arbitrary
captions need this firmware change (and a rebuilt desktop engine for desktop
parity), not just the daemon change. Body protection remains unchanged. While captions are visible, moving effects
leave the text strip clear so letters stay readable. Orbiting agent badges stay
above that strip instead of disappearing into it. The attention question mark
is higher and inward to clear Jax ears and Jobot antenna poses. Native checks
with both custom packs verified the complete glyph across 360 attention frames
per character. The experimental device firmware was installed and verified on
the Waveshare AMOLED 1.75; its firmware ID is `7ecc1b064314d1eb`.

The browser preview sends raw native frames over localhost. Its frame rate is
not a hardware performance benchmark. Completed animation can settle into idle
while the chosen caption remains; this lab intentionally does not simulate all
of the daemon's state timers.

## Validation

```sh
npm run build --prefix daemon
npm test --prefix daemon
bash tools/test_character.sh
bash tools/test_working_bits.sh
```

The full daemon suite passes (300 passed, one skipped). A physical Jobot-frame
capture after the code-only flash reported 29.5 fps with no dropped logs.

Coverage includes long titles/identifiers, protocol-safe text, cycle timing,
repeated-event stability, explicit title fields, native alphabet rendering,
restoration, allocation guards, and the existing character/effect checks.
The lab was also exercised in a browser with both characters, title paging,
manual navigation, and alternate presentation modes. The code-only hardware flash preserves the existing character partition. No
character pack files are committed here. Local runtime patches may be replaced
by a future stock app update; re-test compatibility before reapplying them.
