// Deterministic real-world spawns and stops, generated from GPS position +
// time. Everyone standing in the same place at the same time sees the same
// Pokémon, like the real game, but nothing talks to anyone's servers.
import { DEX, stage } from './data.js';
import { hash, rng, weightedPick, distM } from './util.js';
import { S, trainerLevel } from './store.js';

const CELL = 0.0012;                 // ~130 m cells
const WINDOW_MS = 15 * 60 * 1000;    // spawns rotate every 15 minutes
export const CATCH_RANGE_M = 80;
export const STOP_RANGE_M = 60;
export const VIEW_RADIUS_M = 450;
export const STOP_COOLDOWN_MS = 5 * 60 * 1000;

export const BIOMES = [
  { name: 'Meadow', icon: '🌼', types: ['grass', 'bug', 'normal', 'fairy'] },
  { name: 'Lakeside', icon: '🌊', types: ['water', 'ice', 'flying'] },
  { name: 'Volcanic', icon: '🌋', types: ['fire', 'rock', 'ground', 'dragon'] },
  { name: 'Urban', icon: '🏙️', types: ['electric', 'steel', 'poison', 'normal'] },
  { name: 'Forest', icon: '🌲', types: ['bug', 'grass', 'poison', 'dark'] },
  { name: 'Mountain', icon: '⛰️', types: ['rock', 'fighting', 'ground', 'ice', 'steel'] },
  { name: 'Mystic', icon: '🔮', types: ['psychic', 'fairy', 'ghost', 'dragon'] },
];

const cellY = lat => Math.floor(lat / CELL);
const lngStep = cy => CELL / Math.cos(((cy + 0.5) * CELL * Math.PI) / 180);
const cellX = (lng, cy) => Math.floor(lng / lngStep(cy));

export function biomeAt(pos) {
  const cy = cellY(pos.lat), cx = cellX(pos.lng, cy);
  return BIOMES[hash('biome', cx >> 3, cy >> 3) % BIOMES.length];
}

export const isNight = (d = new Date()) => d.getHours() >= 20 || d.getHours() < 6;

// Weight tables are expensive to build, so cache per (biome, night, level band).
const tableCache = new Map();
function table(biome, night, tlv) {
  const key = `${biome.name}|${night}|${tlv >= 20 ? 2 : tlv >= 10 ? 1 : 0}`;
  if (tableCache.has(key)) return tableCache.get(key);
  const rows = [];
  for (const s of DEX) {
    let w;
    if (s.rarity === 'mythical') w = tlv >= 20 ? 0.04 : 0;
    else if (s.rarity === 'legendary') w = tlv >= 10 ? 0.12 : 0;
    else {
      w = Math.max(3, s.capture) / (1 + stage(s.id) * 2);
      if (s.rarity === 'baby') w *= 0.3;
    }
    if (!w) continue;
    if (s.types.some(t => biome.types.includes(t))) w *= 5;
    if (night && s.types.some(t => t === 'ghost' || t === 'dark' || t === 'psychic')) w *= 3;
    if (!night && s.types.includes('ghost')) w *= 0.4;
    rows.push({ id: s.id, w });
  }
  tableCache.set(key, rows);
  return rows;
}

function cellSpawns(cx, cy, win, night, tlv) {
  const r = rng(hash('spawn', cx, cy, win));
  const out = [];
  const count = r() < 0.45 ? (r() < 0.2 ? 2 : 1) : 0;
  if (!count) return out;
  const ls = lngStep(cy);
  const biome = BIOMES[hash('biome', cx >> 3, cy >> 3) % BIOMES.length];
  const rows = table(biome, night, tlv);
  for (let i = 0; i < count; i++) {
    const pick = weightedPick(rows, x => x.w, r);
    const key = `${cx}:${cy}:${win}:${i}`;
    out.push({
      key,
      id: pick.id,
      shiny: r() < 1 / 200,
      lat: (cy + 0.1 + r() * 0.8) * CELL,
      lng: (cx + 0.1 + r() * 0.8) * ls,
      expires: (win + 1) * WINDOW_MS,
      biome: biome.name,
    });
  }
  return out;
}

export function spawnsNear(pos, t = Date.now()) {
  const st = S();
  const win = Math.floor(t / WINDOW_MS);
  const night = isNight(new Date(t));
  const tlv = trainerLevel(st.trainer.xp);
  const span = Math.ceil(VIEW_RADIUS_M / 130) + 1;
  const cy0 = cellY(pos.lat);
  const out = [];
  for (let dy = -span; dy <= span; dy++) {
    const cy = cy0 + dy;
    const cx0 = cellX(pos.lng, cy);
    for (let dx = -span; dx <= span; dx++) {
      for (const sp of cellSpawns(cx0 + dx, cy, win, night, tlv)) {
        if (st.caughtSpawns[sp.key]) continue;
        sp.dist = distM(pos, sp);
        if (sp.dist <= VIEW_RADIUS_M) out.push(sp);
      }
    }
  }
  return out.sort((a, b) => a.dist - b.dist);
}

export function stopsNear(pos) {
  const span = Math.ceil(VIEW_RADIUS_M / 130) + 1;
  const cy0 = cellY(pos.lat);
  const out = [];
  for (let dy = -span; dy <= span; dy++) {
    const cy = cy0 + dy;
    const cx0 = cellX(pos.lng, cy);
    const ls = lngStep(cy);
    for (let dx = -span; dx <= span; dx++) {
      const cx = cx0 + dx;
      if (hash('stop', cx, cy) % 4 !== 0) continue;
      const r = rng(hash('stoppos', cx, cy));
      const stop = { key: `${cx}:${cy}`, lat: (cy + 0.2 + r() * 0.6) * CELL, lng: (cx + 0.2 + r() * 0.6) * ls };
      stop.dist = distM(pos, stop);
      if (stop.dist <= VIEW_RADIUS_M) out.push(stop);
    }
  }
  return out;
}

export const stopReady = stop => !S().spun[stop.key] || Date.now() - S().spun[stop.key] > STOP_COOLDOWN_MS;

// Rewards for spinning a stop. Returns a list of [label, amount] for display.
export function spinStop(stop, giveEgg) {
  const st = S();
  st.spun[stop.key] = Date.now();
  st.trainer.spins++;
  const tlv = trainerLevel(st.trainer.xp);
  const got = [];
  const add = (k, n, label) => {
    if (n <= 0) return;
    st.bag[k] += n;
    got.push([label, n]);
  };
  add('poke', 3 + Math.floor(Math.random() * 3), 'Poké Ball');
  if (tlv >= 5) add('great', Math.floor(Math.random() * 3), 'Great Ball');
  if (tlv >= 12) add('ultra', Math.floor(Math.random() * 2), 'Ultra Ball');
  add('razz', Math.random() < 0.4 ? 1 : 0, 'Razz Berry');
  const c = Math.floor(Math.random() * 3);
  add(['berryR', 'berryB', 'berryG'][c], 1 + Math.floor(Math.random() * 2), ['Red', 'Blue', 'Green'][c] + ' Berry');
  add('poffin', Math.random() < 0.15 ? 1 : 0, 'Poffin');
  if (Math.random() < 0.18) {
    const egg = giveEgg();
    if (egg) got.push([`${egg.km} km Egg`, 1]);
  }
  return got;
}
