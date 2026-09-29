// Single source of truth for the whole game. The Pokédex, the pet (TamaPoke
// care sim), the map/catching and the PC box all read and write this state,
// so anything caught, hatched or evolved shows up everywhere at once.
import { DEX, byId, family, stage, isLegend } from './data.js';
import { clamp, uid, weightedPick, now } from './util.js';

const KEY = 'pokedex-tamapoke-save-v1';

// ---- tuning (ported from TamaPoke, slowed down for a phone) ----
export const TICK_MS = 5 * 60 * 1000;   // one care tick = 5 real minutes
const OFFLINE_CAP_TICKS = 14 * 24 * 12;  // catch up at most 2 weeks
const POOP_CHANCE = 0.15;
const MISTAKE_COOLDOWN = 6;              // ticks (30 min) between slip-ups
const BOND_DAILY_CAP = 8;
export const XP_PER_TICK = 5;            // passive buddy xp per awake tick
export const MAX_EGGS = 9;
export const STAT_KEYS = ['food', 'joy', 'energy', 'hygiene'];

export const monLevel = xp => Math.min(100, Math.floor(Math.sqrt(xp / 6)) + 1);
export const xpForLevel = lv => 6 * (lv - 1) ** 2;
export const trainerLevel = xp => Math.min(50, Math.floor(Math.sqrt(xp / 500)) + 1);
export const xpForTrainer = lv => 500 * (lv - 1) ** 2;

let state = null;
const listeners = new Set();
let saveTimer = 0;

export const S = () => state;
export const on = fn => (listeners.add(fn), () => listeners.delete(fn));

export function emit(kind = 'change', data) {
  for (const fn of listeners) fn(kind, data);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

function fresh() {
  return {
    v: 1,
    created: now(),
    trainer: { name: 'Trainer', xp: 0, meters: 0, streak: 0, bestStreak: 0, lastCareDay: 0, caught: 0, hatched: 0, spins: 0 },
    bag: { poke: 20, great: 0, ultra: 0, razz: 3, berryR: 5, berryB: 5, berryG: 5, poffin: 2, rareCandy: 0 },
    dex: { seen: {}, caught: {}, shiny: {} },
    mons: [],
    buddy: null,
    eggs: [],
    spun: {},        // stopKey -> timestamp
    caughtSpawns: {},// spawnKey -> timestamp
    lastTick: now(),
    settings: { deskMode: false, hideUncaught: false, sound: true },
    log: [],
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? { ...fresh(), ...JSON.parse(raw) } : fresh();
  } catch {
    state = fresh();
  }
  return state;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('save failed', e);
  }
}

export function exportSave() {
  return JSON.stringify(state);
}

export function importSave(json) {
  const parsed = JSON.parse(json);
  if (!parsed?.trainer || !Array.isArray(parsed.mons)) throw new Error('Not a Pokédex save file');
  state = { ...fresh(), ...parsed };
  emit('reset');
}

export function wipe() {
  state = fresh();
  save();
  emit('reset');
}

export function log(msg) {
  state.log.unshift({ t: now(), msg });
  state.log.length = Math.min(state.log.length, 60);
}

// ---------------------------------------------------------------- trainer
export function addTrainerXp(n) {
  const before = trainerLevel(state.trainer.xp);
  state.trainer.xp += n;
  const after = trainerLevel(state.trainer.xp);
  if (after > before) {
    log(`Trainer reached level ${after}!`);
    emit('trainerLevel', after);
  }
}

// ---------------------------------------------------------------- dex
export function markSeen(id) {
  if (!state.dex.seen[id]) {
    state.dex.seen[id] = now();
    return true;
  }
  return false;
}

export function registerCaught(id, shiny) {
  markSeen(id);
  const isNew = !state.dex.caught[id];
  state.dex.caught[id] = (state.dex.caught[id] || 0) + 1;
  if (shiny) state.dex.shiny[id] = 1;
  if (isNew) addTrainerXp(500);
  return isNew;
}

export const caughtCount = () => Object.keys(state.dex.caught).length;
export const seenCount = () => Object.keys(state.dex.seen).length;

// ---------------------------------------------------------------- mons
const rollGene = () => 90 + Math.floor(Math.random() * 21);

export function makeMon(id, { shiny = false, level = 1, origin = 'wild', where = null } = {}) {
  return {
    uid: uid(), id, shiny, nick: '', origin, where,
    xp: xpForLevel(level), got: now(),
    genes: [rollGene(), rollGene(), rollGene()],
    tr: [0, 0, 0],                    // training: atk (bag), def (good care), spe (minigame)
    food: 80, joy: 80, energy: 80, hygiene: 100, poops: 0, weight: 0,
    bond: 0, bondToday: 0, bondDay: 0,
    sleeping: false, mistakes: 0, mistakeCd: 0, goodTicks: 0, neglect: 0,
    berryKnown: false, evoDeclinedLv: 0, eatUntil: 0, heartUntil: 0,
  };
}

export function addMon(mon) {
  state.mons.push(mon);
  const isNew = registerCaught(mon.id, mon.shiny);
  if (!state.buddy) state.buddy = mon.uid;
  return isNew;
}

export const getMon = u => state.mons.find(m => m.uid === u);
export const buddy = () => getMon(state.buddy);
export const monName = m => m.nick || byId(m.id).name;

export function setBuddy(u) {
  const m = getMon(u);
  if (!m) return;
  m.lastActive = now();
  state.buddy = u;
  log(`${monName(m)} is now your buddy.`);
  emit();
}

export function releaseMon(u) {
  const m = getMon(u);
  if (!m || state.mons.length <= 1) return false;
  state.mons = state.mons.filter(x => x.uid !== u);
  if (state.buddy === u) state.buddy = state.mons[0].uid;
  state.bag.rareCandy += 1;
  log(`Transferred ${monName(m)} to the Professor. Got a Rare Candy.`);
  emit();
  return true;
}

export function rename(u, nick) {
  const m = getMon(u);
  if (m) m.nick = nick.trim().slice(0, 12);
  emit();
}

// Battle-ish stats: real base stat x genes + level + training.
export function battleStats(m) {
  const s = byId(m.id).stats;
  const lv = monLevel(m.xp);
  const f = (base, gene, tr) => Math.round((base * gene) / 100 * (0.5 + lv / 100) + tr);
  return { atk: f(s[1], m.genes[0], m.tr[0]), def: f(s[2], m.genes[1], m.tr[1]), spe: f(s[5], m.genes[2], m.tr[2]) };
}

// ---------------------------------------------------------------- care sim
const day = t => Math.floor(t / 86400000);

function registerCare(m) {
  const t = state.trainer;
  const today = day(now());
  if (t.lastCareDay !== today) {
    t.streak = t.lastCareDay === today - 1 ? t.streak + 1 : 1;
    t.bestStreak = Math.max(t.bestStreak, t.streak);
    t.lastCareDay = today;
    if ([3, 7, 30, 100].includes(t.streak)) {
      log(`${t.streak}-day care streak!`);
      emit('toast', `🔥 ${t.streak}-day care streak!`);
    }
  }
  addBond(m, 1);
  m.xp += 5;
}

function addBond(m, amt) {
  const today = day(now());
  if (m.bondDay !== today) { m.bondDay = today; m.bondToday = 0; }
  const room = BOND_DAILY_CAP - m.bondToday;
  const add = Math.max(0, Math.min(amt, room));
  m.bondToday += add;
  m.bond = clamp(m.bond + add, 0, 100);
}

export const lovesBerry = (m, color) => m.id % 3 === color;

function wake(m) {
  if (m.sleeping) m.sleeping = false;
}

export function feedBerry(m, color) {
  const key = ['berryR', 'berryB', 'berryG'][color];
  if (state.bag[key] <= 0) return 'none';
  state.bag[key]--;
  wake(m);
  const loved = lovesBerry(m, color);
  m.food = clamp(m.food + (loved ? 35 : 25), 0, 100);
  if (loved) {
    m.joy = clamp(m.joy + 10, 0, 100);
    m.heartUntil = now() + 1500;
    addBond(m, 2);
    if (!m.berryKnown) { m.berryKnown = true; log(`${monName(m)} loves ${['red', 'blue', 'green'][color]} berries!`); }
  }
  m.eatUntil = now() + 2500;
  registerCare(m);
  emit();
  return loved ? 'loved' : 'ok';
}

export function feedPoffin(m) {
  if (state.bag.poffin <= 0) return 'none';
  state.bag.poffin--;
  wake(m);
  m.food = clamp(m.food + 10, 0, 100);
  m.joy = clamp(m.joy + 12, 0, 100);
  m.weight = clamp(m.weight + 12, 0, 100);
  m.eatUntil = now() + 2500;
  m.heartUntil = now() + 1500;
  registerCare(m);
  emit();
  return 'ok';
}

// Basic food is unlimited so you can never soft-lock without walking.
export function feedBasic(m) {
  wake(m);
  m.food = clamp(m.food + 15, 0, 100);
  m.eatUntil = now() + 2500;
  registerCare(m);
  emit();
}

export function useRareCandy(m) {
  if (state.bag.rareCandy <= 0) return false;
  const lv = monLevel(m.xp);
  if (lv >= 100) return false;
  state.bag.rareCandy--;
  m.xp = xpForLevel(lv + 1);
  log(`${monName(m)} grew to level ${lv + 1}!`);
  emit();
  return true;
}

export function clean(m) {
  m.poops = 0;
  m.hygiene = 100;
  registerCare(m);
  emit();
}

export function caress(m) {
  if (m.sleeping) return;
  m.joy = clamp(m.joy + 5, 0, 100);
  m.heartUntil = now() + 1500;
  addBond(m, 1);
  registerCare(m);
  emit();
}

export function toggleSleep(m) {
  m.sleeping = !m.sleeping;
  emit();
}

export function playResult(m, score) {
  m.joy = clamp(m.joy + Math.min(30, 5 + score * 2), 0, 100);
  m.energy = clamp(m.energy - 10, 0, 100);
  m.weight = clamp(m.weight - Math.ceil(score / 2), 0, 100);
  m.tr[2] = clamp(m.tr[2] + Math.min(12, Math.floor(score / 3)), 0, 100);
  m.xp += score * 3;
  registerCare(m);
  emit();
}

export function trainResult(m, hits) {
  const gain = Math.min(18, Math.floor(hits / 4));
  m.tr[0] = clamp(m.tr[0] + gain, 0, 100);
  m.energy = clamp(m.energy - 15, 0, 100);
  m.food = clamp(m.food - 5, 0, 100);
  m.weight = clamp(m.weight - 3, 0, 100);
  m.xp += hits;
  registerCare(m);
  emit();
  return gain;
}

// One care tick. `resting` = the app was closed: gentle, sleep-like drain,
// no poops and no slip-ups (a phone app shouldn't punish you for sleeping).
function tick(m, resting) {
  if (resting || m.sleeping) {
    m.food = Math.max(Math.min(m.food, 30), m.food - 0.5);
    m.joy = Math.max(Math.min(m.joy, 35), m.joy - 0.25);
    m.hygiene = Math.max(Math.min(m.hygiene, 45), m.hygiene - 0.25);
    m.energy = clamp(m.energy + (m.sleeping ? 6 : 2), 0, 100);
    m.xp += resting ? 2 : 1;
    if (m.sleeping && m.energy >= 100) m.sleeping = false;
    return;
  }
  m.food = clamp(m.food - 2, 0, 100);
  m.energy = clamp(m.energy - 1 - (m.weight > 50 ? 1 : 0), 0, 100);
  m.hygiene = clamp(m.hygiene - 1 - 4 * m.poops, 0, 100);
  m.joy = clamp(m.joy - 1 - (m.food < 30 ? 2 : 0) - (m.hygiene < 30 ? 2 : 0), 0, 100);
  if (m.food > 40 && m.poops < 3 && Math.random() < POOP_CHANCE) m.poops++;
  m.xp += XP_PER_TICK;

  const low = Math.min(m.food, m.joy, m.energy, m.hygiene);
  if (m.mistakeCd > 0) m.mistakeCd--;
  if (low <= 10 && m.mistakeCd === 0) {
    m.mistakes++;
    m.mistakeCd = MISTAKE_COOLDOWN;
    m.bond = clamp(m.bond - 5, 0, 100);
    log(`${monName(m)} was neglected… (evolution delayed)`);
  }
  if (low >= 50) {
    if (++m.goodTicks >= 144) { // 12h of unbroken good care forges DEF
      m.goodTicks = 0;
      m.tr[1] = clamp(m.tr[1] + 5, 0, 100);
    }
  } else m.goodTicks = 0;
}

// Called on a timer and on app start: applies ticks for elapsed time.
export function runTicks() {
  const b = buddy();
  const elapsed = now() - state.lastTick;
  let n = Math.floor(elapsed / TICK_MS);
  if (n <= 0) return 0;
  n = Math.min(n, OFFLINE_CAP_TICKS);
  state.lastTick += n * TICK_MS;
  if (state.lastTick < now() - TICK_MS) state.lastTick = now();
  // eggs keep warming slowly with time (100 m per hour) so home players still hatch
  addEggDistance(n * 100 / 12, true);
  if (b) {
    // more than 2 ticks missed = app was closed: rest mode for those
    for (let i = 0; i < n; i++) tick(b, n > 2 && i < n - 1);
  }
  emit();
  return n;
}

// ---------------------------------------------------------------- evolution
export function evoTargets(m) {
  const s = byId(m.id);
  if (!s.to) return [];
  const lv = monLevel(m.xp);
  return s.to.filter(t => {
    const ts = byId(t);
    const need = (ts.evoLv || 25) + m.mistakes;
    return lv >= need && (!ts.friend || m.bond >= 60);
  });
}

export function canEvolve(m) {
  if (m.sleeping) return false;
  if (Math.min(m.food, m.joy, m.energy, m.hygiene) < 40) return false;
  return evoTargets(m).length > 0 && monLevel(m.xp) > m.evoDeclinedLv;
}

export function nextEvoHint(m) {
  const s = byId(m.id);
  if (!s.to) return null;
  const opts = s.to.map(t => byId(t));
  const lv = Math.min(...opts.map(o => (o.evoLv || 25) + m.mistakes));
  return { lv, friend: opts.every(o => o.friend) };
}

export function evolve(m) {
  const targets = evoTargets(m);
  if (!targets.length) return null;
  // branch toward a form you haven't caught yet (like TamaPoke's Eevee rule)
  const missing = targets.filter(t => !state.dex.caught[t]);
  const pool = missing.length ? missing : targets;
  const to = pool[Math.floor(Math.random() * pool.length)];
  const from = m.id;
  m.id = to;
  registerCaught(to, m.shiny);
  addTrainerXp(500);
  log(`${byId(from).name} evolved into ${byId(to).name}!`);
  emit();
  return { from, to };
}

// ---------------------------------------------------------------- eggs
const EGG_TIERS = { 2: 'common', 5: 'uncommon', 10: 'rare' };

export function rollEgg() {
  const tlv = trainerLevel(state.trainer.xp);
  const r = Math.random();
  const km = r < 0.5 ? 2 : r < 0.85 ? 5 : 10;
  // eggs contain base forms only (and babies), never legendaries
  const pool = DEX.filter(s => !s.from && !isLegend(s)).filter(s => {
    if (km === 2) return s.capture >= 120;
    if (km === 5) return s.capture >= 45 && s.capture < 120;
    return s.capture < 45 || s.rarity === 'baby';
  });
  const pick = weightedPick(pool, s => {
    let w = 1;
    // favour families you haven't finished, like TamaPoke
    if (family(s.id).some(f => !state.dex.caught[f])) w *= 3;
    if (s.gen > 1 + Math.floor(tlv / 3)) w *= 0.5; // older regions first, newer unlock with level
    return w;
  });
  const shinyOdds = Math.max(8, 48 - Math.floor(state.trainer.streak / 2));
  return { uid: uid(), id: pick.id, shiny: Math.random() < 1 / shinyOdds, km, walked: 0, got: now(), tier: EGG_TIERS[km] };
}

export function giveEgg() {
  if (state.eggs.length >= MAX_EGGS) return null;
  const egg = rollEgg();
  state.eggs.push(egg);
  return egg;
}

export function addEggDistance(m, passive = false) {
  for (const e of state.eggs) e.walked = Math.min(e.km * 1000, e.walked + m);
  if (!passive) {
    const b = buddy();
    if (b) {
      b.xp += Math.floor(m / 10);
      if (!b.sleeping) b.joy = clamp(b.joy + m / 100, 0, 100);
    }
  }
}

export const eggReady = e => e.walked >= e.km * 1000;

export function hatchEgg(eu) {
  const e = state.eggs.find(x => x.uid === eu);
  if (!e || !eggReady(e)) return null;
  state.eggs = state.eggs.filter(x => x !== e);
  const mon = makeMon(e.id, { shiny: e.shiny, level: 1, origin: 'egg' });
  mon.bond = 20; // hatchlings imprint on you
  const isNew = addMon(mon);
  state.trainer.hatched++;
  addTrainerXp(500);
  log(`Hatched ${e.shiny ? 'a shiny ' : ''}${byId(e.id).name}!`);
  emit();
  return { mon, isNew };
}

// ---------------------------------------------------------------- walking
export function addWalk(meters) {
  state.trainer.meters += meters;
  addEggDistance(meters);
  emit('walk', meters);
}

// ---------------------------------------------------------------- catching
export function wildLevel(id) {
  const tlv = trainerLevel(state.trainer.xp);
  const s = byId(id);
  const min = s.from ? (s.evoLv || 20) : 1;
  const max = Math.max(min + 2, Math.min(60, 8 + tlv * 2) + stage(id) * 10);
  return min + Math.floor(Math.random() * (max - min + 1));
}

const BALL_MULT = { poke: 1, great: 1.5, ultra: 2 };

export function catchChance(id, ball, ring, berry) {
  const s = byId(id);
  const base = s.capture / 255;
  let p = 1 - (1 - base) ** (BALL_MULT[ball] * ring * (berry ? 1.5 : 1) * 1.6);
  if (isLegend(s)) p *= 0.6;
  return clamp(p + 0.04, 0.02, 0.97);
}

export function catchMon(spawn, where) {
  const mon = makeMon(spawn.id, { shiny: spawn.shiny, level: spawn.level || wildLevel(spawn.id), origin: 'wild', where });
  const isNew = addMon(mon);
  state.trainer.caught++;
  if (spawn.key) state.caughtSpawns[spawn.key] = now();
  addTrainerXp(100);
  if (Math.random() < 0.1) state.bag.rareCandy++;
  log(`Caught ${spawn.shiny ? 'a shiny ' : ''}${byId(spawn.id).name}!`);
  emit();
  return { mon, isNew };
}

// prune old spawn/stop bookkeeping so the save doesn't grow forever
export function prune() {
  const cutoff = now() - 2 * 3600 * 1000;
  for (const k of Object.keys(state.caughtSpawns)) if (state.caughtSpawns[k] < cutoff) delete state.caughtSpawns[k];
  for (const k of Object.keys(state.spun)) if (state.spun[k] < cutoff) delete state.spun[k];
}
