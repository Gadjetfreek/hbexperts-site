import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');

function sourceFiles(directory) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

test('public base tag is scoped to the buyer representation landing page', () => {
  const layout = readFileSync(join(root, 'themes/hbe/layouts/_default/baseof.html'), 'utf8');
  assert.match(layout, /if eq \.RelPermalink "\/buyer-representation\/"/);
  assert.equal((layout.match(/AW-18500305800/g) || []).length, 2);
  assert.ok(layout.indexOf('AW-18500305800') < layout.indexOf('<meta charset="utf-8">'));
});

test('secure buyer platform never loads Google Ads or widens CSP for Google', () => {
  const secureSource = sourceFiles(join(root, 'secure-platform/src'))
    .filter(path => path.endsWith('.js'))
    .map(path => readFileSync(path, 'utf8'))
    .join('\n');
  assert.doesNotMatch(secureSource, /googletagmanager|googleadservices|AW-18500305800|send_to|GOOGLE_ADS/i);
});

test('privacy disclosure limits Google Ads measurement to the public landing page', () => {
  const privacy = readFileSync(join(root, 'content/privacy.md'), 'utf8');
  assert.match(privacy, /Google Ads measurement only on the public paid-search landing page/);
  assert.doesNotMatch(privacy, /non-sensitive confirmation|successful-submission confirmation|confirmation response may use the same tag/i);
});
