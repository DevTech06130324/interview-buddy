# Deepgram Reconciler Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Follow superpowers:test-driven-development for every production change.

**Goal:** Replace the race-prone Deepgram promise coordinator with one desired-state reconciler that deterministically converges to the latest user intent.

**Architecture:** Public lifecycle commands update one desired state and schedule one effect loop. The service provides typed, abortable supersession for connect/rotate/clear; main routes all lifecycle intent through the coordinator and never branches on transient phases.

**Tech Stack:** CommonJS JavaScript, Node test runner, Electron IPC, WebSocket fakes, AbortController.

## Global Constraints

- Windows x64 is the only production runtime; Linux is validation-only.
- Preserve both transcript backends and Task 1 Stop/Start versus Clear/session semantics.
- Preserve the 10,000 ms socket timeout, 16-chunk role buffer, 500/1000/2000 ms retries, 1000 ms renderer drain, and 1500 ms backend close grace.
- Stop/source switch/shutdown always win; latest API key always wins.
- Superseded operations are non-fatal; current transport exhaustion remains fail-closed.
- Renderer starts once per capture session and is not stopped for active key rotation.

---

### Task 1: Replace the coordinator with a desired-state reconciler

**Files:**
- Modify: `src/deepgramLifecycleCoordinator.js`
- Modify: `test/deepgramLifecycleCoordinator.test.js`

**Interfaces:**
- Produces: `start`, `stop`, `clear`, `setApiKey`, `shutdown`, `failClosed`, and `getState` as defined in the design spec.
- Consumes: service `start/stop/clear/rotateApiKey` and renderer `requestRendererStart/requestRendererStop`.

- [ ] Add RED tests that model Stop/source-switch/shutdown superseding queued Start, Clear interleavings, and three rapid key edits at every startup gate.
- [ ] Add invariant assertions: final state matches latest desired intent, renderer Start count is at most one, active rotation has zero renderer stops, and supersession emits no fatal state.
- [ ] Replace all promise-specific fields and recursive command queues with `desired`, `applied`, `revision`, one `reconcilePromise`, one `reconcileRequested` flag, and one cancellable supersedable effect.
- [ ] Run `node --test test/deepgramLifecycleCoordinator.test.js`; expected result is all coordinator tests passing with no timer or rejection warnings.

### Task 2: Add typed service supersession and integrate main

**Files:**
- Modify: `src/deepgramTranscriptionService.js`
- Modify: `main.js`
- Modify: `test/deepgramTranscriptionService.test.js`
- Modify: `test/deepgramLifecycleIntegration.test.js`
- Modify: `test/deepgramTranscriptUi.test.js`

**Interfaces:**
- Service `start`, `rotateApiKey`, and `clear` accept `{signal}` and reject expected cancellation with `error.code === 'DEEPGRAM_OPERATION_SUPERSEDED'` without emitting `fatalError`.
- Main routes every lifecycle operation through the coordinator; key edits call `setApiKey` without phase inspection.

- [ ] Add RED real-service tests for invalid intermediate key followed by a valid latest key, Stop during connect/clear/rotation, stale fatal events, and rapid key edits across renderer acknowledgement.
- [ ] Implement abort handling and invalidate service operation identity before rejecting readiness waiters.
- [ ] Remove direct service Clear and phase-based API-key routing from main; use coordinator commands for Clear, source switch, shutdown, and key updates.
- [ ] Run the service, lifecycle-integration, UI, Task 1 metadata, and secure-storage focused tests; expected result is all passing with the latest key on both role sockets and no duplicate renderer start.

### Task 3: Regression gate and review

**Files:**
- Modify only tests or production code needed to fix findings from this replacement.

- [ ] Run `npm test`; expected result is zero failed files.
- [ ] Run `git ls-files '*.js' -z | xargs -0 -n1 node --check`; expected exit is 0.
- [ ] Run `git diff --check`; expected exit is 0.
- [ ] Verify negative searches show no old coordinator fields: `startPromise`, `stopPromise`, `rotationPromise`, `rendererGateRotationPromise`, `connectingRestartPromise`, `pendingConnectingApiKey`, or `clearPromise` in `src/deepgramLifecycleCoordinator.js`.
- [ ] Obtain an independent review focused on lifecycle convergence, supersession, stale callbacks, and key security; fix every Critical/Important finding before resuming the broader upgrade.
