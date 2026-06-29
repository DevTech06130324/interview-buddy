(function initPromptModeHelpers(root, factory) {
  const helpers = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = helpers;
  }

  if (root) {
    root.promptModeHelpers = Object.freeze(helpers);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createPromptModeHelpers() {
  function getSortedPromptModes(promptModes = []) {
    return [...promptModes].sort((left, right) => left.name.localeCompare(right.name, undefined, {
      sensitivity: 'base',
      numeric: true
    }));
  }

  return {
    getSortedPromptModes
  };
}));
