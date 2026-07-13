const ASSISTANT_MUTATION_STATUS = Object.freeze({
  ACQUIRED: 'acquired',
  BUSY: 'busy',
  COMPLETED: 'completed',
  FAILED: 'failed'
});

function assertTabId(tabId) {
  if (tabId === null || tabId === undefined) {
    throw new TypeError('A tab ID is required for an assistant mutation.');
  }
}

class AssistantMutationController {
  constructor() {
    this.activeTokens = new Map();
  }

  isActive(tabId) {
    return this.activeTokens.has(tabId);
  }

  release(tabId) {
    return this.activeTokens.delete(tabId);
  }

  acquire(tabId) {
    assertTabId(tabId);

    if (this.activeTokens.has(tabId)) {
      return {
        status: ASSISTANT_MUTATION_STATUS.BUSY,
        tabId
      };
    }

    const token = Symbol('assistant-mutation');
    this.activeTokens.set(tabId, token);
    let released = false;

    return {
      status: ASSISTANT_MUTATION_STATUS.ACQUIRED,
      tabId,
      release: () => {
        if (released || this.activeTokens.get(tabId) !== token) {
          return false;
        }

        released = true;
        this.activeTokens.delete(tabId);
        return true;
      }
    };
  }

  async run(tabId, operation) {
    const lease = this.acquire(tabId);
    if (lease.status === ASSISTANT_MUTATION_STATUS.BUSY) {
      return lease;
    }

    try {
      if (typeof operation !== 'function') {
        throw new TypeError('Assistant mutation operation must be a function.');
      }

      return {
        status: ASSISTANT_MUTATION_STATUS.COMPLETED,
        tabId,
        value: await operation()
      };
    } catch (error) {
      return {
        status: ASSISTANT_MUTATION_STATUS.FAILED,
        tabId,
        error
      };
    } finally {
      lease.release();
    }
  }
}

module.exports = {
  ASSISTANT_MUTATION_STATUS,
  AssistantMutationController
};
