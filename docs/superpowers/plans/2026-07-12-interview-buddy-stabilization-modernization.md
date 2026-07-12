# Interview Buddy Stabilization and Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every production behavior change. Record RED and GREEN evidence in the task report.

**Goal:** Make every supported Interview Buddy workflow reliable end to end, remove proven dead code, and modernize the Windows-only Electron application without changing its product identity or user-data location.

**Architecture:** Stabilize behavior behind focused modules and executable tests before migrating Electron infrastructure. Phase 1 must pass the Linux-safe automated gate; Windows x64 runtime verification remains a required release gate and is never represented as executed in this environment. Phase 2 is implemented only after Phase 1 automated verification and review are clean.

**Tech Stack:** CommonJS JavaScript, Electron, Node's built-in test runner, Windows UI Automation native addon, Deepgram WebSockets, Node worker threads.

## Global Constraints

- Windows x64 is the only supported production runtime; Linux is validation-only.
- Preserve Live Captions and Deepgram, with `Them` = system/speaker output and `Me` = microphone input.
- Preserve the `Notepadd++` executable/product identity and existing user-data location.
- Never persist the Deepgram API key as plaintext; if secure storage is unavailable, keep it in memory for the current session only.
- Never advance a send cursor unless assistant submission is confirmed.
- If a transcript cursor boundary cannot be verified, fail closed with an explicit cursor-mismatch result; do not truncate, resend automatically, or advance the cursor.
- Do not claim the Windows runtime/package gate passed from this Linux workspace.

---

### Task 1: Transcript integrity and display grouping

Repair `src/transcriptCursor.js`, Deepgram entry identity, and `src/transcriptDisplayGroups.js` using behavioral tests.

- Add failing tests for punctuation-length mismatch, unrelated text, reused entry IDs with changed content, stop/resume continuity, clear isolation, late old-session messages, and same-speaker size caps.
- Cursor APIs must return an explicit mismatch state when no exact raw boundary or exact entry identity/content boundary is proven. Callers must surface retry/reset state and keep cursors unchanged.
- Add a unique session ID to emitted Deepgram entry IDs and preserve monotonic role counters across stop/resume.
- `clear()` creates a new session, drops buffers, resets entries/counters, invalidates old socket callbacks, and causes main to reset submitted/clipboard cursors.
- Speaker changes always start a new display group; same-speaker entries continue only while both configured entry and character caps permit.

### Task 2: Transactional Deepgram lifecycle

Make service, renderer capture, main IPC, settings, and shutdown one coherent lifecycle.

- Extract `src/deepgramCaptureController.js`; it owns acquired streams immediately and stops every unique track exactly once on partial startup, recorder error, cancel, or stop.
- Service start waits for both sockets, each with a 10-second open timeout. Main reports active only after backend readiness and renderer capture acknowledgement.
- Renderer stop waits up to 1 second for final recorder chunks. Service sends `CloseStream`, waits up to 1.5 seconds for final messages/server close, then force-closes.
- Remove the unused Finalize API.
- For each failed role, retain at most 16 500-ms chunks and retry after 500 ms, 1 second, and 2 seconds. Exhaustion or overflow fails the entire capture closed.
- Guard socket callbacks with session/socket identity. A healthy role continues while its peer reconnects.
- API-key changes reconnect both roles without clearing transcript, counters, cursors, or renderer capture.
- Secure-storage-unavailable keys remain memory-only; legacy plaintext is removed from disk and re-encrypted when possible.
- Stop the display video track after constructing the audio-only recording stream.

### Task 3: Non-blocking Live Captions

Move Windows-native ownership off Electron's main thread and distinguish empty data from failures.

- Add `src/liveCaptionsWorker.js` and a main-side worker client. The worker alone loads/owns the native addon, polls, and handles launch/restart/visibility/close commands.
- Return `{status: 'ok', text}` or `{status: 'unavailable', code, message}` from the native/JS boundary.
- Empty successful reads and unavailable reads preserve accumulated transcript; only explicit Clear resets it.
- Emit a recoverable source error after three consecutive unavailable reads.
- Restart a crashed worker once; a second crash closes the source and exposes manual retry.
- Preserve whether Live Captions was pre-existing or launched by the app so shutdown closes only app-owned processes.

### Task 4: Assistant, navigation, and screenshot correctness

Extract testable policies/state machines and integrate them into `main.js`.

- Add a pure popup/navigation policy returning `popup`, `same-tab`, or `deny`. Supported assistant/OAuth popups remain real hardened BrowserWindows with opener/POST semantics; remove legacy `new-window` handling.
- Observe failed loads, renderer-process loss, normal navigation, and in-page navigation without unhandled `loadURL()` rejections.
- Serialize assistant mutations per tab. Submission returns `not-dispatched`, `confirmed-sent`, or `unknown-after-dispatch`; only `not-dispatched` permits another strategy.
- Unknown-after-dispatch stops fallbacks, does not advance the cursor, and exposes retry status.
- Upload succeeds only when attachment evidence is observed.
- Selected-area capture closes/awaits the overlay before a fresh capture and requires an exact requested display source.

### Task 5: Renderer persistence, status, layout, and accessibility

Make renderer-facing state explicit and preserve compact-window usability.

- Use structured transcript errors `{source, code, message, recoverable}` while temporarily accepting legacy strings.
- Expose source phases `inactive`, `connecting`, `active`, `reconnecting`, `stopping`, and `error`, plus session/retry data where applicable.
- Send prompt drafts to main immediately; main owns the latest revision, debounces disk writes, and flushes on mode switch and shutdown. Failures preserve dirty state and appear in a live status region.
- Route inline mode updates through rename deferral.
- At 400x300, cap/scroll the expanded mode panel so at least 120 px remains for transcript/browser content; wrap transcript actions below 520 px.
- Add accessible names, tooltip `aria-describedby`, 10-pixel keyboard separator resizing, roving menu focus, correct nested close-button handling, and textual hotkey status.
- Limit speaker-tagged transcript rows to 82% width.

### Task 6: Dead-code removal, performance, and documentation

Remove only symbols proven unused after preceding behavior is covered.

- Remove the no-op transcript logger/call payloads and logger-only state; unused active-tab IPC; unused key/assistant exports; write-only history; obsolete aliases/CSS states/assets; invalid unused native manifest; and now-obsolete legacy popup/finalize code.
- Stop preference writes for tab-only events.
- Emit one translation update per reconciliation pass and retain normalization only at trust boundaries.
- Update README controls, speaker-only transcript format, Windows prerequisites, secure key behavior, and build instructions without rebranding.
- Run negative `rg` sweeps for every removed symbol and asset.

### Task 7: Phase 1 automated gate and review

- Run `npm test`, syntax-check every tracked JavaScript file, and run `git diff --check`.
- Review all Phase 1 changes against Tasks 1-6 and fix Critical/Important findings.
- Record the Windows x64 unpackaged/packaged acceptance matrix as pending; do not mark it passed.

### Task 8: BrowserView to WebContentsView migration

- While still on Electron 41, add attach/detach/destroy helpers and replace BrowserView tabs with WebContentsView.
- Attach only the active view to `BrowserWindow.contentView`; keep inactive webContents alive but detached.
- Preserve preload APIs, sizing, tab behavior, navigation, OAuth popups, and assistant automation.
- Run focused tab tests and the complete automated gate before dependency modernization.

### Task 9: Node, packaging, and Electron modernization

- Set `engines.node` and repository version files to `>=22.12.0`.
- Replace `electron-packager` with `@electron/packager` while preserving the `dist-packaged` script name.
- Exclude tests, docs, repository metadata, native sources, and development assets from the bundle; keep `native/build/Release/*.node` unpacked and assert package contents.
- Pin the current stable Electron version selected during implementation exactly, rebuild-lock dependencies, and do not combine unrelated dependency major upgrades.

### Task 10: Final verification and release handoff

- Run the full automated, syntax, diff, dependency, and package-configuration checks with Node 22.12+.
- Run a whole-branch review and fix all Critical/Important findings.
- Provide the exact Windows x64 runtime matrix covering both transcript sources, OAuth, hotkeys, screenshots, persistence, native loading, packaging, and clean shutdown as the remaining release gate.
