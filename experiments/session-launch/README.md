# Device session switcher (experiment)

This opt-in macOS feature turns the device into a session switcher, not just a
carousel of concurrent work. The installed background service owns discovery,
captions and activation. The inspector need not run. Current session-touch
firmware already sends the two basic gestures. Protocol 14 firmware adds fixed
numbered indicators for direct session selection.

## Controls

- Tap the bottom captions to cycle sessions, including idle ones.
- On protocol 14, tap a numbered side indicator to select its session and activate its terminal/chat in one action.
  Cyan pulses show work in other sessions; amber means input is needed; gray is idle.
- Tap the character to activate the selected session. It does **not** pin/unpin.
- Tap again to activate it again; browse next whenever you want to switch back.
- Each tap holds the selection for 12 seconds so you can read and activate it.
- After that, active work returns automatically; multiple busy sessions rotate every
  8 seconds. Actual input requests take priority, and completion notices still appear.
- When everything is idle, the last selection stays visible.
- Swipe up still opens device Settings.

Captions show the selected agent, its actual idle/working/input state, position
in the list, project and paged title. Browsing does not manufacture hook activity,
renew work leases, or run commands in an agent. Titles and animation always refer
to the same session. Manual browsing briefly defers activity and completion notices;
it does not discard them. Turning this option off restores the activity-only
mode, including its pin gesture and idle personality.

## Enable / disable

From the repository root with this fork's built daemon installed:

```sh
npm run session-launch -- enable
npm run session-launch -- auto-enable
npm run session-launch -- status
```

`enable` switches presentation/character taps into browser/activate mode.
`auto-enable` additionally pairs direct local Claude/Ghostty sessions. Both are
saved in owner-only local settings and survive restarts. The roster refreshes
about every five seconds. A fresh installation defaults to disabled.

```sh
npm run session-launch -- auto-disable  # keep switcher and existing pairs
npm run session-launch -- disable       # restore activity-only presentation
```

## Which sessions appear?

Genuine work/input remains visible even if discovery temporarily misses a session
or it is not a launchable desktop chat. Displaying it does not grant activation;
opening still requires a verified desktop route or registered terminal.

**Claude Code:** the live local process registry, verified using owner, PID and
process birth time. Existing idle processes appear without sending a prompt.
Exited processes disappear at the next refresh. Their local session titles are
resolved through the existing caption metadata reader. Other terminal hosts may
appear in the roster, but activation currently supports direct Ghostty only.

**Codex desktop:** chats observed through hooks (including restored service
sessions), verified against local, unarchived desktop chat metadata. This avoids
filling the device with every historical saved chat. A local roster retains these
observed chats across quiet periods and service restarts. A session-end event or
archiving removes a chat from the visible roster. This is **not** an authoritative
inventory of visible application tabs: simply navigating away from a chat does
not emit a close event. Desktop activation uses the installed app's
`codex://threads/<id>` route. CLI and child-agent chats are not assumed to be
Desktop chats. No prompt or follow-up is submitted.

Other agents with real activity can still appear, but unsupported activation
fails with a diagnostic rather than opening a guessed terminal.

## Ghostty pairing and manual fallback

Automatic registration validates the live Claude PID, birth time, tty ownership
and direct process ancestry leading to Ghostty. It briefly writes a unique OSC
title marker to terminal **output**, finds its exact UUID with AppleScript, and
restores the prior title. It never types commands or matches by directory,
ordinary title or foreground tab. A brief title flicker is possible.

macOS Automation access to Ghostty is required. Ghostty must support AppleScript
(1.3+) with `macos-applescript` enabled. No hook files or Ghostty configuration
are rewritten. Keep launching from the Dock and running Claude normally.

Established manual pairings take precedence for the same live process:

```sh
npm run session-launch -- list
npm run session-launch -- pair claude:SESSION_UUID GHOSTTY_TERMINAL_UUID
npm run session-launch -- open claude:SESSION_UUID
npm run session-launch -- discover claude:SESSION_UUID
npm run session-launch -- unpair claude:SESSION_UUID
```

`open` also accepts a verified `codex:CHAT_UUID` from the device roster.
Pairings contain PID/birth identity and terminal UUID. Stale/closed targets fail;
there is no guessed fallback, new terminal, or duplicate agent launch.
`sessionLaunch.last` records activation results; `registration` records pairing
results. Activity diagnostics additionally expose `switchableSessions` and
`sessionView`. Automatic registration never activates an app: explicit taps do.

## Recovery and limits

Ghostty 1.3.1 does not implement title-stack push/pop. An atomic, owner-only
`ghostty-title-probe.json` journal supports recovery. Restoration verifies
process identity again after Automation calls and preserves a newer Claude
title. A cleanup failure blocks new probes; manual activation still works.
Disabling automatic pairing cancels new probes and rejects in-flight results,
while an already-written marker still gets cleanup. Recovery never writes to a
reused tty. Do not delete an unresolved journal while a marker is visible.

Automatic pairing does not support tmux, screen, SSH, custom titles that hide the
marker, headless sessions or other terminal hosts. The switcher is an experiment,
not a general terminal/session manager. Native Settings UI and additional
terminal adapters remain future work. Local settings/rosters must not be committed.
A stock app update may replace the patched daemon.

## Non-disruptive validation

```sh
npm run test:session-launch
npm test --prefix daemon
```

Tests use fake terminals, tty writers and temporary metadata fixtures. They do
not create or close Ghostty windows. Coverage includes idle rosters, stale PIDs,
identical directories/titles, manual fallback, cancellation, recovery and exact
Codex activation with no pinning. For a live test, browse existing sessions and
tap the character. The retired multi-window harness must stay disabled: closing
terminals with running fixture commands caused blocking confirmation dialogs.

References:
- https://ghostty.org/docs/features/applescript
- https://github.com/ghostty-org/ghostty/blob/v1.3.1/src/termio/stream_handler.zig
