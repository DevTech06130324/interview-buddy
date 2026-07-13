const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validatePackagedContent } = require('../scripts/validate-packaged-content');

function createPackageFixture({ addon = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-buddy-package-'));
  const asarPath = path.join(root, 'resources', 'app.asar');
  const nativePath = path.join(root, 'resources', 'app.asar.unpacked', 'native', 'build', 'Release');
  fs.mkdirSync(path.dirname(asarPath), { recursive: true });
  fs.writeFileSync(asarPath, 'fixture');
  fs.mkdirSync(nativePath, { recursive: true });
  if (addon) {
    fs.writeFileSync(path.join(nativePath, 'livecaptions_native.node'), 'fixture');
  }
  return root;
}

test('packaged-content validation accepts runtime files and an unpacked native addon', async () => {
  const root = createPackageFixture();
  try {
    const result = await validatePackagedContent(root, {
      archiveEntries: ['main.js', 'package.json', 'src/captionSync.js']
    });
    assert.equal(result.nativeAddons.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('packaged-content validation rejects a missing native addon', async () => {
  const root = createPackageFixture({ addon: false });
  try {
    await assert.rejects(
      validatePackagedContent(root, { archiveEntries: ['main.js', 'package.json'] }),
      /No compiled native addon/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('packaged-content validation rejects development artifacts', async () => {
  const root = createPackageFixture();
  try {
    await assert.rejects(
      validatePackagedContent(root, {
        archiveEntries: ['main.js', 'package.json', 'test/fixtures/example.test.js']
      }),
      /Development artifacts/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
