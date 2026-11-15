import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuestLookup } from '../scripts/quests.mjs';
import { collect, parseWatched } from '../scripts/collect.mjs';

test('authenticates on the server, reuses a token and reads Forever completions', async () => {
  const requests = [];
  const lookup = createQuestLookup({
    clientId: 'test-id',
    clientSecret: 'test-secret',
    fetchImpl: async (url, options) => {
      requests.push([String(url), options]);
      return Response.json(requests.length === 1
        ? { access_token: 'test-token', expires_in: 3600 }
        : { quests: [{ id: 783, name: 'A Threat Within' }, { id: 783, name: 'A Threat Within' }] });
    },
  });
  const entry = { region: 'eu', slug: 'époch-root' };
  assert.deepEqual(await lookup(entry), [{ id: 783, name: 'A Threat Within' }]);
  await lookup(entry);
  assert.equal(requests.length, 3);
  assert.equal(requests[0][0], 'https://oauth.battle.net/token');
  assert.equal(requests[0][1].body.get('grant_type'), 'client_credentials');
  assert.equal(requests[1][0], 'https://eu.api.blizzard.com/profile/wow/character/%C3%A9poch-root/quests/completed?namespace=profile-forever-eu&locale=en_US');
  assert.equal(requests[1][1].headers.Authorization, 'Bearer test-token');
});

test('preserves the last successful quest sync if the next sync fails', async () => {
  const entries = parseWatched('Alex, Epoch Root');
  const options = { entries, fetchImpl: async () => new Response(null, { status: 404 }) };
  const first = await collect({ ...options, lookupQuests: async () => [{ id: 783 }] });
  const previous = structuredClone(first.data);
  const second = await collect({
    ...options,
    previous,
    lookupQuests: async () => { throw new Error('HTTP 503'); },
  });
  assert.deepEqual(second.data.characters[0].questLog, {
    ...first.data.characters[0].questLog,
    error: 'HTTP 503',
  });
});
