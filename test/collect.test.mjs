import assert from 'node:assert/strict';
import { test } from 'node:test';
import { armoryUrl, collect, extractCharacter, parseWatched } from '../scripts/collect.mjs';

const sleep = async () => {};

const character = (level, extra = {}) => ({
  name: 'Thè',
  surname: 'Demiurge',
  level,
  averageItemLevel: 4,
  class: { name: 'Priest' },
  race: { name: 'Undead' },
  faction: { name: 'Horde' },
  ruleset: { name: 'PvP' },
  pvp: { honorableKills: { value: 0 } },
  lastUpdatedTimestamp: { iso8601: '2026-11-09T02:40:51Z' },
  professions: {
    primaries: [{ name: 'Tailoring', tiers: [{ skillPoints: 41, maxSkillPoints: 75 }] }],
    secondaries: [],
  },
  ...extra,
});

const page = (c) =>
  new Response(`<html><script>var characterProfileInitialState = ${JSON.stringify({ character: c })};\n</script></html>`);

function site(handler) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return handler(String(url));
  };
  return { fetchImpl, calls };
}

const entries = parseWatched('Alex, Thè Demiurge');
const run = (fetchImpl, previous, iso) => collect({ entries, previous, fetchImpl, sleep, now: new Date(iso) });

test('parses comments, optional region and duplicates', () => {
  const parsed = parseWatched('# note\n\nA, One Two\nA, One Two\nB, Three Four, EU\n');
  assert.deepEqual(parsed.map((e) => [e.slug, e.region]), [['one-two', 'us'], ['three-four', 'eu']]);
  assert.throws(() => parseWatched('only-a-person'), /line 1/);
  assert.throws(() => parseWatched('A, B C, mars'), /unknown region/);
});

test('builds the armory URL with an encoded slug', () => {
  assert.equal(
    armoryUrl('us', entries[0].slug),
    'https://worldofwarcraft.blizzard.com/en-us/forever/us/armory/character/th%C3%A8-demiurge',
  );
});

test('extracts embedded state and rejects pages without it', () => {
  const html = 'x var characterProfileInitialState = {"character":{"level":3,"note":"a;b"}};\n</script> y';
  assert.equal(extractCharacter(html).level, 3);
  assert.equal(extractCharacter('<html></html>'), null);
  assert.equal(extractCharacter('var characterProfileInitialState = {bad};\n</script>'), null);
});

test('maps the armory fields', async () => {
  const { data } = await run(site(() => page(character(12))).fetchImpl, null, '2026-01-01T00:00:00Z');
  const { profile, snapshots, status } = data.characters[0];
  assert.equal(status, 'ok');
  assert.equal(profile.name, 'Thè Demiurge');
  assert.equal(profile.className, 'Priest');
  assert.deepEqual(profile.professions, [{ name: 'Tailoring', skill: 41, max: 75 }]);
  assert.deepEqual(snapshots, [
    { t: '2026-01-01T00:00:00.000Z', level: 12, itemLevel: 4, honorableKills: 0, skills: { Tailoring: 41 } },
  ]);
});

test('keeps firstSeen and only stores snapshots that changed', async () => {
  const same = site(() => page(character(10))).fetchImpl;
  const first = (await run(same, null, '2026-01-01T00:00:00Z')).data;
  const second = (await run(same, first, '2026-01-02T00:00:00Z')).data;
  const third = (await run(site(() => page(character(14))).fetchImpl, second, '2026-01-03T00:00:00Z')).data;

  const [c] = third.characters;
  assert.equal(c.firstSeen, '2026-01-01T00:00:00.000Z');
  assert.equal(c.lastSeen, '2026-01-03T00:00:00.000Z');
  assert.deepEqual(c.snapshots.map((s) => s.level), [10, 14]);
  assert.equal(c.slot, 0);
  assert.equal(c.stats.levelsGained, 4);
  assert.equal(c.stats.levelsPerDay, 2);
});

test('tracks skill changes at the same level and counts skills learned later', async () => {
  const skilled = (primaries) =>
    site(() => page(character(10, { professions: { primaries, secondaries: [] } }))).fetchImpl;
  const tailoring = (skillPoints) => ({ name: 'Tailoring', tiers: [{ skillPoints, maxSkillPoints: 75 }] });
  const cooking = { name: 'Cooking', tiers: [{ skillPoints: 7, maxSkillPoints: 75 }] };

  const first = (await run(skilled([tailoring(40)]), null, '2026-01-01T00:00:00Z')).data;
  const same = (await run(skilled([tailoring(40)]), first, '2026-01-02T00:00:00Z')).data;
  const raised = (await run(skilled([tailoring(52)]), same, '2026-01-03T00:00:00Z')).data;
  const learned = (await run(skilled([tailoring(52), cooking]), raised, '2026-01-04T00:00:00Z')).data;

  const [c] = learned.characters;
  assert.deepEqual(c.snapshots.map((s) => s.skills), [
    { Tailoring: 40 },
    { Tailoring: 52 },
    { Tailoring: 52, Cooking: 7 },
  ]);
  assert.deepEqual(c.stats.skillsGained, { Tailoring: 12, Cooking: 0 });
});

test('history from before skills were tracked gains them on the next run', async () => {
  const previous = (await run(site(() => page(character(10))).fetchImpl, null, '2026-01-01T00:00:00Z')).data;
  delete previous.characters[0].snapshots[0].skills;
  const { data } = await run(site(() => page(character(10))).fetchImpl, previous, '2026-01-02T00:00:00Z');
  assert.equal(data.characters[0].snapshots.length, 2);
  assert.deepEqual(data.characters[0].stats.skillsGained, { Tailoring: 0 });
});

test('a failed lookup keeps the history and reports the problem', async () => {
  const first = (await run(site(() => page(character(10))).fetchImpl, null, '2026-01-01T00:00:00Z')).data;
  const { data, failed } = await run(site(() => new Response('', { status: 500 })).fetchImpl, first, '2026-01-02T00:00:00Z');
  const [c] = data.characters;
  assert.equal(failed, 1);
  assert.equal(c.status, 'error');
  assert.match(c.message, /spelling/);
  assert.equal(c.snapshots.length, 1);
  assert.equal(c.profile.level, 10);
  assert.equal(c.lastSeen, '2026-01-01T00:00:00.000Z');
});

test('a page without character data is a failure, not an empty snapshot', async () => {
  const { data, failed } = await run(site(() => new Response('<html></html>')).fetchImpl, null, '2026-01-01T00:00:00Z');
  assert.equal(failed, 1);
  assert.match(data.characters[0].message, /format/);
  assert.equal(data.characters[0].snapshots.length, 0);
});

test('retries transient failures', async () => {
  let attempts = 0;
  const flaky = site(() => (++attempts < 3 ? new Response('', { status: 503 }) : page(character(10))));
  assert.equal((await run(flaky.fetchImpl, null, '2026-01-01T00:00:00Z')).failed, 0);
  assert.equal(attempts, 3);
});

test('colour slots survive removing a character, and unwatched history is kept', async () => {
  const both = parseWatched('A, One X\nB, Two X');
  const fetchImpl = site(() => page(character(10))).fetchImpl;
  const first = (await collect({ entries: both, previous: null, fetchImpl, sleep })).data;
  const { data } = await collect({ entries: [both[1]], previous: first, fetchImpl, sleep });
  assert.deepEqual(data.characters.map((c) => [c.name, c.slot, c.watched]), [
    ['One X', 0, false],
    ['Two X', 1, true],
  ]);
});
