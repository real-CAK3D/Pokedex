// National Pokédex data (built by tools/build-dex.mjs from PokeAPI).

export let DEX = [];            // index 0 = #1
export const byId = id => DEX[id - 1];

export async function loadDex() {
  const res = await fetch('data/pokedex.json');
  DEX = await res.json();
  return DEX;
}

export const TOTAL = () => DEX.length;

export function baseForm(id) {
  let s = byId(id);
  while (s?.from) s = byId(s.from);
  return s?.id ?? id;
}

// Every species in the family of `id`, in evolution order (breadth-first).
export function family(id) {
  const out = [];
  const queue = [baseForm(id)];
  while (queue.length) {
    const cur = queue.shift();
    out.push(cur);
    queue.push(...(byId(cur)?.to || []));
  }
  return out;
}

export function stage(id) {
  let n = 0, s = byId(id);
  while (s?.from) { n++; s = byId(s.from); }
  return n;
}

export const isLegend = s => s.rarity === 'legendary' || s.rarity === 'mythical';

// Starters from each generation (grass, fire, water).
export const STARTERS = [
  [1, 4, 7], [152, 155, 158], [252, 255, 258], [387, 390, 393], [495, 498, 501],
  [650, 653, 656], [722, 725, 728], [810, 813, 816], [906, 909, 912],
];
export const REGIONS = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova', 'Kalos', 'Alola', 'Galar', 'Paldea'];

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
export const statNames = ['HP', 'ATK', 'DEF', 'SpA', 'SpD', 'SPE'];
export { cap };
