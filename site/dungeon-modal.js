import { zonePositions } from './leveling-data.js';

function element(tag, text) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
}

export function setupDungeonModal(characters, completion) {
  const dialog = document.getElementById('dungeon-dialog');
  const list = document.getElementById('dungeon-quests');
  const map = document.getElementById('dungeon-pickup-markers');
  const chooser = document.getElementById('dungeon-character');
  const faction = document.getElementById('dungeon-modal-faction');
  const summary = document.getElementById('dungeon-modal-note');
  const cityZones = { 'Thunder Bluff': 'Mulgore', Orgrimmar: 'Durotar', Undercity: 'Tirisfal Glades', 'Stormwind City': 'Elwynn Forest', Ironforge: 'Dun Morogh', Darnassus: 'Teldrassil' };
  let association;
  let opener;
  chooser.append(element('option', 'All tracked characters'));
  for (const character of characters) chooser.append(element('option', character.profile?.name ?? character.name));
  const svg = (tag, attrs, text) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text != null) node.textContent = text;
    return node;
  };

  function render() {
    const selected = chooser.selectedIndex ? [characters[chooser.selectedIndex - 1]] : characters;
    const quests = association.quests.filter((quest) => !faction.checked
      || selected.some((character) => completion([quest], character, true).total === 1));
    const zones = new Map();
    list.replaceChildren();
    for (const quest of quests) {
      const details = element('details');
      const title = element('summary', quest.name);
      details.append(title, element('p', quest.objectives || 'Objectives unavailable.'));
      const status = selected.map((character) => {
        const result = completion([quest], character, faction.checked);
        const name = character.profile?.name ?? character.name;
        return `${name}: ${result.unknown || !result.synced ? 'unknown' : !result.total ? 'other faction' : result.completed ? 'completed' : 'incomplete'}`;
      });
      details.append(element('p', status.join(' · ')));
      if (quest.allOf?.length || quest.anyOf?.length) {
        details.append(element('p', `Prerequisites: ${quest.allOf?.length ? 'all of ' + quest.allOf.join(', ') : 'one of ' + quest.anyOf.join(', ')}`));
      }
      const pickups = element('ul');
      for (const start of quest.starts ?? []) {
        if (!zones.has(start.zone)) zones.set(start.zone, zones.size + 1);
        pickups.append(element('li', `${zones.get(start.zone)}. ${start.name} — ${start.zone} (${start.x.toFixed(1)}, ${start.y.toFixed(1)})`));
      }
      details.append(pickups.childNodes.length ? pickups : element('p', 'Pickup coordinates unavailable. This quest may start from an item or require a preceding quest.'));
      const guide = element('a', 'Open quest walkthrough');
      guide.href = `https://foreverdb.net/quest/${quest.id}`;
      guide.target = '_blank';
      guide.rel = 'noopener';
      details.append(guide);
      list.append(details);
    }
    map.replaceChildren();
    const legend = document.getElementById('dungeon-pickup-legend');
    legend.replaceChildren();
    for (const [zone, number] of zones) {
      const position = zonePositions[zone] ?? zonePositions[cityZones[zone]];
      legend.append(element('li', `${number}. ${zone}${position ? '' : ' — outside this map'}`));
      if (!position) continue;
      const marker = svg('g', { transform: `translate(${position[0]} ${position[1]})` });
      marker.append(svg('title', {}, zone), svg('circle', { r: 18, fill: '#ffd86b', stroke: '#17120b', 'stroke-width': 3 }),
        svg('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#17120b', 'font-size': 21 }, number));
      map.append(marker);
    }
    summary.textContent = `${quests.length} quests. Map markers show approximate pickup zones; expand a quest for names and coordinates. QuestieDB locations may differ in Forever.${association.shared ? ' This dungeon shares its quest pool across wings.' : ''}`;
    if (!quests.length) list.append(element('p', 'No quests match this selection in the catalog.'));
  }
  chooser.addEventListener('change', render);
  faction.addEventListener('change', render);
  document.getElementById('dungeon-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => opener?.focus());
  return (name, quests, filterFaction, trigger) => {
    association = quests;
    opener = trigger;
    faction.checked = filterFaction;
    document.getElementById('dungeon-title').textContent = name;
    render();
    dialog.showModal();
  };
}
