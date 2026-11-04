# Display protection

Firmware protocol 15 and this fork's daemon add automatic AMOLED protection.
The feature is enabled by default; it does not stop agents, disconnect transport,
or suspend the microcontroller.

- After **15 minutes with all sessions idle**, brightness drops to **20% of the user's setting**.
- After **60 minutes idle**, display brightness becomes zero. The touch controller and session monitoring remain active.
- **Midnight through 6 a.m.**, in the daemon computer's local timezone, the display stays dark even while agents work. Routine work and completion do not wake it.
- The first touch while dimmed/dark only wakes the display; it never activates a session or opens a menu. Touch gives a **60-second viewing window overnight**. Another touch during that window works normally and extends it.
- A transition into genuine aggregate **needs input** can wake the display for 60 seconds overnight. Repeated attention heartbeats do not extend that window. An already-active attention state does not repeatedly wake the display for additional sessions.
- Daytime agent work/input wakes the display. Idle caption rotation, hook heartbeats and sleeping character animations do not reset the idle timer.

The existing sound settings are unchanged. Display protection is not an overnight audio-mute feature.

Settings and firmware approval screens remain visible while in use. An explicitly
staged recording demo keeps the screen awake while its host is connected; normal
policy resumes when it is exited. With a disconnected
host, activity expires after 90 seconds; idle protection still works on the device.
Quiet time is refreshed every ten seconds using the host timezone; after host loss,
the last supplied quiet-time deadline remains effective. A reboot needs a fresh
host update to learn the overnight window. A standalone device does not have a
persisted local-time schedule in this version.

## Configuration

Optionally create `screen-protection.json` in the same Agent Companion data directory
as `task-captions.json` and restart the companion service. No inspector is required.
Missing settings use these defaults; omitted `timeZone` uses the computer's timezone.
An invalid file logs a warning and falls back to the defaults.

```json
{
  "enabled": true,
  "dimAfterMinutes": 15,
  "offAfterMinutes": 60,
  "dimPercent": 20,
  "quietStartHour": 0,
  "quietEndHour": 6,
  "wakeOnAttention": true,
  "quietWakeSeconds": 60
}
```

Use `"timeZone": "America/New_York"` to explicitly choose Eastern time with DST.
Equal quiet start/end hours disable the overnight window. Set `wakeOnAttention`
to `false` for touch-only waking overnight. Set `enabled` to `false` to disable
protection. Off must be at least as late as dim; both accept 1–1440 minutes.

Protocol: `>enabled|dimSeconds|offSeconds|dimPercent|quietSecondsRemaining|i/w/a|wakeOnAttention|wakeSeconds`.
The aggregate activity is independent of the manually selected session. USB and
authenticated Wi-Fi `/screen` use the same bounded firmware parser. One latest
pending command replaces obsolete updates during slow transport; regular policy
updates do not replay character animations or sound events. Protocol 14 and older
devices do not receive this command. USB `i` diagnostics include a `SCREEN` line
with the effective protection percentage and brightness value.

The native tests use a simulated clock for the complete 15/60-minute thresholds,
nighttime working/input, stale host, and wake-only gestures. Daemon tests cover
local midnight/6 a.m., DST offsets, wrapping windows, config validation, older
firmware gating, and in-flight packet coalescing.
