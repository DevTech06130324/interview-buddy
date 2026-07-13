function getCaptionSyncErrorLifecycleState(error, sourceState = {}) {
    const recoverable = error?.recoverable === true;
    const sourceIsActive = recoverable && sourceState.active === true;

    return {
        ...sourceState,
        phase: sourceIsActive ? 'active' : 'error',
        active: sourceIsActive,
        error: error?.message || String(error || 'Live Captions source error.'),
        reason: error?.code || 'source-error'
    };
}

module.exports = {
    getCaptionSyncErrorLifecycleState
};
