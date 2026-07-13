'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');

function buildNative() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('The Live Captions native addon is supported only on Windows x64.');
  }

  const electronVersion = require('electron/package.json').version;
  const command = process.platform === 'win32' ? 'node-gyp.cmd' : 'node-gyp';
  const result = childProcess.spawnSync(command, [
    'rebuild',
    `--target=${electronVersion}`,
    '--arch=x64',
    '--dist-url=https://electronjs.org/headers'
  ], {
    cwd: path.join(__dirname, '..', 'native'),
    stdio: 'inherit',
    windowsHide: true
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`node-gyp exited with status ${result.status}.`);
  }
}

if (require.main === module) {
  try {
    buildNative();
  } catch (error) {
    console.error(`[ERROR] Native addon build failed: ${error.message || error}`);
    process.exitCode = 1;
  }
}

module.exports = { buildNative };
