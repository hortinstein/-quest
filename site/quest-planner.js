const races = {
  Human: 1, Orc: 2, Dwarf: 4, 'Night Elf': 8, Undead: 16, Tauren: 32, Gnome: 64, Troll: 128,
};
const factionRaces = { Alliance: 4294967373, Horde: 8589934770 };

export function questChains(quests) {
  const links = new Map(quests.map(({ id }) => [id, new Set()]));
  for (const quest of quests) {
    for (const id of [...(quest.allOf ?? []), ...(quest.anyOf ?? []), quest.next, quest.parent, quest.breadcrumb]) {
      if (!links.has(id) || id === quest.id) continue;
      links.get(quest.id).add(id);
      links.get(id).add(quest.id);
    }
  }
  const chains = new Map();
  const byId = new Map(quests.map((quest) => [quest.id, quest]));
  for (const [id, neighbors] of links) {
    if (chains.has(id) || !neighbors.size) continue;
    const members = new Set([id]);
    for (const member of members) {
      for (const neighbor of links.get(member)) members.add(neighbor);
    }
    const records = [...members].map((member) => byId.get(member));
    const successorIds = new Set(records.flatMap((quest) => [quest.next, quest.breadcrumb]));
    const roots = records.filter((quest) => !quest.anyOf?.length && !quest.allOf?.length
      && !quest.parent && !successorIds.has(quest.id));
    const root = (roots.length ? roots : records).sort((a, b) => a.id - b.id)[0];
    const chain = { name: root.name, id: root.id, count: members.size };
    for (const member of members) chains.set(member, chain);
  }
  return chains;
}

function canStart(quest, character, completed) {
  const profile = character.profile;
  if (quest.restricted || quest.classMask || !quest.zone || quest.minLevel < 1 || completed.has(quest.id)) return false;
  if (profile.level < quest.minLevel || profile.level > (quest.maxLevel ?? Infinity)) return false;
  if (quest.next && completed.has(quest.next)) return false;
  if (quest.breadcrumb && completed.has(quest.breadcrumb)) return false;
  if (quest.exclusive?.some((id) => completed.has(id))) return false;
  if (quest.allOf?.some((id) => !completed.has(id))) return false;
  if (quest.anyOf?.length && !quest.anyOf.some((id) => completed.has(id))) return false;
  if (!quest.raceMask) return true;
  const mask = BigInt(quest.raceMask);
  const faction = BigInt(factionRaces[profile.faction]);
  if ((mask & faction) === faction) return true;
  const race = races[profile.race];
  return !!race && (mask & BigInt(race)) !== 0n;
}

export function questPartners(leader, characters) {
  if (!Array.isArray(leader?.questLog?.completed) || leader.questLog.error
      || !Number.isInteger(leader.profile?.level) || !leader.profile.ruleset
      || !Object.hasOwn(factionRaces, leader.profile.faction)) return [];
  return characters.filter((character) =>
    character.key !== leader.key && character.person !== leader.person
    && character.region === leader.region && character.profile?.ruleset === leader.profile.ruleset
    && character.profile.faction === leader.profile.faction && Number.isInteger(character.profile.level)
    && Array.isArray(character.questLog?.completed) && !character.questLog.error);
}

export function sharedQuests(quests, leader, characters) {
  const partners = questPartners(leader, characters);
  if (!partners.length) return [];
  const party = [leader, ...partners]
    .map((character) => ({
      character,
      completed: new Set([...character.questLog.completed, ...(character.questLog.history ?? [])].map(({ id }) => id)),
    }));
  const results = [];
  for (const quest of quests) {
    if (!canStart(quest, leader, party[0].completed)) continue;
    const matches = new Map([[leader.person, leader]]);
    for (const { character, completed } of party.slice(1)) {
      if (canStart(quest, character, completed) && !matches.has(character.person)) matches.set(character.person, character);
    }
    if (matches.size < 2) continue;
    const players = [...matches.values()];
    const distance = players.reduce((total, player) => total + Math.abs(player.profile.level - quest.level), 0) / players.length;
    results.push({ ...quest, players, distance });
  }
  return results.sort((a, b) => b.players.length - a.players.length || a.distance - b.distance || a.id - b.id);
}
