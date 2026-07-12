# Deepgram Desired-State Reconciler Design

## Problem

The current coordinator represents lifecycle intent with transient phases, six overlapping promise fields, operation IDs, pending-key flags, and recursive `.then()` queues. Main and the WebSocket service also make independent lifecycle decisions. Commands can therefore become obsolete while waiting and later execute against a newer user intent.

Confirmed failures include queued Start surviving Stop/source switch, normal cancellation being reported as fatal, rapid API-key edits being lost, and extra renderer capture restarts. Repeated local fixes exposed new interleavings, so the coordinator architecture must be replaced rather than patched again.

## Goals and invariants

- One component is the sole owner of desired and applied Deepgram lifecycle state.
- Stop, source switch, and shutdown always win over older work.
- Any number of API-key edits converges on the latest key.
- Connecting-phase key supersession never starts the renderer more than once.
- Active key rotation replaces sockets without stopping renderer capture or clearing transcript/cursors.
- Clear creates a new transcript session while preserving active capture when Deepgram remains desired.
- Expected cancellation/supersession is never emitted as a fatal error.
- Only failures belonging to the current desired revision can fail capture closed.
- Task 1 session semantics and all Task 2 timing/resource limits remain unchanged.

## Architecture

`DeepgramLifecycleCoordinator` becomes a desired-state reconciler. Public commands synchronously update `desired`, increment `revision`, optionally cancel only a supersedable effect, and schedule one reconciliation loop. No command waits on another command and then recursively calls itself.

```js
desired = {
  shouldRun: false,
  apiKey: '',
  sessionRevision: 0,
  shutdownRequested: false,
  reason: 'inactive',
  revision: 0
};

applied = {
  backendReady: false,
  rendererActive: false,
  apiKey: '',
  sessionRevision: 0
};
```

The coordinator exposes:

```js
start({ apiKey })
stop({ reason = 'stopped' })
clear()
setApiKey({ apiKey })
shutdown()
failClosed(error, { revision } = {})
getState()
```

Every command returns the current reconciliation promise, which resolves only after the loop has converged to the latest desired revision.

## Reconciliation rules

Only `reconcile()` may call renderer or service lifecycle effects.

1. If `desired.shouldRun` is false, drain renderer if active, stop backend, publish inactive, and do not restart unless a newer explicit Start changes desired state.
2. If the session revision changed, cancel a supersedable connect/rotation, call service Clear, and retain renderer capture when the desired source remains Deepgram.
3. If backend is not ready, start it using the latest desired key. A newer key aborts/supersedes that connection and the loop starts again with the latest snapshot.
4. If backend is ready under an old key, rotate sockets to the latest key. Multiple edits collapse into one latest-key convergence; renderer remains active.
5. If backend is ready and renderer is inactive, request renderer Start exactly once.
6. Publish active only when backend and renderer match the same current desired revision.

The loop uses `reconcileRequested` plus one `reconcilePromise`:

```js
do {
  reconcileRequested = false;
  await reconcileLatestDesiredState();
} while (reconcileRequested || !stateMatchesDesired());
```

Commands arriving during cleanup do not abort renderer/backend Stop; they only update desired state, and the loop reevaluates after cleanup finishes. Commands arriving during connect, rotate, or clear abort that supersedable effect through an `AbortController` and schedule reconciliation.

## Service cancellation contract

`DeepgramTranscriptionService.start`, `rotateApiKey`, and `clear` accept an optional `signal`. Supersession invalidates socket/readiness identity, closes replaced connecting sockets, and rejects with an error whose code is `DEEPGRAM_OPERATION_SUPERSEDED`.

The service never emits `fatalError` for that code. Transport retry exhaustion, buffer overflow, and current-operation protocol failures remain fatal. Stop invalidates service operation identity before rejecting readiness waiters.

## Main-process integration

Main no longer examines transient lifecycle phase to decide how to apply a key. When Deepgram is the selected source, every non-empty key edit calls `coordinator.setApiKey({apiKey})`; when inactive this only records the desired key, and when starting/active the reconciler converges appropriately.

Start, Stop, Clear, source switch, and shutdown call only coordinator commands. Main does not call service lifecycle methods directly. Service fatal events include the originating revision/generation; stale fatal events are ignored.

## Verification model

Deterministic tests use controllable promises and the real service where cross-layer behavior matters. Invariants are checked across command sequences:

- A terminal Stop/source switch/shutdown leaves backend and renderer inactive with no later restart.
- Two or more key edits during connecting, renderer acknowledgement, rotation, and failure converge to the final key.
- Renderer Start occurs once per capture session; active rotation causes zero renderer stops.
- Clear combined with Stop or key edits cannot emit false fatal errors.
- Superseded service completions and socket callbacks cannot publish state or audio.
- Retry, buffering, graceful-close, session identity, capture cleanup, and secure-storage tests remain green.

Windows x64 runtime and packaged verification remain required release gates and are not claimed from Linux.
