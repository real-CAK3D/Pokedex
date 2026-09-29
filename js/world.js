// Deterministic real-world spawns and stops, generated from GPS position +
// time. Everyone standing in the same place at the same time sees the same
// Pokémon, like the real game, but nothing talks to anyone's servers.
import { DEX, stage } from './data.js';
import { hash, rng, weightedPick, distM } from './util.js';
import { S, trainerLevel, emit } from './store.js';

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

// ---- stops at real places (OpenStreetMap via the free Overpass API) ----
// Landmarks around you (art, statues, churches, fountains, libraries, parks,
// cafés…) become stops, like the real game. Fetched per ~1 km tile, cached on
// the device; if offline or nothing is mapped nearby, generated stops are used.
const POI_TILE = 0.01;
const POI_CACHE_KEY = 'pokedex-poi-v1';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
let poiCache = null;
const poiLoading = new Set();

function loadPoiCache() {
  if (poiCache) return poiCache;
  try { poiCache = JSON.parse(localStorage.getItem(POI_CACHE_KEY)) || {}; } catch { poiCache = {}; }
  return poiCache;
}

function savePoiCache() {
  const keys = Object.keys(poiCache);
  // keep the 40 most recent tiles
  if (keys.length > 40) keys.sort((a, b) => poiCache[a].t - poiCache[b].t).slice(0, keys.length - 40).forEach(k => delete poiCache[k]);
  try { localStorage.setItem(POI_CACHE_KEY, JSON.stringify(poiCache)); } catch { /* full */ }
}

const poiTileKey = (lat, lng) => `${Math.floor(lat / POI_TILE)}:${Math.floor(lng / POI_TILE)}`;

function describe(tags) {
  if (tags.tourism === 'artwork') return '🎨';
  if (tags.historic) return '🏛️';
  if (tags.amenity === 'place_of_worship') return '⛪';
  if (tags.amenity === 'fountain') return '⛲';
  if (tags.amenity === 'library') return '📚';
  if (tags.leisure === 'playground') return '🛝';
  if (tags.leisure === 'park') return '🌳';
  if (tags.amenity === 'cafe') return '☕';
  if (tags.tourism) return '📸';
  return '◆';
}

// Overpass allows ~2 concurrent requests per user, so tiles load one at a time.
let poiQueue = Promise.resolve();
const poiFailedAt = {};
function fetchPoiTile(key) {
  if (poiLoading.has(key) || Date.now() - (poiFailedAt[key] || 0) < 60000) return;
  poiLoading.add(key);
  poiQueue = poiQueue.then(() => loadPoiTile(key));
}

async function loadPoiTile(key) {
  const [ty, tx] = key.split(':').map(Number);
  const bbox = `${ty * POI_TILE},${tx * POI_TILE},${(ty + 1) * POI_TILE},${(tx + 1) * POI_TILE}`;
  const q = `[out:json][timeout:20];(
    node(${bbox})[tourism~"^(artwork|museum|attraction|viewpoint|gallery)$"];
    node(${bbox})[historic][name];
    node(${bbox})[amenity~"^(place_of_worship|library|fountain|townhall|arts_centre|theatre|community_centre|cafe|post_office)$"][name];
    nwr(${bbox})[leisure~"^(park|playground|sports_centre)$"][name];
  );out center 400;`;
  try {
    let data = null;
    for (const endpoint of OVERPASS) {
      try {
        const res = await fetch(endpoint, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (res.ok) { data = await res.json(); break; }
      } catch { /* try the next mirror */ }
    }
    if (!data) throw new Error('overpass unavailable');
    const pois = [];
    for (const el of data.elements) {
      const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
      if (lat == null) continue;
      // keep stops at least ~40 m apart so dense downtowns aren't wall-to-wall
      const name = el.tags?.name || el.tags?.artwork_type || 'Landmark';
      // big parks come back as several pieces: one stop per name per area
      if (pois.some(p => distM(p, { lat, lng }) < 40 || (p.name === name && distM(p, { lat, lng }) < 600))) continue;
      pois.push({ key: `osm:${el.type[0]}${el.id}`, lat, lng, name, icon: describe(el.tags || {}) });
    }
    loadPoiCache()[key] = { t: Date.now(), pois };
    savePoiCache();
    emit('geo');
  } catch {
    // offline / overloaded: generated stops cover this area; retry in a minute
    poiFailedAt[key] = Date.now();
  } finally {
    poiLoading.delete(key);
  }
}

export function stopsNear(pos) {
  const cache = loadPoiCache();
  const keys = new Set();
  for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) keys.add(poiTileKey(pos.lat + dy * POI_TILE * 0.5, pos.lng + dx * POI_TILE * 0.5));
  let have = true;
  const real = [];
  for (const k of keys) {
    const tile = cache[k];
    if (!tile || Date.now() - tile.t > 7 * 864e5) { fetchPoiTile(k); if (!tile) have = false; }
    if (tile) real.push(...tile.pois);
  }
  const near = real.map(p => ({ ...p, dist: distM(pos, p) })).filter(p => p.dist <= VIEW_RADIUS_M);
  if (near.length >= 3 || (have && near.length)) return near;
  return generatedStops(pos).concat(near);
}

function generatedStops(pos) {
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
