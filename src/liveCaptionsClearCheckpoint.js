function normalizeCheckpoint(value) {
    return {
        clearSessionActive: Boolean(value?.clearSessionActive),
        clearBaselineText: typeof value?.clearBaselineText === 'string'
            ? value.clearBaselineText
            : '',
        postClearText: typeof value?.postClearText === 'string'
            ? value.postClearText
            : '',
        lastSuccessfulRawText: typeof value?.lastSuccessfulRawText === 'string'
            ? value.lastSuccessfulRawText
            : ''
    };
}

module.exports = {
    normalizeCheckpoint
};
