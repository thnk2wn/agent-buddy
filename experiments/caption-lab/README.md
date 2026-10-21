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
identical tool events repeat; a changed title/status resets it. The model is
ready for integration, but the installed daemon is **not wired to it yet**.

Hook events do not consistently supply the same title shown in an agent's
conversation list. The adapter only accepts explicit session/thread title
fields and a project name or cwd basename. It does not guess from private
prompts, tool arguments, shell commands, or transcript contents. Next work:
opt-in local session metadata lookup, session selection when agents run in
parallel, a Settings toggle, and a tested device firmware build.

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
per character; the installed device firmware has not been changed.

The browser preview sends raw native frames over localhost. Its frame rate is
not a hardware performance benchmark. Completed animation can settle into idle
while the chosen caption remains; this lab intentionally does not simulate all
of the daemon's state timers.

## Validation

```sh
npm run build --prefix daemon
node --test daemon/dist/test/task-captions.test.js
bash tools/test_character.sh
bash tools/test_working_bits.sh
```

Coverage includes long titles/identifiers, protocol-safe text, cycle timing,
repeated-event stability, explicit title fields, native alphabet rendering,
restoration, allocation guards, and the existing character/effect checks.
The lab was also exercised in a browser with both characters, title paging,
manual navigation, and alternate presentation modes. No hardware flash was
performed. No character pack files are committed here.
