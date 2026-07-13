'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_RUNTIME_ENTRIES = new Set(['main.js', 'package.json']);
const FORBIDDEN_ARCHIVE_ENTRY_PATTERNS = [
  /^(?:test|scripts|docs)(?:\/|$)/,
  /^(?:\.git|\.codex|\.agents)(?:\/|$)/,
  /^(?:README|CHANGELOG)(?:\.[^/]+)?$/,
  /^package-lock\.json$/,
  /^native\/build(?:\/|$)/,
  /^native\/(?:binding\.gyp|package\.json|[^/]+\.(?:cpp|h))$/
];

function normalizeArchiveEntry(entry) {
  return String(entry || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

async function getArchiveEntries(archivePath, asarModule) {
  const asar = asarModule || await import('@electron/asar');
  if (!asar || typeof asar.listPackage !== 'function') {
    throw new Error('The @electron/asar listPackage API is required to inspect packaged contents.');
  }
  const entries = await asar.listPackage(archivePath);
  return entries.map(normalizeArchiveEntry);
}

function findNativeAddon(unpackedNativeDirectory, fsModule = fs) {
  if (!fsModule.existsSync(unpackedNativeDirectory)) {
    return [];
  }

  return fsModule.readdirSync(unpackedNativeDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.node'))
    .map((entry) => path.join(unpackedNativeDirectory, entry.name));
}

async function validatePackagedContent(appDirectory, options = {}) {
  const fsModule = options.fsModule || fs;
  const appAsarPath = path.join(appDirectory, 'resources', 'app.asar');
  const unpackedNativeDirectory = path.join(
    appDirectory,
    'resources',
    'app.asar.unpacked',
    'native',
    'build',
    'Release'
  );

  if (!fsModule.existsSync(appAsarPath)) {
    throw new Error(`Packaged app archive is missing: ${appAsarPath}`);
  }

  const nativeAddons = findNativeAddon(unpackedNativeDirectory, fsModule);
  if (nativeAddons.length === 0) {
    throw new Error(`No compiled native addon was found under ${unpackedNativeDirectory}`);
  }
  if (!nativeAddons.some((addonPath) => path.basename(addonPath) === 'livecaptions_native.node')) {
    throw new Error('The packaged Live Captions addon livecaptions_native.node is missing.');
  }

  const entries = options.archiveEntries
    ? options.archiveEntries.map(normalizeArchiveEntry)
    : await getArchiveEntries(appAsarPath, options.asarModule);
  const missingRuntimeEntries = [...REQUIRED_RUNTIME_ENTRIES]
    .filter((entry) => !entries.includes(entry));
  if (missingRuntimeEntries.length > 0) {
    throw new Error(`Packaged app is missing runtime entries: ${missingRuntimeEntries.join(', ')}`);
  }

  const forbiddenEntries = entries.filter((entry) => (
    FORBIDDEN_ARCHIVE_ENTRY_PATTERNS.some((pattern) => pattern.test(entry))
  ));
  if (forbiddenEntries.length > 0) {
    throw new Error(`Development artifacts were packaged: ${forbiddenEntries.join(', ')}`);
  }

  return {
    appDirectory,
    appAsarPath,
    nativeAddons,
    entries
  };
}

if (require.main === module) {
  const appDirectory = process.argv[2] || process.env.PACKAGED_APP_DIR;
  if (!appDirectory) {
    console.error('Usage: npm run validate-packaged-content -- <packaged-app-directory>');
    process.exitCode = 1;
  } else {
    validatePackagedContent(path.resolve(appDirectory))
      .then((result) => {
        console.log(`Packaged content validated: ${result.nativeAddons.length} native addon(s).`);
      })
      .catch((error) => {
        console.error(`[ERROR] Packaged content validation failed: ${error.message || error}`);
        process.exitCode = 1;
      });
  }
}

module.exports = {
  FORBIDDEN_ARCHIVE_ENTRY_PATTERNS,
  REQUIRED_RUNTIME_ENTRIES,
  validatePackagedContent
};
