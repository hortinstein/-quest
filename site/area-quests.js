import { loadQuestCatalog } from './quest-catalog.js';

function catalogArea(name) {
  if (name === "The Temple of Atal'Hakkar") return 'sunken temple';
  return name?.toLowerCase().replaceAll("'", ' ');
}

function element(tag, text) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
}

export function setupAreaQuests(recommendations, characters, initialSelection) {
  const tab = document.getElementById('leveling-tab');
  const status = document.getElementById('area-quest-status');
  const container = document.getElementById('area-quest-tables');
  const retry = document.getElementById('area-quest-retry');
  const areas = new Map();
  let selected = initialSelection;
  const sections = [];
  for (const entry of recommendations) {
    const { places } = entry;
    const names = new Set([...(places?.zones ?? []), ...(places?.dungeons ?? [])].map((area) => area.name));
    for (const area of names) {
      if (!areas.has(area)) areas.set(area, []);
      areas.get(area).push(entry);
    }
  }
  const completions = new Map();
  for (const character of characters) {
    const { completed, history } = character.questLog ?? {};
    const ids = new Set([...(completed ?? []), ...(history ?? [])].map((quest) => quest.id));
    for (const id of ids) {
      if (!completions.has(id)) completions.set(id, new Set());
      completions.get(id).add(character.key);
    }
  }

  function areaTable(area, recommendedFor, quests) {
    const details = element('details');
    details.open = true;
    const summary = element('summary', `${area} · ${quests.length} catalog quests`);
    const recommended = element('p');
    const completionCells = [];
    sections.push({ details, recommended, recommendedFor, completionCells });
    details.append(summary, recommended);
    if (!quests.length) {
      details.append(element('p', 'No quests are assigned to this area in the catalog.'));
      return details;
    }
    const table = element('table');
    table.setAttribute('aria-label', `${area} quests and completions`);
    const header = table.createTHead().insertRow();
    for (const label of ['Quest', 'Quest level', 'Completed by']) {
      const cell = element('th', label);
      cell.scope = 'col';
      header.append(cell);
    }
    const body = table.createTBody();
    for (const quest of quests) {
      const row = body.insertRow();
      const link = element('a', quest.name);
      link.href = `https://foreverdb.net/quest/${quest.id}`;
      row.insertCell().append(link);
      row.insertCell().textContent = quest.level > 0 ? quest.level : '—';
      completionCells.push({ cell: row.insertCell(), done: completions.get(quest.id) });
    }
    const scroll = element('div');
    scroll.className = 'table-scroll';
    scroll.append(table);
    details.append(scroll);
    return details;
  }

  let loading = false;
  let loaded = false;
  function applySelection() {
    let visible = 0;
    const group = [...selected];
    for (const { details, recommended, recommendedFor, completionCells } of sections) {
      details.hidden = !group.length || !group.every((entry) => recommendedFor.includes(entry));
      if (details.hidden) continue;
      visible++;
      recommended.textContent = `Recommended for ${group.map(({ name }) => name).join(', ')}`;
      for (const { cell, done } of completionCells) {
        const names = group.filter(({ key }) => done?.has(key)).map(({ name }) => name);
        cell.textContent = group.length === 1
          ? names[0] ?? 'None reported'
          : `${names.length} of ${group.length} completed${names.length ? ` · ${names.join(', ')}` : ''}`;
      }
    }
    status.textContent = visible ? ''
      : selected.size > 1 ? 'No recommended areas are shared by all selected characters.'
      : selected.size ? 'No recommended areas for the selected character.'
      : 'Select a character above to show their recommended areas.';
  }
  async function render() {
    if (loading || loaded) return;
    if (!areas.size) {
      status.textContent = 'No recommended areas for the watched characters.';
      return;
    }
    loading = true;
    retry.hidden = true;
    status.textContent = 'Loading area quests…';
    try {
      const catalog = await loadQuestCatalog();
      const recommendedAreas = new Set([...areas.keys()].map(catalogArea));
      const questsByArea = new Map();
      for (const quest of catalog) {
        const area = catalogArea(quest.zone);
        if (!recommendedAreas.has(area)) continue;
        if (!questsByArea.has(area)) questsByArea.set(area, []);
        questsByArea.get(area).push(quest);
      }
      const tables = [...areas].sort(([a], [b]) => a.localeCompare(b)).map(([area, recommendedFor]) => {
        const quests = questsByArea.get(catalogArea(area)) ?? [];
        quests.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name) || a.id - b.id);
        return areaTable(area, recommendedFor, quests);
      });
      container.replaceChildren(...tables);
      loaded = true;
      applySelection();
    } catch {
      status.textContent = 'Could not load area quests.';
      retry.hidden = false;
    } finally {
      loading = false;
    }
  }
  retry.addEventListener('click', render);
  tab.addEventListener('click', render, { once: true });
  tab.addEventListener('focus', render, { once: true });
  if (tab.getAttribute('aria-selected') === 'true') render();
  return (selection) => {
    selected = selection;
    if (loaded) applySelection();
  };
}
