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
  let timeline = false;
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
    const records = timeline ? current?.history ?? quests : quests;
    const matches = records.filter(({ id, name }) =>
      String(id).includes(query) || name?.toLowerCase().includes(query));
    const summary = current?.completed
      ? `${quests.length.toLocaleString()} completed · synced ${new Date(current.updatedAt).toLocaleString()}`
      : 'No quest sync available.';
    status.textContent = current?.error ? `${summary} Latest sync failed (${current.error}).` : summary;

    if (timeline) matches.sort((a, b) => (b.firstSeen ?? '').localeCompare(a.firstSeen ?? ''));
    list.setAttribute('aria-label', timeline ? 'Quest timeline' : 'Completed quests');
    list.replaceChildren();
    if (timeline) list.append(node('p', 'First seen during a sync. Dates are shown in your local time.', { className: 'muted' }));
    let group;
    for (const quest of matches) {
      if (timeline) {
        const day = quest.firstSeen
          ? new Date(quest.firstSeen).toLocaleDateString(undefined, { dateStyle: 'long' })
          : 'Completed before tracking began';
        if (day !== group) {
          list.append(node('h4', day));
          group = day;
        }
      }
      const button = node('button', quest.name ?? `Quest #${quest.id}`, { type: 'button' });
      button.setAttribute('aria-pressed', String(selection === quest.id));
      button.addEventListener('click', () => show(quest.id, button));
      list.append(button);
    }
    if (!matches.length && current?.completed) list.append(node('p', 'No matching completed quests.'));
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
    const title = node('h3', completed?.name ?? observation?.name ?? `Quest #${id}`);
    const state = completed ? 'Completed'
      : observation ? 'Previously reported as completed'
      : current?.completed ? 'No completion recorded in the last sync' : 'Completion data unavailable';
    const info = node('div', '');
    const links = node('p', '', { className: 'quest-guide-links' });
    links.append(
      node('a', 'ForeverDB guide', { href: `https://foreverdb.net/quest/${id}` }),
      node('a', 'Wowhead Classic reference', { href: `https://www.wowhead.com/classic/quest=${id}` }),
    );
    detail.replaceChildren(title, node('p', state, { className: 'muted' }), info, links);
    if (observation) {
      const when = observation.firstSeen
        ? `First seen ${new Date(observation.firstSeen).toLocaleString()}`
        : 'Completed before tracking began';
      detail.insertBefore(node('p', when, { className: 'muted' }), info);
    }
    info.append(node('p', 'Loading quest details…'));

    try {
      if (!cache.has(id)) {
        const pending = fetch(`https://thewowdb.com/api/v1/forever/quest/${id}`, { signal: AbortSignal.timeout(12_000) })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          });
        cache.set(id, pending);
        pending.catch(() => cache.delete(id));
      }
      const quest = await cache.get(id);
      if (version !== requestVersion) return;
      title.textContent = quest.name ?? title.textContent;
      info.replaceChildren();
      for (const [label, field] of [['Objectives', 'objectives'], ['Quest dialog', 'description'], ['Turn-in dialog', 'completion']]) {
        if (typeof quest[field] === 'string' && quest[field].trim()) {
          info.append(node('h4', label), node('p', quest[field], { className: 'quest-dialog-text' }));
        }
      }
      if (!quest.description) info.append(node('p', 'Quest dialog unavailable.'));
      addLocation(info, quest);
      const credit = sourceLink(quest.links?.html) ?? 'https://thewowdb.com/';
      links.prepend(node('a', 'Data from TheWoWDB', { href: credit }));
    } catch {
      if (version === requestVersion) info.replaceChildren(node('p', 'Quest details could not be loaded. Try again or open a guide below.'));
    }
  }

  $('quest-lookup').addEventListener('submit', (event) => {
    event.preventDefault();
    const id = Number(new FormData(event.currentTarget).get('questId'));
    if (Number.isSafeInteger(id) && id > 0) show(id);
  });
  const listView = $('quest-list-view');
  const timelineView = $('quest-timeline-view');
  function setView(showTimeline) {
    timeline = showTimeline;
    listView.setAttribute('aria-pressed', String(!timeline));
    timelineView.setAttribute('aria-pressed', String(timeline));
    renderList();
  }
  listView.addEventListener('click', () => setView(false));
  timelineView.addEventListener('click', () => setView(true));
  filter.addEventListener('input', renderList);
  select.addEventListener('change', () => {
    requestVersion++;
    selection = undefined;
    detail.replaceChildren(node('p', 'Select a completed quest or enter a quest ID.'));
    renderList();
  });
  renderList();
}
