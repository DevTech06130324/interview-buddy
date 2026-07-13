'use strict';

const path = require('node:path');
const packageJson = require('../package.json');
const { validatePackagedContent } = require('./validate-packaged-content');

const projectRoot = path.resolve(__dirname, '..');
const outputDirectory = path.join(projectRoot, 'dist-packaged');

// These are development-only files. Keep the regular Packager defaults active
// so Electron itself, .git, and node_modules/.bin remain excluded as well.
const runtimeIgnorePatterns = [
  /(?:^|[/\\])(?:test|scripts|docs|\.codex|\.agents)(?:[/\\]|$)/,
  /(?:^|[/\\])(?:README(?:\.[^/\\]+)?|CHANGELOG(?:\.[^/\\]+)?|package-lock\.json|\.node-version|\.nvmrc|\.gitignore|\.gitkeep)$/,
  /(?:^|[/\\])native[/\\](?:binding\.gyp|package\.json|[^/\\]+\.(?:cpp|h))$/,
  /(?:^|[/\\])native[/\\]build[/\\](?!Release(?:[/\\]|$)).*/,
  /(?:^|[/\\])native[/\\]build[/\\]Release[/\\](?![^/\\]+\.node$).*/
];

async function packageWindows() {
  const { packager } = await import('@electron/packager');
  const appPaths = await packager({
    dir: projectRoot,
    name: packageJson.productName,
    platform: 'win32',
    arch: 'x64',
    out: outputDirectory,
    overwrite: true,
    prune: true,
    electronVersion: packageJson.devDependencies.electron,
    icon: path.join(projectRoot, 'assets', 'notepad-plus-plus'),
    asar: {
      unpackDir: 'native/build/Release'
    },
    ignore: runtimeIgnorePatterns,
    win32metadata: {
      CompanyName: 'Interview Buddy',
      FileDescription: 'Interview Buddy',
      ProductName: packageJson.productName,
      OriginalFilename: `${packageJson.productName}.exe`
    }
  });

  for (const appPath of appPaths) {
    await validatePackagedContent(appPath);
  }

  return appPaths;
}

if (require.main === module) {
  packageWindows()
    .then((appPaths) => {
      for (const appPath of appPaths) {
        console.log(`Packaged Windows x64 app: ${appPath}`);
      }
    })
    .catch((error) => {
      console.error(`[ERROR] Windows packaging failed: ${error.message || error}`);
      process.exitCode = 1;
    });
}

module.exports = {
  packageWindows,
  runtimeIgnorePatterns
};
