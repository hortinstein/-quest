const steps = [
  { title: '…and that note you found', ids: [79007, 79008] },
  { title: 'Stepping Stones', ids: [79192] },
  { title: 'Scramble', ids: [79980] },
  { title: 'Wet Job', ids: [79974] },
  { title: 'Eagle’s Fist', ids: [79975] },
  { title: 'This Must Be the Place', ids: [79976] },
];

export function sleepingBagProgress(log) {
  const completed = new Set([...(log?.completed ?? []), ...(log?.history ?? [])].map(({ id }) => id));
  return steps.map(({ ids }) => ids.some((id) => completed.has(id)));
}

function renderSleepingBag(characters) {
  const body = document.getElementById('sleeping-bag-rows');
  document.getElementById('sleeping-bag-empty').hidden = characters.length > 0;
  body.replaceChildren();
  for (const character of characters) {
    const log = character.questLog;
    const progress = sleepingBagProgress(log);
    const count = progress.filter(Boolean).length;
    const synced = Array.isArray(log?.completed);
    const row = body.insertRow();
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = character.profile?.name ?? character.name;
    const person = document.createElement('span');
    person.className = 'sub';
    person.textContent = character.person;
    name.append(person);
    row.append(name);
    const summary = row.insertCell();
    summary.textContent = synced || count ? `${count} / ${steps.length}` : 'No sync';
    if (log?.error && synced) {
      const stale = document.createElement('span');
      stale.className = 'sub';
      stale.textContent = 'Last known';
      summary.append(stale);
    }
    for (const done of progress) {
      const cell = row.insertCell();
      cell.className = done ? 'sleeping-bag-done' : 'muted';
      const mark = document.createElement('span');
      mark.textContent = done ? '✓' : '—';
      mark.setAttribute('aria-hidden', 'true');
      const status = document.createElement('span');
      status.className = 'sleeping-bag-status';
      status.textContent = done ? 'Completed' : synced ? 'No completion reported' : 'Unknown';
      cell.append(mark, status);
    }
  }
}

export function setupSleepingBag(characters) {
  const heading = document.getElementById('sleeping-bag-steps');
  for (const { title } of steps) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = title;
    heading.append(cell);
  }
  renderSleepingBag(characters);
}
