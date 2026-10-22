# Physical-device recording demo

This experiment stages a scripted Claude Code demonstration using a supplied session title and project. It does not replay transcript events or run Claude tasks.

Build the daemon (`npm run build --prefix daemon`) and run that build as the companion service, then run `node experiments/device-demo/server.mjs` from the repository root. Open http://127.0.0.1:4877/ and choose **Stage another take → Stage paused**. The existing device character is preserved.

Start recording the physical device, then click **Start · 5-second lead-in**. After the countdown, the sequence is Ready (5s), Working (12s), Needs input (8s), Working (8s), Finished (4s), Quiet idle (8s), and Sleeping (10s). Pause holds the stage clock while character animation continues. Next stage and Restart paused support repeat takes.

The daemon overrides physical-device state, badges, and caption lines while live hook/session state keeps updating underneath. USB and Wi-Fi use the same isolation. The demo ends isolated with the sleeping animation (the firmware eventually returns to idle naturally) until **Exit to live activity** restores the latest live state. Closing the browser does not exit the demo; restarting the daemon does. Keep the device connected and avoid installing firmware or characters during a take.

The operator server listens only on loopback and validates Host, Origin, action, and request size. It is a local experiment, not part of the packaged Settings interface.

The explicit sleep stage requires this branch’s firmware with the `sleep` mode command. Normal live idle still enters sleep after two minutes.

## Activity inspector

From the repository root, run:

```sh
cd ~/repos/agent-buddy
npm run inspector
```

This opens http://127.0.0.1:4877/activity in your default browser, reuses an existing inspector if one is already running, or starts it in the foreground. Keep that terminal open; Ctrl+C stops the inspector only. Use `npm run inspector -- --no-open` to print the URL without opening a browser. To reopen recording controls, use the link at the top of the inspector.

Prerequisites: Node.js 24.11 or newer and the Agent Companion service running this fork’s diagnostic runtime. The launcher checks that service before starting. If the local client has not been built, it runs the daemon build; install dependencies with `npm ci --prefix daemon` first if needed. On a fresh development setup, build with `npm run build --prefix daemon`, stop an already-running companion service before launching another one, then run `npm start --prefix daemon` in a separate terminal. Do not run a second daemon against the same socket/device. The inspector does not install, flash, restart, or replace your service. If an upstream app update replaces the experimental runtime, the launcher reports that diagnostics are unavailable rather than silently patching it.

If port 4877 belongs to another application, the server reports a bind error; stop that application or the previous inspector before retrying. If the page reports a disconnected service, start Agent Companion and refresh the page.

Open the inspector to see live state, driving sessions, lease expiry times, and the latest 250 normalized hooks/timer events. Filter by title, agent, or session ID and pause updates when inspecting an event. The private daemon socket also accepts `{"type":"activity"}`.

History is stored in `activity-history.json` in the companion data directory with owner-only file permissions. It survives service restarts and contains only routing metadata: event type, session ID, tool name, notification type, resume source, and before/after state. It excludes prompts, command text, tool arguments/results, and message bodies. Only events reaching the coordinator are recorded; notifications discarded by an adapter and hooks that fail before delivery will not appear. Historic events before installation cannot be reconstructed.

Claude normal Stop now clears prior attention, and informational Notification types no longer create attention. Explicit permission and question notifications still do. No hook settings are rewritten. The standard ten-minute work lease and thirty-minute attention lease are unchanged.

Session titles are looked up from Codex sidebar/index metadata and Claude explicit custom-title records. They appear on both session cards and history rows; exact IDs stay visible. Metadata lookup is cached and bounded, so a newly renamed title may take a few refreshes to appear, especially in a large Claude transcript. A missing title is labeled “Title unavailable”; the inspector never substitutes the first prompt. Titles are looked up for retained history even after the live session ends. They are not added to the persisted event log.

Approval events use “approval requested” in device captions, distinct from “needs input” for questions and “hit an error” for errors. Codex permission requests are recorded without changing display state or playing an attention cue when the latest matching session turn metadata identifies `auto_review` or `guardian_subagent`. The inspector marks these “Automatic review · no alert”. Only bounded, validated transcript metadata is used; no global setting is assumed to apply to every session. Missing/unknown metadata retains the usual behavior. This metadata is version-dependent. The hook API does not reliably identify an automatic-review handoff to a manual approval prompt, so that fallback cannot yet be promised. Existing explicit input notifications remain active.

## Multiple active sessions

When the optional [session launcher](../session-launch/README.md) is enabled,
idle sessions remain available: numbered indicators select and activate in one
tap, title/footer taps browse, and portrait taps open the selected session.
Protocol 14 preserves rapid taps in order over Wi-Fi and coalesces pending OS
activation requests to the latest selected target. Manual selection lasts 12
seconds, then active sessions rotate every eight seconds. Subagents contribute
to their parent's working state; they do not get separate buttons.

The behavior below applies when session launching is **disabled**:


With device captions enabled, active sessions rotate every eight seconds. The
caption's `1:2` indicator means session one of two; the agent badge follows the
same session. Tap the **caption area** at the bottom to advance immediately.
Tap the **character area** to pin/unpin. While pinned, advancing moves the pin
as well. Pin a long title to read all its pages without rotation. Swipe-up still
opens Settings. With no active badges/captions, character taps still surprise.

Real questions interrupt a pinned working session. The pin returns after the
question clears, unless its session has finished. A completion hidden by other
work gets an eight-second notice; real questions take priority over notices.
Queued notices expire after 45 seconds and are cancelled if that session starts
working again. Pins are temporary and reset on service restart. This changes
presentation only, never whether a session is actually working or waiting.

The inspector exposes **Next session** and **Pin/Unpin session** for the same
controls and shows the selected session separately from the aggregate live state.
Firmware and daemon updates are both required for touch. USB responds immediately;
Wi-Fi picks up touch counters on its next status poll. Rapid mixed taps over Wi-Fi
may be grouped by action; use USB for responsive recording. Recording demo mode
ignores focus controls and remains isolated from live hooks.
