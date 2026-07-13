const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageJson = require('../package.json');

test('Windows packaging uses exact Electron, Node 22.12+, and @electron/packager', () => {
  assert.equal(packageJson.engines.node, '>=22.12.0');
  assert.equal(packageJson.devDependencies['@electron/asar'], '4.2.0');
  assert.equal(packageJson.devDependencies.electron, '43.1.0');
  assert.equal(packageJson.devDependencies['@electron/packager'], '20.0.2');
  assert.equal(packageJson.devDependencies['electron-packager'], undefined);
  assert.equal(packageJson.scripts['dist-packaged'], 'npm run build-native && node scripts/package-windows.js');
  assert.equal(packageJson.scripts['validate-packaged-content'], 'node scripts/validate-packaged-content.js');
  assert.equal(fs.readFileSync(path.join(__dirname, '..', '.node-version'), 'utf8').trim(), '22.12.0');
});

test('packaging scripts retain the Windows x64 and native addon contracts', () => {
  const buildScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-native.js'), 'utf8');
  const packageScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'package-windows.js'), 'utf8');
  const releaseScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify-windows-release.ps1'), 'utf8');

  assert.match(buildScript, /Windows x64/);
  assert.match(buildScript, /--arch=x64/);
  assert.match(packageScript, /platform: 'win32'/);
  assert.match(packageScript, /arch: 'x64'/);
  assert.match(packageScript, /unpackDir: 'native\/build\/Release'/);
  assert.match(packageScript, /package-lock/);
  assert.match(packageScript, /native/);
  assert.match(releaseScript, /npm ci/);
  assert.match(releaseScript, /npm run build-native/);
  assert.match(releaseScript, /npm run dist-packaged/);
  assert.match(releaseScript, /validate-packaged-content/);
});
