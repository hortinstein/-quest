const timeout = () => AbortSignal.timeout(20_000);

async function json(fetchImpl, url, init) {
  const response = await fetchImpl(url, { ...init, signal: timeout(), redirect: 'error' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function createQuestLookup({ clientId, clientSecret, fetchImpl = fetch }) {
  if (!clientId || !clientSecret) return null;
  let token;

  return async ({ region, slug }) => {
    if (!token || Date.now() >= token.expiresAt) {
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const data = await json(fetchImpl, 'https://oauth.battle.net/token', {
        method: 'POST',
        headers: { Authorization: `Basic ${credentials}` },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
      });
      if (typeof data.access_token !== 'string') throw new Error('Blizzard did not return an access token');
      token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    }

    const url = new URL(`https://${region}.api.blizzard.com/profile/wow/character/${encodeURIComponent(slug)}/quests/completed`);
    url.search = new URLSearchParams({ namespace: `profile-forever-${region}`, locale: 'en_US' });
    const data = await json(fetchImpl, url, { headers: { Authorization: `Bearer ${token.value}` } });
    if (!Array.isArray(data.quests)) throw new Error('Blizzard returned an unexpected completed quest list');
    const quests = new Map();
    for (const entry of data.quests) {
      const quest = entry?.quest ?? entry;
      if (!Number.isSafeInteger(quest?.id) || quest.id < 1) {
        throw new Error('Blizzard returned a completed quest without a valid ID');
      }
      quests.set(quest.id, { id: quest.id, name: typeof quest.name === 'string' ? quest.name : null });
    }
    return [...quests.values()];
  };
}
