# Compact session switcher

This firmware layout supports all existing `.acpk` characters. It does not rewrite
stock packs or depend on the inspector. It is enabled when task captions and the
opt-in session launcher are both enabled and a session is selected. Protocol 12
and older devices continue receiving the legacy two-line captions.

## Device behavior

- Portrait: 70% of its former linear dimensions. Header and title have dedicated
  black regions so ears, antennae and old effects cannot cover the text.
- Working portraits retain antialiased flowing binary digits and the cyan comet trail beside the character,
  separate from navigation controls and clear of the title.
- Header: selected agent name and status. Title: up to three 32-pixel lines.
- Long titles: word-wrapped pages every 6.5 seconds, with a page fraction beside
  the session counter. Agent, project and selected session remain visible.
- Tap the portrait to activate the selected chat/terminal; tap anywhere in the
  title/footer area (y >= 276 in 466px content coordinates) to cycle sessions.
  The existing settings swipe remains available. No automatic pinning.
- Portrait taps give a 300 ms press-and-release animation immediately on the device.
  This acknowledges the tap, not successful terminal activation; launch results
  remain available in the service/inspector.
- Protocol 14 adds four fixed session buttons with large numbers. The header
  identifies the selected agent. Cyan pulses mean working, amber means input is needed,
  and gray means idle. The selected button has a bright outline. Tap a button to
  select its session and activate the terminal/chat in one action.
- More than four sessions use groups of four; cycling the footer or automatic
  activity rotation changes groups when needed. Numbers match the full roster.
- Each tap holds the selected session for 12 seconds. Afterward, active sessions
  rotate every 8 seconds, with input requests and completion notices retained.
  Idle sessions remain in the manual cycle; character taps activate without pinning.
- In switcher mode playful idle captions are replaced by persistent session context.
  Disabling session launching restores classic character layout and touch behavior.
- Caption updates never trigger a character state change or replay audio.

The title is bounded to 256 printable ASCII characters; the project to 64.
Accents are normalized; unsupported symbols are replaced by spaces. Very long
project names are ellipsized. This is a device-only layout; the stock desktop
character renderer is unchanged.

## Build and install

Follow the repository's firmware toolchain setup first. Then:

```sh
npm test --prefix daemon
bash tools/test_device_inputs.sh
bash tools/arduino.sh build
# Release the daemon's USB connection before flashing.
bash tools/arduino.sh upload-code /dev/cu.YOUR_DEVICE
```

Use `upload-code` to preserve the selected character partition. Install the rebuilt
companion service using the normal repo setup procedure. Protocol 13 is required
for compact metadata over USB (`~agent|state|index|count|project|title`) or authenticated
Wi-Fi (`POST /switcher`). An empty `~` packet clears the compact layout.

`CompactRenderer.h` uses separate output buffers, preserving the native renderer's
incremental sprite caches. Text is cached per framebuffer/page. Portrait rows are
staged in internal RAM before writing PSRAM. Center sampling preserves the board's
animation budget; four-tap filtering proved too costly on the ESP32-S3. The render
task yields after each frame so a costly pose cannot starve the idle watchdog.
The generated antialiased text font is DejaVu Sans; its license is beside the header.

## Preview and reproduce

The original browser comparison is a design study. The native proof uses exactly
the shipping compositor and generated font:

```sh
python3 experiments/caption-lab/build.py
node experiments/switcher-layout/build.mjs PACK_FOLDER OUTPUT_FOLDER
clang++ -std=c++17 -O2 experiments/switcher-layout/native/render.cpp -o OUTPUT_FOLDER/native-layout
OUTPUT_FOLDER/native-layout OUTPUT_FOLDER/jax-idle.rgb565 OUTPUT_FOLDER/jax.ppm Claude idle   'Project roadmap and next steps' kitchen-frame 0
```

The final argument selects the title page (zero-based). The input is a native
412x466 big-endian RGB565 frame. The output is a 466x466 PPM, suitable for PNG
conversion. `tools/device.py --capture` verifies the physical device framebuffer.

Regenerate the font with Pillow:

```sh
python3 experiments/switcher-layout/native/generate_font.py DejaVuSans.ttf   firmware/AgentCompanion/src/CompactFont.h
```

## Jobot/Jax motion authoring

The `motion/` scripts are a new Blender rig/export revision. Keep original packs
as rollback copies. The source tree requires `tools/`, `vendor/character_pack.py`,
`vendor/sprite_codec.py`, firmware partition metadata and `characters/{jobot,jax}`.
Rendering produces actual 3D poses: the torso follows the head, turns expose side
surfaces, and completion/attention poses carry more weight. Every step is distinct;
Jax no longer substitutes repeated poses to reduce file size. Export uses reduced
color precision to fit flash while retaining all motion steps. Validate all decoded
frames, neutral transitions, eye patches and partition size before installation.
Generated packs and Blender renders are delivered separately from this repository.

Protocol 14 appends `|revision|index:agent:state,...` to the compact packet,
with at most four targets and state `i`, `w`, or `a`. Payloads are bounded to
511 bytes. Protocol 13 devices receive the original six fields. Direct touch
reports include the displayed roster revision; stale or out-of-range selections
are rejected. USB delivers the selection immediately; Wi-Fi status carries a
bounded queue of eight ordered, revision-bound gestures. Rapid selection and
activation taps retain their order. A new connection establishes a sequence
baseline, avoiding replay. Stale roster revisions cannot activate another session.
While an OS focus operation is in flight, later activating taps coalesce to the
latest target; opt-in and live process identity are checked again before opening.
