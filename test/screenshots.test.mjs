import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capturePath } from '../scripts/screenshots.mjs';

test('capture paths preserve accents, isolate regions, and cannot escape the screenshots folder', () => {
  const character = { slug: 'thè-demiurge', region: 'us', profile: { level: 16 } };
  const now = new Date('2026-11-12T12:34:56Z');
  assert.equal(capturePath(character, now), 'screenshots/thè-demiurge_us/20261112_thè-demiurge_LEVEL16.png');
  assert.notEqual(capturePath(character, now), capturePath({ ...character, region: 'eu' }, now));
  assert.ok(!capturePath({ ...character, slug: '../../escape' }, now).includes('..'));
});
