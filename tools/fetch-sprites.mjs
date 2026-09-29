// Downloads the static front sprites (normal + shiny) for every species into
// img/sprites/ so the Pokédex, pet and map work offline and never show a
// blank where a Pokémon should be. Usage: node tools/fetch-sprites.mjs
import { mkdir, writeFile, access } from 'node:fs/promises';

const BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const dex = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../data/pokedex.json', import.meta.url)));
const out = new URL('../img/sprites/', import.meta.url);
await mkdir(new URL('shiny/', out), { recursive: true });

const jobs = [];
for (const s of dex) {
  jobs.push([`${BASE}/${s.id}.png`, new URL(`${s.id}.png`, out)]);
  jobs.push([`${BASE}/shiny/${s.id}.png`, new URL(`shiny/${s.id}.png`, out)]);
}

let done = 0, failed = 0;
async function worker() {
  while (jobs.length) {
    const [url, file] = jobs.shift();
    try {
      await access(file);
      done++;
      continue;
    } catch { /* not downloaded yet */ }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.status);
        await writeFile(file, Buffer.from(await res.arrayBuffer()));
        done++;
        break;
      } catch (e) {
        if (attempt === 2) { failed++; console.warn('failed', url, e.message); }
      }
    }
  }
}
await Promise.all(Array.from({ length: 16 }, worker));
console.log(`sprites: ${done} ok, ${failed} failed`);
