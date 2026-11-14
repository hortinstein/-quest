import { dungeonRanges, zonePositions } from './leveling-data.js';

// Questing bands start at the listed level and end when the next band starts.
// The dungeon map supplies recommended ranges, not minimum entry levels.
const routes = {
  Horde: [
    [10, 'The Barrens', 'Silverpine Forest'],
    [18, 'The Barrens', 'Stonetalon Mountains', 'Ashenvale'],
    [22, 'Hillsbrad Foothills', 'The Barrens', 'Stonetalon Mountains', 'Ashenvale'],
    [28, 'Thousand Needles', 'Hillsbrad Foothills'],
    [30, 'Hillsbrad Foothills', 'Arathi Highlands'],
    [33, 'Thousand Needles', 'Desolace'],
    [35, 'Riverglades', 'Stranglethorn Vale', 'Dustwallow Marsh'],
    [38, 'Riverglades', 'Alterac Mountains', 'Arathi Highlands', 'Badlands'],
    [40, 'Stranglethorn Vale', 'Swamp of Sorrows'],
    [42, 'Desolace', 'Tanaris', 'Feralas'],
    [44, 'Stranglethorn Vale', 'Swamp of Sorrows', 'Tanaris'],
    [48, 'The Hinterlands', 'Feralas'],
    [50, 'Stranglethorn Vale', 'Blasted Lands'],
    [51, 'Searing Gorge', 'Burning Steppes'],
    [52, 'Azshara', 'Felwood', "Un'Goro Crater"],
    [55, 'Felwood', 'Winterspring', 'Western Plaguelands', 'Eastern Plaguelands'],
    [58, 'Winterspring', 'Silithus'],
  ],
  Alliance: [
    [10, 'Westfall', 'Loch Modan', 'Darkshore'],
    [17, 'Darkshore', 'Westfall', 'Redridge Mountains', 'Loch Modan', 'Ashenvale'],
    [20, 'Ashenvale', 'Duskwood', 'Wetlands'],
    [27, 'Duskwood', 'Wetlands', 'Hillsbrad Foothills', 'Ashenvale'],
    [30, 'Hillsbrad Foothills', 'Arathi Highlands', 'Stranglethorn Vale'],
    [33, 'Thousand Needles', 'Stranglethorn Vale', 'Desolace', 'Arathi Highlands', 'Alterac Mountains'],
    [36, 'Riverglades', 'Stranglethorn Vale', 'Alterac Mountains', 'Swamp of Sorrows', 'Arathi Highlands'],
    [40, 'Dustwallow Marsh', 'Swamp of Sorrows', 'Desolace', 'Badlands'],
    [42, 'Desolace', 'Stranglethorn Vale', 'Tanaris', 'Feralas'],
    [44, 'Stranglethorn Vale', 'Swamp of Sorrows', 'Tanaris', 'Dustwallow Marsh', 'Feralas'],
    [48, 'The Hinterlands', 'Tanaris', 'Feralas'],
    [50, 'Stranglethorn Vale', 'Searing Gorge', 'Blasted Lands', 'Felwood', 'Western Plaguelands'],
    [52, 'Feralas', 'Azshara', "Un'Goro Crater", 'Felwood'],
    [55, 'Winterspring', 'Burning Steppes', 'Western Plaguelands', 'Eastern Plaguelands'],
    [58, 'Winterspring', 'Silithus'],
  ],
};

const startingZones = {
  orc: 'Durotar', troll: 'Durotar', tauren: 'Mulgore',
  undead: 'Tirisfal Glades', dwarf: 'Dun Morogh', gnome: 'Dun Morogh',
  human: 'Elwynn Forest', 'night elf': 'Teldrassil', skyborne: 'Zephras Isle',
  'windshaper skyborne': 'Zephras Isle', 'high order skyborne': 'Zephras Isle',
};

export function recommendations(profile) {
  const level = profile?.level;
  const faction = profile?.faction;
  if (!Number.isInteger(level) || level < 1 || level > 60) return null;

  const route = Object.hasOwn(routes, faction) ? routes[faction] : [];
  const band = route.findLast(([minimum]) => level >= minimum);
  const start = startingZones[profile.race?.toLowerCase()];
  const zones = [...new Set([
    ...(level <= 12 && typeof start === 'string' ? [start] : []),
    ...(band?.slice(1) ?? []),
  ])].map((name) => ({ name, position: zonePositions[name] }));
  const dungeons = dungeonRanges
    .filter(([, low, high, , , side]) => level >= low && level <= high && (!side || side === faction))
    .sort((a, b) => b[1] - a[1])
    .map(([name, low, high, x, y]) => ({ name, low, high, position: [x, y] }));
  return { zones, dungeons };
}
