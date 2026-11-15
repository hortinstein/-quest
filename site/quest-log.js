import { loadQuestCatalog } from './quest-catalog.js';
import { eligibleIncompleteQuests, questChains, questPartners, sharedQuests } from './quest-planner.js';
import { zonePositions } from './leveling-data.js';

function node(tag, text, props = {}) {
  return Object.assign(document.createElement(tag), { textContent: text }, props);
}

function sourceLink(value) {
  try {
    const url = new URL(value);
    if (url.origin === 'https://thewowdb.com') return url.href;
  } catch {
    // A record may have no source URL.
  }
  return null;
}

function addLocation(detail, quest) {
  const zoneUrl = sourceLink(quest.zone_link);
  const parentZone = zoneUrl && new URL(zoneUrl).pathname.split('/').filter(Boolean).at(-1)
    ?.replace(/-\d+$/, '');
  const zone = Object.keys(zonePositions).find((name) =>
    name === quest.zone || name.toLowerCase().replaceAll("'", '').replaceAll(' ', '-') === parentZone);
  if (!quest.zone && !zone) return;
  detail.append(node('h3', 'Location'), node('p', quest.zone ?? zone));
  if (zoneUrl) detail.append(node('a', 'Open zone guide', { href: zoneUrl }));
  if (!zone) return;

  const figure = node('figure', '', { className: 'quest-map' });
  const image = node('img', '', {
    src: 'assets/world-map.jpg', alt: 'Kalimdor and the Eastern Kingdoms', width: 1497, height: 855,
  });
  const [x, y] = zonePositions[zone];
  const pin = node('span', '', { className: 'quest-pin' });
  pin.setAttribute('aria-hidden', 'true');
  pin.style.left = `${x / 1497 * 100}%`;
  pin.style.top = `${y / 855 * 100}%`;
  const map = node('div', '', { className: 'quest-map-image' });
  map.append(image, pin);
  image.addEventListener('error', () => { map.hidden = true; });
  figure.append(map, node('figcaption', `${zone} · approximate zone location`));
  detail.append(figure);
}

export function setupQuestLog(characters) {
  const $ = (id) => document.getElementById(id);
  const select = $('quest-character');
  const filter = $('quest-filter');
  const list = $('quest-list');
  const detail = $('quest-detail');
  const status = $('quest-status');
  const cache = new Map();
  let selection;
  let view = 'list';
  let catalog;
  let catalogError = false;
  let byId = new Map();
  let chains = new Map();
  let first = 0;
  const groupBy = $('quest-group');
  const zoneFilter = $('quest-zone');
  const eligibleOnly = $('quest-eligible');
  const viewNote = $('quest-view-note');
  const retryCatalog = $('quest-catalog-retry');
  const selectedCharacter = () => characters[select.selectedIndex];
  let requestVersion = 0;

  const log = () => characters[select.selectedIndex]?.questLog;
  for (const character of characters) {
    select.append(node('option', `${character.person} · ${character.profile?.name ?? character.name} (${character.region.toUpperCase()})`));
  }
  select.disabled = !characters.length;

  function renderList() {
    const current = log();
    const quests = current?.completed ?? [];
    const query = filter.value.trim().toLowerCase();
    const timeline = view === 'timeline';
    const planner = view === 'open' || view === 'party';
    const known = new Set([...quests, ...(current?.history ?? [])].map(({ id }) => id));
    let records = timeline ? current?.history ?? quests : quests;
    const eligible = view === 'open' && eligibleOnly.checked;
    $('quest-eligible-control').hidden = view !== 'open';
    eligibleOnly.disabled = !catalog || !current?.completed;
    if (view === 'open') {
      records = eligible ? eligibleIncompleteQuests(catalog ?? [], selectedCharacter())
        : current?.completed ? (catalog ?? []).filter((quest) => !known.has(quest.id)) : [];
    }
    const zones = [...new Set((eligible ? records : catalog ?? []).map((quest) => quest.zone).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    const zone = zoneFilter.value;
    zoneFilter.replaceChildren(node('option', eligible ? 'All eligible zones' : 'All zones', { value: '' }),
      ...zones.map((name) => node('option', name, { value: name })));
    if (zones.includes(zone)) zoneFilter.value = zone;
    if (view === 'party') records = sharedQuests(catalog ?? [], selectedCharacter(), characters);
    const matches = records.map((quest) => ({ ...byId.get(quest.id), ...quest,
      name: quest.name ?? byId.get(quest.id)?.name }))
      .filter(({ id, name, zone }) => (!zoneFilter.value || zoneFilter.value === zone)
        && [id, name, zone, chains.get(id)?.name].some((value) => String(value ?? '').toLowerCase().includes(query)));
    const summary = current?.completed
      ? `${quests.length.toLocaleString()} completed · synced ${new Date(current.updatedAt).toLocaleString()}`
      : 'No quest sync available.';
    status.textContent = current?.error ? `${summary} Latest sync failed (${current.error}).` : summary;

    const group = (quest) => {
      if (timeline) return quest.firstSeen
        ? new Date(quest.firstSeen).toLocaleDateString(undefined, { dateStyle: 'long' })
        : 'Completed before tracking began';
      if (groupBy.value === 'zone') return quest.zone ?? 'Zone unknown';
      if (groupBy.value === 'chain') {
        const chain = chains.get(quest.id);
        return chain ? `${chain.name} (#${chain.id})` : 'No known chain';
      }
      return '';
    };
    if (timeline) matches.sort((a, b) => (b.firstSeen ?? '').localeCompare(a.firstSeen ?? ''));
    else if (groupBy.value !== 'none') matches.sort((a, b) => group(a).localeCompare(group(b)));
    groupBy.disabled = timeline || !catalog;
    zoneFilter.disabled = !catalog;
    retryCatalog.hidden = !catalogError;
    viewNote.textContent = catalogError ? 'Could not load the quest catalog. Retry to load quest grouping and planning.'
      : !catalog && planner ? 'Loading the quest catalog…'
      : eligible ? 'Zones with incomplete quests that meet known level, faction, race, and prerequisite checks.'
      : view === 'open' ? 'Catalog quests with no completion recorded for this character. Some have eligibility requirements.'
      : view === 'party' ? 'Suggested for characters on the same region, ruleset, and faction who meet known level and prerequisite checks. Check availability in-game.'
      : timeline ? 'First seen during a sync. Dates are shown in your local time.' : '';

    list.setAttribute('aria-label', {
      list: 'Completed quests', open: 'Incomplete quests', party: 'Shared quest suggestions', timeline: 'Quest timeline',
    }[view]);
    list.replaceChildren();
    let previousGroup;
    const end = Math.min(matches.length, first + 100);
    for (const quest of matches.slice(first, end)) {
      const label = group(quest);
      if (label && label !== previousGroup) list.append(node('h4', label));
      previousGroup = label;
      const button = node('button', quest.name ?? `Quest #${quest.id}`, { type: 'button' });
      if (quest.players) button.append(node('span', quest.players.map((player) => player.name).join(', '), { className: 'sub' }));
      button.setAttribute('aria-pressed', String(selection === quest.id));
      button.addEventListener('click', () => show(quest.id, button));
      list.append(button);
    }
    if (matches.length > 100) {
      const paging = node('div', '', { className: 'controls quest-controls' });
      paging.append(node('span', `${first + 1}–${end} of ${matches.length}`));
      for (const [label, delta, disabled] of [['Previous', -100, first === 0], ['Next', 100, end === matches.length]]) {
        const button = node('button', label, { type: 'button', disabled });
        button.addEventListener('click', () => {
          first += delta;
          renderList();
          list.scrollTop = 0;
          list.querySelector('button')?.focus();
        });
        paging.append(button);
      }
      list.append(paging);
    }
    if (!matches.length && current?.completed && (!planner || catalog)) {
      const message = view !== 'party' ? (eligible ? 'No eligible incomplete quests match these filters.' : 'No matching quests.')
        : !questPartners(selectedCharacter(), characters).length
          ? 'No other tracked player with a successful quest sync matches this character’s region, ruleset, and faction.'
          : 'No shared suggestions for these filters.';
      list.append(node('p', message));
    } else if (!current?.completed && planner && catalog) {
      list.append(node('p', 'This character needs a successful Blizzard quest sync.'));
    }
  }

  async function show(id, trigger) {
    const version = ++requestVersion;
    selection = id;
    if (trigger) {
      list.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
      trigger.setAttribute('aria-pressed', 'true');
    } else {
      renderList();
    }
    const current = log();
    const completed = current?.completed?.find((quest) => quest.id === id);
    const observation = current?.history?.find((quest) => quest.id === id);
    const local = byId.get(id);
    const title = node('h3', completed?.name ?? observation?.name ?? local?.name ?? `Quest #${id}`);
    const state = completed ? 'Completed'
      : observation ? 'Previously reported as completed'
      : current?.completed ? 'No completion recorded in the last sync' : 'Completion data unavailable';
    const info = node('div', '');
    const links = node('p', '', { className: 'quest-guide-links' });
    links.append(
      node('a', 'ForeverDB guide', { href: `https://foreverdb.net/quest/${id}` }),
      node('a', 'Wowhead Forever reference', { href: `https://www.wowhead.com/forever/quest=${id}` }),
      node('a', 'Wowhead Classic reference', { href: `https://www.wowhead.com/classic/quest=${id}` }),
    );
    detail.replaceChildren(title, node('p', state, { className: 'muted' }), info, links);
    if (observation) {
      const when = observation.firstSeen
        ? `First seen ${new Date(observation.firstSeen).toLocaleString()}`
        : 'Completed before tracking began';
      detail.insertBefore(node('p', when, { className: 'muted' }), info);
    }
    function renderDetails(remote, message) {
      const quest = { ...local, ...remote, objectives: remote?.objectives || local?.objectives };
      info.replaceChildren();
      for (const [label, field] of [['Objectives', 'objectives'], ['Quest dialog', 'description'], ['Turn-in dialog', 'completion']]) {
        if (typeof quest[field] === 'string' && quest[field].trim()) {
          info.append(node('h4', label), node('p', quest[field], { className: 'quest-dialog-text' }));
        }
      }
      addLocation(info, { ...quest, zone: local?.zone ?? quest.zone });
      const chain = chains.get(id);
      if (chain) info.append(node('p', `Quest chain: ${chain.name} · ${chain.count} quests`));
      if (message) info.append(node('p', message, { className: 'muted' }));
    }
    renderDetails(null, 'Checking for quest dialog…');

    try {
      if (!cache.has(id)) {
        const pending = fetch(`https://thewowdb.com/api/v1/forever/quest/${id}`, { signal: AbortSignal.timeout(8_000) })
          .then((response) => {
            if (response.status === 404) return null;
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          });
        cache.set(id, pending);
        pending.catch(() => cache.delete(id));
      }
      const quest = await cache.get(id);
      if (version !== requestVersion) return;
      title.textContent = quest?.name ?? title.textContent;
      renderDetails(quest, quest?.description ? null : 'Full quest dialog is unavailable here. See the external guides below.');
      if (quest) links.prepend(node('a', 'Data from TheWoWDB', { href: sourceLink(quest.links?.html) ?? 'https://thewowdb.com/' }));
    } catch {
      if (version === requestVersion) renderDetails(null, 'The dialog provider did not respond. See the external guides below.');
    }

  }

  $('quest-lookup').addEventListener('submit', (event) => {
    event.preventDefault();
    const id = Number(new FormData(event.currentTarget).get('questId'));
    if (Number.isSafeInteger(id) && id > 0) show(id);
  });
  function resetList() {
    first = 0;
    renderList();
    list.scrollTop = 0;
  }
  const views = ['list', 'open', 'party', 'timeline'];
  for (const key of views) {
    $(`quest-${key}-view`).addEventListener('click', () => {
      view = key;
      for (const candidate of views) $(`quest-${candidate}-view`).setAttribute('aria-pressed', String(view === candidate));
      resetList();
    });
  }
  filter.addEventListener('input', resetList);
  groupBy.addEventListener('change', resetList);
  zoneFilter.addEventListener('change', resetList);
  eligibleOnly.addEventListener('change', resetList);
  select.addEventListener('change', () => {
    requestVersion++;
    selection = undefined;
    detail.replaceChildren(node('p', 'Select a quest or enter a quest ID.'));
    resetList();
  });
  renderList();

  let loading = false;
  async function loadCatalog() {
    if (loading) return;
    if (catalog) return;
    loading = true;
    catalogError = false;
    renderList();
    try {
      catalog = await loadQuestCatalog();
      byId = new Map(catalog.map((quest) => [quest.id, quest]));
      chains = questChains(catalog);
      if (selection) show(selection);
    } catch {
      catalog = undefined;
      catalogError = true;
    } finally {
      loading = false;
      resetList();
    }
  }
  retryCatalog.addEventListener('click', loadCatalog);
  const questTab = $('quest-tab');
  questTab.addEventListener('click', loadCatalog, { once: true });
  questTab.addEventListener('focus', loadCatalog, { once: true });
  if (questTab.getAttribute('aria-selected') === 'true') loadCatalog();
}
