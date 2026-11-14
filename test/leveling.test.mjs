import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recommendations } from '../site/leveling.js';

test('uses faction routes and a racial starting zone where appropriate', () => {
  const horde = recommendations({ level: 10, faction: 'Horde', race: 'Undead' });
  const alliance = recommendations({ level: 10, faction: 'Alliance', race: 'Human' });
  assert.deepEqual(horde.zones.map((p) => p.name), ['Tirisfal Glades', 'The Barrens', 'Silverpine Forest']);
  assert.deepEqual(alliance.zones.map((p) => p.name), ['Elwynn Forest', 'Westfall', 'Loch Modan', 'Darkshore']);
  assert.equal(recommendations({ level: 18, faction: 'Horde' }).zones[1].name, 'Stonetalon Mountains');
});

test('includes both dungeon range endpoints and filters faction city dungeons', () => {
  const dungeons = (level, faction) => recommendations({ level, faction }).dungeons.map((p) => p.name);
  assert.ok(dungeons(13, 'Horde').includes('Ragefire Chasm'));
  assert.ok(dungeons(18, 'Horde').includes('Ragefire Chasm'));
  assert.ok(!dungeons(19, 'Horde').includes('Ragefire Chasm'));
  assert.ok(!dungeons(13, 'Alliance').includes('Ragefire Chasm'));
  assert.ok(!dungeons(13, 'Horde').includes('Hall of Thanes'));
  assert.ok(dungeons(60, 'Alliance').includes("Shaper's Terrace"));
});

test('has map coordinates for both faction routes and all dungeon matches', () => {
  for (const faction of ['Horde', 'Alliance']) {
    for (let level = 10; level <= 60; level += 1) {
      const { zones, dungeons } = recommendations({ level, faction });
      assert.ok(zones.length > 0);
      for (const { name, position } of [...zones, ...dungeons]) {
        assert.ok(position, name);
        assert.ok(position[0] >= 0 && position[0] <= 1497, name);
        assert.ok(position[1] >= 0 && position[1] <= 855, name);
      }
    }
  }
  assert.equal(recommendations({ level: null }), null);
});
