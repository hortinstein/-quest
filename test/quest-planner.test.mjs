import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { questChains, sharedQuests } from '../site/quest-planner.js';

test('catalog includes objectives and chain metadata for a quest missing from the dialog provider', () => {
  const quests = JSON.parse(gunzipSync(readFileSync(new URL('../site/data/quest-catalog.json.gz', import.meta.url))));
  const quest = quests.find(({ id }) => id === 821);
  assert.equal(quest.zone, 'The Barrens');
  assert.match(quest.objectives, /Brewmaster Drohn/);
  const chains = questChains(quests);
  assert.equal(chains.get(821), chains.get(819));
  assert.equal(quests.find(({ id }) => id === 97891).zone, 'Undercity');
});

test('shared suggestions consider known restrictions and distinct compatible players', () => {
  const player = (key, properties = {}) => ({
    key, person: key, region: 'us',
    profile: { level: 20, faction: 'Horde', ruleset: 'PvP', race: 'Orc' },
    questLog: { completed: [{ id: 1 }] },
    ...properties,
  });
  const leader = player('leader');
  const friend = player('friend');
  const party = [
    leader, friend, player('alt', { person: 'friend' }),
    player('other region', { region: 'eu' }),
    player('outdated', { questLog: { completed: [{ id: 1 }], error: 'Sync failed' } }),
    player('already done', { questLog: { completed: [{ id: 1 }], history: [{ id: 2 }] } }),
    player('missing prereq', { questLog: { completed: [] } }),
  ];
  const base = { zone: 'The Barrens', level: 19, minLevel: 10 };
  const candidates = [
    { ...base, id: 1 },
    { ...base, id: 2, anyOf: [1], raceMask: 8589934770 },
    { ...base, id: 3, allOf: [1, 9] },
    { ...base, id: 4, minLevel: 21 },
    { ...base, id: 5, raceMask: 4294967373 },
    { ...base, id: 6, restricted: true },
  ];
  const results = sharedQuests(candidates, leader, party);
  assert.deepEqual(results.map(({ id, players }) => [id, players.map(({ key }) => key)]), [[2, ['leader', 'friend']]]);
});
