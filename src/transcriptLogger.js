const fs = require('fs');
const path = require('path');

const LOG_FILE_PATH = path.join(__dirname, '..', 'logs.txt');

let writeQueue = Promise.resolve();
let sequence = 0;

function serializeValue(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }

  return value;
}

function logTranscriptEvent(event, details = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    sequence: ++sequence,
    event,
    ...details
  };

  const line = `${JSON.stringify(record, (key, value) => serializeValue(value))}\n`;

  writeQueue = writeQueue
    .then(() => fs.promises.appendFile(LOG_FILE_PATH, line, 'utf8'))
    .catch((error) => {
      console.error('[WARNING] Failed to write transcript debug log:', error);
    });
}

module.exports = {
  logTranscriptEvent,
  LOG_FILE_PATH
};
