// Guards the test-only lockfile used by worker-bundle.test.mjs (Sentinel R32 M1). Synthetic, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'bundle-deps');

test('bundle-test deps are pinned by a committed lockfile from the public npm registry', () => {
  const pkg = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(DIR, 'package-lock.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies, { jsdom: '24.1.3' }, 'exact jsdom pin, nothing else');
  assert.ok(lock.lockfileVersion >= 3);
  assert.deepEqual(lock.packages[''].dependencies, { jsdom: '24.1.3' });
  assert.equal(lock.packages['node_modules/jsdom'].version, '24.1.3');
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name) continue;
    assert.match(entry.resolved || '', /^https:\/\/registry\.npmjs\.org\//, `${name} resolves from registry.npmjs.org`);
    assert.match(entry.integrity || '', /^sha512-/, `${name} has a sha512 integrity hash`);
  }
});

test('worker-bundle test installs from the lockfile with npm ci --ignore-scripts and keeps the wrangler pin', () => {
  const src = readFileSync(join(DIR, '..', 'worker-bundle.test.mjs'), 'utf8');
  assert.match(src, /'ci', '--ignore-scripts'/);
  assert.doesNotMatch(src, /'install'/);
  assert.match(src, /const WRANGLER_VERSION = '4\.134\.0'/);
  assert.match(readFileSync(join(DIR, '..', '..', 'deploy.ps1'), 'utf8'), /'4\.134\.0'/);
});
