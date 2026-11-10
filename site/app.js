const DAY_MS = 86_400_000;
const MAX_SERIES = 8;
const MAX_END_LABELS = 4;
const SVG_NS = 'http://www.w3.org/2000/svg';

const METRICS = {
  level: { label: 'Level' },
  itemLevel: { label: 'Item level' },
  honorableKills: { label: 'Honorable kills' },
};
const SKILL_PREFIX = 'skill:';
const skillName = () => (state.metric.startsWith(SKILL_PREFIX) ? state.metric.slice(SKILL_PREFIX.length) : null);
const metricLabel = () => {
  const skill = skillName();
  return skill ? `${skill} skill` : METRICS[state.metric].label;
};
const metricValue = (snapshot) => {
  const skill = skillName();
  return skill ? snapshot.skills?.[skill] : snapshot[state.metric];
};

const AXES = {
  date: { label: 'By date' },
  elapsed: { label: 'Since first seen' },
};

const state = { metric: 'level', axis: 'date', characters: [] };
const $ = (id) => document.getElementById(id);

const number = new Intl.NumberFormat();
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const dateTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const formatValue = (value) => (value == null ? '—' : number.format(value));
const formatDate = (iso) => (iso ? dateFormat.format(new Date(iso)) : '—');
const formatDays = (days) => (days < 1 ? `${Math.round(days * 24)}h` : `Day ${number.format(Math.round(days * 10) / 10)}`);
const seriesLabel = (c) => `${c.person} · ${c.profile?.name ?? c.name}`;
const colorOf = (slot) => `var(--series-${slot})`;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (text != null) node.textContent = text;
  return node;
}

function lineKey(slot) {
  const key = el('span', { className: 'line-key' });
  key.style.background = colorOf(slot);
  return key;
}

function buildSeries() {
  return state.characters
    .filter((c) => c.watched && c.snapshots.length && c.slot < MAX_SERIES)
    .map((c) => {
      const origin = Date.parse(c.firstSeen);
      const toX = (iso) => (state.axis === 'date' ? Date.parse(iso) : (Date.parse(iso) - origin) / DAY_MS);
      const points = c.snapshots
        .filter((s) => metricValue(s) != null)
        .map((s) => ({ x: toX(s.t), y: metricValue(s) }));
      if (!points.length) return null;
      const last = points.at(-1);
      const endX = toX(c.lastSeen);
      if (endX > last.x) points.push({ x: endX, y: last.y });
      return { character: c, slot: c.slot, label: seriesLabel(c), points };
    })
    .filter(Boolean);
}

function niceStep(span, targetTicks) {
  const rough = span / targetTicks;
  const power = 10 ** Math.floor(Math.log10(rough));
  const scaled = rough / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
}

function yScale(values, top, bottom) {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const step = Math.max(1, Math.round(niceStep(max - min, 5)));
  const low = Math.floor(min / step) * step;
  const high = Math.ceil(max / step) * step;
  const ticks = [];
  for (let tick = low; tick <= high + step / 2; tick += step) ticks.push(tick);
  return { ticks, scale: (v) => bottom - ((v - low) / (high - low)) * (bottom - top) };
}

function timeTicks(min, max, targetTicks) {
  const hour = 3_600_000;
  const steps = [6, 12, 24, 48, 168, 336, 720, 2160, 4380, 8760].map((h) => h * hour);
  const step = steps.find((s) => (max - min) / s <= targetTicks) ?? steps.at(-1);
  const start = new Date(min);
  if (step >= DAY_MS) start.setHours(0, 0, 0, 0);
  else start.setMinutes(0, 0, 0);
  const ticks = [];
  for (let t = start.getTime(); t <= max; t += step) {
    if (t >= min) ticks.push({ value: t, label: (step >= DAY_MS ? shortDate : dateTime).format(t) });
  }
  // A span shorter than the smallest step can fall between ticks.
  if (!ticks.length) return [min, max].map((value) => ({ value, label: dateTime.format(value) }));
  return ticks;
}

function elapsedTicks(max, targetTicks) {
  const step = Math.max(0.25, niceStep(max, targetTicks));
  const ticks = [];
  for (let d = 0; d <= max + step / 2; d += step) ticks.push({ value: d, label: formatDays(d) });
  return ticks;
}

function valueAt(series, x) {
  if (x < series.points[0].x || x > series.points.at(-1).x) return null;
  let value = null;
  for (const point of series.points) {
    if (point.x > x) break;
    value = point.y;
  }
  return value;
}

function spreadLabels(labels, minGap, top, bottom) {
  labels.sort((a, b) => a.y - b.y);
  labels.forEach((label, i) => {
    label.y = Math.max(label.y, i ? labels[i - 1].y + minGap : top);
  });
  let limit = bottom;
  for (let i = labels.length - 1; i >= 0; i -= 1) {
    labels[i].y = Math.min(labels[i].y, limit);
    limit = labels[i].y - minGap;
  }
}

function renderChart() {
  const host = $('chart');
  host.replaceChildren();
  $('chart-title').textContent = `${metricLabel()} over time`;

  const series = buildSeries();
  renderLegend(series);
  if (!series.length) {
    host.append(el('div', {
      className: 'chart-empty',
      textContent: 'No history yet. The chart fills in after the first successful lookup.',
    }));
    return;
  }

  const width = Math.max(host.clientWidth, 280);
  const height = width < 520 ? 260 : 360;
  const showEndLabels = series.length <= MAX_END_LABELS && width >= 560;
  const margin = { top: 12, right: showEndLabels ? 200 : 16, bottom: 28, left: 48 };
  const plotRight = width - margin.right;
  const plotBottom = height - margin.bottom;

  const allX = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
  const pad = state.axis === 'date' ? DAY_MS : 1;
  const single = allX[0] === allX.at(-1);
  const minX = single ? allX[0] - pad : allX[0];
  const maxX = single ? allX[0] + pad : allX.at(-1);
  const x = (v) => margin.left + ((v - minX) / (maxX - minX)) * (plotRight - margin.left);
  const y = yScale(
    series.flatMap((s) => s.points.map((p) => p.y)),
    margin.top,
    plotBottom,
  );

  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    height,
    role: 'img',
    'aria-label': `${metricLabel()} over time for ${series.map((s) => s.label).join(', ')}. Exact values are in the comparison table.`,
  });

  for (const tick of y.ticks) {
    const py = y.scale(tick);
    root.append(
      svg('line', { x1: margin.left, x2: plotRight, y1: py, y2: py, stroke: 'var(--grid)' }),
      svg('text', { x: margin.left - 8, y: py + 4, 'text-anchor': 'end', class: 'axis-label' }, number.format(tick)),
    );
  }
  root.append(svg('line', { x1: margin.left, x2: plotRight, y1: plotBottom, y2: plotBottom, stroke: 'var(--axis)' }));

  const targetTicks = Math.max(2, Math.floor((plotRight - margin.left) / 130));
  const xTicks = state.axis === 'date' ? timeTicks(minX, maxX, targetTicks) : elapsedTicks(maxX, targetTicks);
  xTicks.forEach((tick) => {
    const px = x(tick.value);
    if (px > plotRight + 0.5) return;
    root.append(svg('text', { x: px, y: height - 8, 'text-anchor': 'middle', class: 'axis-label' }, tick.label));
  });

  for (const s of series) {
    const d = s.points
      .map((p, i) => {
        if (i === 0) return `M${x(p.x)} ${y.scale(p.y)}`;
        return `H${x(p.x)} V${y.scale(p.y)}`;
      })
      .join(' ');
    root.append(svg('path', {
      d,
      fill: 'none',
      stroke: colorOf(s.slot),
      'stroke-width': 2,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    }));
  }
  for (const s of series) {
    root.append(svg('circle', {
      cx: x(s.points[0].x),
      cy: y.scale(s.points[0].y),
      r: 4,
      fill: colorOf(s.slot),
      stroke: 'var(--surface)',
      'stroke-width': 2,
    }));
  }

  if (showEndLabels) {
    const labels = series.map((s) => ({ series: s, y: y.scale(s.points.at(-1).y) }));
    spreadLabels(labels, 16, margin.top + 4, plotBottom - 4);
    for (const label of labels) {
      root.append(
        svg('line', {
          x1: plotRight + 8,
          x2: plotRight + 20,
          y1: label.y,
          y2: label.y,
          stroke: colorOf(label.series.slot),
          'stroke-width': 2,
          'stroke-linecap': 'round',
        }),
        svg('text', { x: plotRight + 26, y: label.y + 4, class: 'end-label' }, truncate(label.series.label, 27)),
      );
    }
  }

  const crosshair = svg('line', { y1: margin.top, y2: plotBottom, stroke: 'var(--axis-ink)', visibility: 'hidden' });
  const hit = svg('rect', {
    x: margin.left,
    y: margin.top,
    width: plotRight - margin.left,
    height: plotBottom - margin.top,
    fill: 'transparent',
    tabindex: 0,
    class: 'hit',
    'aria-label': 'Chart readout. Use the left and right arrow keys to move between data points.',
  });
  root.append(crosshair, hit);
  host.append(root);

  const tooltip = el('div', { className: 'tooltip', hidden: true });
  host.append(tooltip);
  let activeIndex = allX.length - 1;

  function show(index) {
    activeIndex = index;
    const value = allX[index];
    const px = x(value);
    crosshair.setAttribute('x1', px);
    crosshair.setAttribute('x2', px);
    crosshair.setAttribute('visibility', 'visible');

    const title = state.axis === 'date' ? dateTime.format(value) : formatDays(value);
    const rows = series
      .map((s) => ({ s, v: valueAt(s, value) }))
      .filter((row) => row.v != null)
      .sort((a, b) => b.v - a.v)
      .map(({ s, v }) => el(
        'div',
        { className: 'tooltip-row' },
        lineKey(s.slot),
        el('strong', { textContent: number.format(v) }),
        el('span', { textContent: s.label }),
      ));
    tooltip.replaceChildren(el('div', { className: 'tooltip-title', textContent: title }), ...rows);
    tooltip.hidden = false;
    const flip = px > width / 2;
    tooltip.style.left = flip ? 'auto' : `${px + 12}px`;
    tooltip.style.right = flip ? `${width - px + 12}px` : 'auto';
  }

  function hide() {
    crosshair.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  }

  hit.addEventListener('pointermove', (event) => {
    const box = root.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    let nearest = 0;
    allX.forEach((value, i) => {
      if (Math.abs(x(value) - px) < Math.abs(x(allX[nearest]) - px)) nearest = i;
    });
    show(nearest);
  });
  hit.addEventListener('pointerleave', hide);
  hit.addEventListener('focus', () => show(activeIndex));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (event) => {
    const move = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!move) return;
    event.preventDefault();
    show(Math.min(allX.length - 1, Math.max(0, activeIndex + move)));
  });
}

function truncate(text, length) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function renderLegend(series) {
  $('legend').replaceChildren(
    ...(series.length >= 2
      ? series.map((s) => el('span', {}, lineKey(s.slot), s.label))
      : []),
  );
  const hidden = state.characters.filter((c) => c.watched && c.snapshots.length && c.slot >= MAX_SERIES).length;
  $('chart-note').hidden = hidden === 0;
  $('chart-note').textContent = hidden ? `${hidden} more on the table below. The chart shows the first ${MAX_SERIES}.` : '';
}

function renderTable() {
  const rows = state.characters
    .filter((c) => c.watched && c.profile)
    .sort((a, b) => (b.profile.level ?? -1) - (a.profile.level ?? -1));

  $('empty-table').hidden = rows.length > 0;
  $('rows').replaceChildren(...rows.map((c) => {
    const p = c.profile;
    const person = el('td');
    if (c.slot < MAX_SERIES) person.append(lineKey(c.slot));
    person.append(c.person);

    const details = [[p.race, p.className].filter(Boolean).join(' '), p.faction, p.ruleset, c.region.toUpperCase()]
      .filter(Boolean)
      .join(' · ');
    const professions = p.professions
      .map((prof) => {
        const gained = c.stats?.skillsGained?.[prof.name];
        return `${prof.name} ${prof.skill}/${prof.max}${gained > 0 ? ` (+${gained})` : ''}`;
      })
      .join(', ');
    const cell = (text, numeric) => el('td', { textContent: text, className: numeric ? 'num' : '' });
    return el(
      'tr',
      {},
      person,
      el('td', {}, el('a', { href: c.url, textContent: p.name ?? c.name }), el('span', { className: 'sub', textContent: details })),
      cell(formatValue(p.level), true),
      cell(formatValue(p.itemLevel), true),
      cell(formatValue(p.honorableKills), true),
      cell(formatValue(c.stats?.levelsGained), true),
      cell(formatValue(c.stats?.levelsPerDay), true),
      cell(formatDate(c.firstSeen)),
      cell(formatDate(p.lastUpdated)),
      el('td', { textContent: professions || '—', className: 'wrap' }),
    );
  }));
}

function renderAttention() {
  const problems = state.characters.filter((c) => c.watched && c.status !== 'ok');
  $('attention').hidden = problems.length === 0;
  $('attention-list').replaceChildren(...problems.map((c) => el(
    'li',
    {},
    `${c.person} · ${c.name}`,
    el('span', { className: 'muted', textContent: c.message ?? c.status }),
  )));
}

function renderControl(hostId, options, key) {
  $(hostId).replaceChildren(...Object.entries(options).map(([value, option]) => {
    const button = el('button', { type: 'button', textContent: option.label });
    button.setAttribute('aria-pressed', String(state[key] === value));
    button.addEventListener('click', () => {
      state[key] = value;
      renderControls();
      renderChart();
    });
    return button;
  }));
}

function renderSkillPicker() {
  const names = [...new Set(
    state.characters.filter((c) => c.watched && c.profile).flatMap((c) => c.profile.professions.map((p) => p.name)),
  )].sort();
  const picker = $('skill');
  picker.hidden = names.length === 0;
  picker.replaceChildren(
    el('option', { value: '', textContent: 'Profession skill…' }),
    ...names.map((name) => el('option', { value: name, textContent: name })),
  );
  picker.value = skillName() ?? '';
}

function renderControls() {
  renderControl('metric', METRICS, 'metric');
  renderControl('axis', AXES, 'axis');
  renderSkillPicker();
}

async function start() {
  $('skill').addEventListener('change', (event) => {
    state.metric = event.target.value ? `${SKILL_PREFIX}${event.target.value}` : 'level';
    renderControls();
    renderChart();
  });
  renderControls();
  try {
    const response = await fetch('data/characters.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.characters = data.characters;
    $('updated').textContent = `Last checked ${dateTime.format(new Date(data.generatedAt))}`;
  } catch (error) {
    $('updated').textContent = `Could not load character data (${error.message}).`;
  }
  renderControls();
  renderChart();
  renderTable();
  renderAttention();

  let lastWidth = $('chart').clientWidth;
  new ResizeObserver(() => {
    const width = $('chart').clientWidth;
    if (width === lastWidth) return;
    lastWidth = width;
    renderChart();
  }).observe($('chart'));
}

start();
