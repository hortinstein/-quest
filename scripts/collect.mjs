// Reads watched.txt, loads each character's WoW Forever armory page, and merges
// the result into site/data/characters.json.
//
// Blizzard has no documented Forever API, so this reads the JSON the official
// armory page embeds for its own front end.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REGIONS = new Set(['us', 'eu', 'kr', 'tw']);
const METRICS = ['level', 'itemLevel', 'honorableKills'];
const DAY_MS = 86_400_000;
const REQUEST_TIMEOUT_MS = 20_000;
const STATE_MARKER = 'var characterProfileInitialState = ';
const STATE_END = ';\n</script>';

export function slugify(name) {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, '-');
}

export function armoryUrl(region, slug) {
  return `https://worldofwarcraft.blizzard.com/en-us/forever/${region}/armory/character/${encodeURIComponent(slug)}`;
}

export function parseWatched(text) {
  const seen = new Set();
  const entries = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;

    const [person, name, regionField] = line.split(',').map((field) => field.trim().normalize('NFC'));
    if (!person || !name) {
      throw new Error(`watched.txt line ${index + 1}: expected "person, character"`);
    }
    const region = (regionField || 'us').toLowerCase();
    if (!REGIONS.has(region)) {
      throw new Error(`watched.txt line ${index + 1}: unknown region "${region}"`);
    }

    const slug = slugify(name);
    // Keyed on the character so renaming the person keeps the history.
    const key = `${region}|${slug}`.toLocaleLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ key, person, name, slug, region });
  });
  return entries;
}

export function extractCharacter(html) {
  const start = html.indexOf(STATE_MARKER);
  if (start < 0) return null;
  const from = start + STATE_MARKER.length;
  const end = html.indexOf(STATE_END, from);
  if (end < 0) return null;
  try {
    return JSON.parse(html.slice(from, end)).character ?? null;
  } catch {
    return null;
  }
}

function toProfession(profession) {
  const tier = profession.tiers?.at(-1);
  return { name: profession.name, skill: tier?.skillPoints ?? null, max: tier?.maxSkillPoints ?? null };
}

function toProfile(c) {
  return {
    name: [c.name, c.surname].filter(Boolean).join(' '),
    faction: c.faction?.name ?? null,
    race: c.race?.name ?? null,
    className: c.class?.name ?? null,
    ruleset: c.ruleset?.name ?? null,
    lastUpdated: c.lastUpdatedTimestamp?.iso8601 ?? null,
    professions: [...(c.professions?.primaries ?? []), ...(c.professions?.secondaries ?? [])].map(toProfession),
    level: c.level ?? null,
    itemLevel: c.averageItemLevel ?? null,
    honorableKills: c.pvp?.honorableKills?.value ?? null,
  };
}

async function request(url, { fetchImpl, sleep, retries = 2 }) {
  const init = { headers: { 'User-Agent': 'character-level-tracker' } };
  for (let attempt = 0; ; attempt += 1) {
    const backoff = 1000 * 2 ** attempt;
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      if (attempt >= retries) throw error;
      await sleep(backoff);
      continue;
    }
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= retries) return response;
    await sleep(backoff);
  }
}

async function lookup(entry, http) {
  try {
    const response = await request(armoryUrl(entry.region, entry.slug), http);
    if (response.status === 404 || response.status === 500) {
      // The armory answers 500, not 404, for a name that does not exist.
      return {
        status: 'error',
        message: `Armory returned HTTP ${response.status}. Check the spelling, or the armory may be down.`,
      };
    }
    if (!response.ok) return { status: 'error', message: `Armory returned HTTP ${response.status}.` };
    const character = extractCharacter(await response.text());
    if (!character) return { status: 'error', message: 'No character data on the armory page. Its format may have changed.' };
    return { status: 'ok', profile: toProfile(character) };
  } catch (error) {
    return { status: 'error', message: `Request failed: ${error.message}` };
  }
}

function firstSkillValues(snapshots) {
  const first = {};
  for (const snapshot of snapshots) {
    for (const [name, value] of Object.entries(snapshot.skills ?? {})) first[name] ??= value;
  }
  return first;
}

function sameSkills(a, b) {
  if (!a) return false;
  const names = Object.keys(b);
  return names.length === Object.keys(a).length && names.every((name) => a[name] === b[name]);
}

export function computeStats(character) {
  const { snapshots, firstSeen, lastSeen } = character;
  if (!snapshots.length) return null;
  const first = snapshots[0];
  const last = snapshots.at(-1);
  const gained = (metric) =>
    first[metric] == null || last[metric] == null ? null : last[metric] - first[metric];
  const daysTracked = (Date.parse(lastSeen) - Date.parse(firstSeen)) / DAY_MS;
  const levelsGained = gained('level');
  const firstSkills = firstSkillValues(snapshots);
  const skillsGained = Object.fromEntries(
    Object.entries(last.skills ?? {}).map(([name, value]) => [name, value - firstSkills[name]]),
  );
  return {
    skillsGained,
    levelsGained,
    itemLevelGained: gained('itemLevel'),
    honorableKillsGained: gained('honorableKills'),
    daysTracked: Number(daysTracked.toFixed(2)),
    levelsPerDay: daysTracked >= 1 && levelsGained != null ? Number((levelsGained / daysTracked).toFixed(2)) : null,
  };
}

function applyProfile(character, profile, timestamp) {
  const metrics = Object.fromEntries(METRICS.map((metric) => [metric, profile[metric]]));
  const last = character.snapshots.at(-1);
  // Only changes are stored. The site extends each line out to lastSeen.
  const skills = Object.fromEntries(
    profile.professions.filter((p) => p.skill != null).map((p) => [p.name, p.skill]),
  );
  if (!last || METRICS.some((metric) => last[metric] !== metrics[metric]) || !sameSkills(last.skills, skills)) {
    character.snapshots.push({ t: timestamp, ...metrics, skills });
  }
  character.firstSeen ??= timestamp;
  character.lastSeen = timestamp;
  character.profile = profile;
  character.stats = computeStats(character);
}

// Slots pick the chart colour, so they are kept for the life of a character.
function assignSlots(characters) {
  const used = new Set(characters.map((c) => c.slot).filter((slot) => slot != null));
  for (const character of characters) {
    if (character.slot != null || !character.snapshots.length) continue;
    let slot = 0;
    while (used.has(slot)) slot += 1;
    character.slot = slot;
    used.add(slot);
  }
}

export async function collect({
  entries,
  previous,
  now = new Date(),
  fetchImpl = fetch,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  captureGear,
}) {
  const timestamp = now.toISOString();
  const http = { fetchImpl, sleep };
  const known = new Map((previous?.characters ?? []).map((c) => [c.key, c]));

  let failed = 0;
  let capturesFailed = 0;
  for (const entry of entries) {
    const character = known.get(entry.key) ?? {
      key: entry.key,
      firstSeen: null,
      lastSeen: null,
      slot: null,
      profile: null,
      stats: null,
      snapshots: [],
    };
    known.set(entry.key, character);

    const outcome = await lookup(entry, http);
    if (outcome.status !== 'ok') failed += 1;
    Object.assign(character, entry, {
      url: armoryUrl(entry.region, entry.slug),
      watched: true,
      status: outcome.status,
      message: outcome.message ?? null,
      lastChecked: timestamp,
    });
    if (outcome.profile) {
      applyProfile(character, outcome.profile, timestamp);
      const level = character.profile.level;
      // Missing history seeds existing characters too. Compare with the last
      // successful capture so a failed screenshot is retried on the next run.
      if (captureGear && Number.isInteger(level) && character.gearCaptures?.at(-1)?.level !== level) {
        try {
          const path = await captureGear(character, now);
          (character.gearCaptures ??= []).push({ t: timestamp, level, path });
          character.captureError = null;
        } catch (error) {
          capturesFailed += 1;
          character.captureError = `Gear capture failed: ${error.message}`;
        }
      }
    }
  }

  const watchedKeys = new Set(entries.map((entry) => entry.key));
  const characters = [...known.values()].filter((character) => {
    if (!watchedKeys.has(character.key)) character.watched = false;
    return character.watched || character.snapshots.length > 0;
  });
  assignSlots(characters);

  return { data: { generatedAt: timestamp, characters }, attempted: entries.length, failed, capturesFailed };
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dataPath = resolve(root, 'site/data/characters.json');

  const entries = parseWatched(await readFile(resolve(root, 'watched.txt'), 'utf8'));
  const { createGearCapturer } = await import('./screenshots.mjs');
  const capturer = createGearCapturer(resolve(root, 'site'));
  let result;
  try {
    result = await collect({ entries, previous: await readJson(dataPath), captureGear: capturer.capture });
  } finally {
    await capturer.close();
  }
  const { data, attempted, failed, capturesFailed } = result;

  for (const c of data.characters.filter((character) => character.watched)) {
    const detail = c.message ?? `level ${c.profile.level}`;
    console.log(`${c.status.padEnd(6)} ${c.person} / ${c.name}: ${detail}`);
    if (c.captureError) console.error(`${c.name}: ${c.captureError}`);
  }
  await mkdir(dirname(dataPath), { recursive: true });
  await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`);

  // History is safe either way. Failing the run is what gets someone's attention
  // if the armory page changes shape.
  if (attempted > 0 && failed === attempted) {
    throw new Error(`All ${attempted} armory lookups failed.`);
  }
  if (capturesFailed) throw new Error(`${capturesFailed} gear captures failed; character data was saved. Captures will retry next run.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
