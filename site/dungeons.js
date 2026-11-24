import { setupDungeonModal } from './dungeon-modal.js';
import { dungeonRanges } from './leveling-data.js';
import { loadQuestCatalog } from './quest-catalog.js';

// Typical-group editorial estimates, Mmonster Forever dungeon guide, 19 Nov 2026.
// Index matches dungeonRanges. Quest categories can cover multiple wings.
const durations = [
  [25, 35], [35, 45], [30, 40], [45, 60], [40, 55], [45, 60], [45, 60], [60, 80],
  [60, 85], [20, 30], [45, 65], [35, 50], [40, 55], [40, 55], [20, 30], [55, 75],
  [40, 55], [20, 30], [25, 35], [20, 30], [35, 50], [25, 40], [60, 90], [50, 70],
  [75, 110], [70, 100], [120, 180], [35, 50], [75, 105], [35, 50], [40, 60],
  [75, 105], [55, 80], [55, 80], [60, 90],
];
const categories = {
  'Hall of Thanes': ['The Hall Of Thanes'],
  'Excavation Site': ['Excavation Site: Wetlands'],
  'City of Dalaran': ['City of Dalaran', 'City Of Dalaran 16560'],
  "Shaper's Terrace": ['The Shapers Terrace Forever'],
  "Zul'Farrak": ['Zul Farrak'],
  "The Temple of Atal'Hakkar": ['Sunken Temple'],
  'Lower Spire': ['Blackrock Spire'],
  'Upper Blackrock Spire': ['Blackrock Spire'],
  'Dire Maul East': ['Dire Maul'],
  'Dire Maul North': ['Dire Maul'],
  'Dire Maul West': ['Dire Maul'],
  'Stratholme Live Main Gate': ['Stratholme'],
  'Stratholme Service Gate': ['Stratholme'],
};
const shared = new Set(['Blackrock Spire', 'Dire Maul', 'Stratholme', 'Scarlet Monastery']);
const factionMasks = { Alliance: 4294967373n, Horde: 8589934770n };

export function dungeonQuests(catalog, name) {
  const areas = name.startsWith('Scarlet Monastery ') ? ['Scarlet Monastery'] : categories[name] ?? [name];
  return { quests: catalog.filter((quest) => areas.includes(quest.zone)), shared: areas.some((area) => shared.has(area)) };
}

export function dungeonCompletion(quests, character, filterFaction) {
  const faction = factionMasks[character.profile?.faction];
  if (filterFaction && !faction) return { unknown: true };
  const offered = quests.filter((quest) => !filterFaction || !quest.raceMask
    || (BigInt(quest.raceMask) & faction) !== 0n);
  const log = character.questLog;
  const completed = new Set([...(log?.completed ?? []), ...(log?.history ?? [])].map(({ id }) => id));
  return {
    total: offered.length,
    completed: offered.filter(({ id }) => completed.has(id)).length,
    synced: Array.isArray(log?.completed),
    stale: !!log?.error,
  };
}

function node(tag, text) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  return element;
}

export function setupDungeons(characters) {
  const tab = document.getElementById('dungeons-tab');
  const filter = document.getElementById('dungeons-faction');
  const status = document.getElementById('dungeons-status');
  const retry = document.getElementById('dungeons-retry');
  const table = document.getElementById('dungeons-table');
  const heading = document.getElementById('dungeons-head');
  const body = document.getElementById('dungeons-rows');
  const openDungeon = setupDungeonModal(characters, dungeonCompletion);
  let catalog;
  let loading = false;

  for (const character of characters) {
    const cell = node('th', character.profile?.name ?? character.name);
    cell.scope = 'col';
    cell.append(node('span', character.person));
    heading.append(cell);
  }

  function render() {
    body.replaceChildren();
    const rows = dungeonRanges.map((range, index) => ({ range, duration: durations[index] }))
      .sort((a, b) => a.range[1] - b.range[1] || a.range[0].localeCompare(b.range[0]));
    for (const { range: [name, low, high], duration } of rows) {
      const row = body.insertRow();
      const title = node('th');
      const button = node('button', name);
      button.type = 'button';
      button.className = 'map-character-button';
      button.setAttribute('aria-haspopup', 'dialog');
      title.append(button);
      title.scope = 'row';
      const association = dungeonQuests(catalog, name);
      button.addEventListener('click', () => openDungeon(name, association, filter.checked, button));
      if (association.shared) title.append(node('span', 'Shared wing quest pool'));
      row.append(title);
      row.insertCell().textContent = `${low}–${high}`;
      row.insertCell().textContent = `${duration[0]}–${duration[1]} min`;
      for (const character of characters) {
        const cell = row.insertCell();
        const result = dungeonCompletion(association.quests, character, filter.checked);
        cell.textContent = !association.quests.length ? 'Unavailable'
          : result.unknown ? 'Faction unknown'
          : !result.synced ? `Unknown / ${result.total}`
          : `${result.completed} / ${result.total}`;
        if (result.stale && result.synced) cell.append(node('span', 'Last known'));
      }
    }
    table.hidden = false;
    status.textContent = characters.length ? '' : 'No watched characters available.';
  }

  async function load() {
    if (loading || catalog) return;
    loading = true;
    retry.hidden = true;
    status.textContent = 'Loading dungeon quests…';
    try {
      catalog = await loadQuestCatalog();
      render();
    } catch {
      status.textContent = 'Could not load dungeon quests.';
      retry.hidden = false;
    } finally {
      loading = false;
    }
  }
  filter.addEventListener('change', () => { if (catalog) render(); });
  retry.addEventListener('click', load);
  tab.addEventListener('click', load);
  tab.addEventListener('focus', load);
  if (tab.getAttribute('aria-selected') === 'true') load();
}
