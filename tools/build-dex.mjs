// Builds data/pokedex.json from PokeAPI's GraphQL endpoint (all species).
// Usage: node tools/build-dex.mjs
import { writeFile, mkdir } from 'node:fs/promises';

const ENDPOINT = 'https://beta.pokeapi.co/graphql/v1beta';
const QUERY = `{
  pokemon_v2_pokemonspecies(order_by:{id:asc}) {
    id name capture_rate is_legendary is_mythical is_baby generation_id
    evolves_from_species_id hatch_counter
    pokemon_v2_pokemonevolutions { min_level evolution_trigger_id evolution_item_id min_happiness }
    pokemon_v2_pokemons(where:{is_default:{_eq:true}}) {
      height weight
      pokemon_v2_pokemontypes(order_by:{slot:asc}) { pokemon_v2_type { name } }
      pokemon_v2_pokemonstats { base_stat }
    }
    pokemon_v2_pokemonspeciesflavortexts(where:{language_id:{_eq:9}}, limit:1, order_by:{version_id:desc}) { flavor_text }
    pokemon_v2_pokemonspeciesnames(where:{language_id:{_eq:9}}) { name genus }
  }
}`;

// Level at which a species evolves INTO this one. Non-level triggers get a
// level stand-in so everything is reachable by raising your Pokémon.
function evoLevel(evos) {
  if (!evos.length) return null;
  const e = evos.find(x => x.min_level) || evos[0];
  if (e.min_level) return e.min_level;
  if (e.min_happiness) return 20;            // friendship -> needs bond too
  if (e.evolution_trigger_id === 2) return 40; // trade
  if (e.evolution_item_id) return 30;          // stone / item
  return 25;
}

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: QUERY }),
});
const { data, errors } = await res.json();
if (errors) throw new Error(JSON.stringify(errors));

const out = data.pokemon_v2_pokemonspecies.map(s => {
  const p = s.pokemon_v2_pokemons[0] || {};
  const nm = s.pokemon_v2_pokemonspeciesnames[0] || {};
  const evos = s.pokemon_v2_pokemonevolutions;
  return {
    id: s.id,
    name: nm.name || s.name,
    types: (p.pokemon_v2_pokemontypes || []).map(t => t.pokemon_v2_type.name),
    stats: (p.pokemon_v2_pokemonstats || []).map(t => t.base_stat), // hp atk def spa spd spe
    capture: s.capture_rate,
    rarity: s.is_mythical ? 'mythical' : s.is_legendary ? 'legendary' : s.is_baby ? 'baby' : undefined,
    gen: s.generation_id,
    from: s.evolves_from_species_id || undefined,
    evoLv: evoLevel(evos) || undefined,
    friend: evos.some(e => e.min_happiness) || undefined,
    genus: nm.genus,
    text: (s.pokemon_v2_pokemonspeciesflavortexts[0]?.flavor_text || '').replace(/[\n\f­]+/g, ' '),
    h: p.height, w: p.weight,
    hatch: s.hatch_counter,
  };
});

// forward links: which species this one evolves into
const byId = new Map(out.map(s => [s.id, s]));
for (const s of out) if (s.from) (byId.get(s.from).to ||= []).push(s.id);

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/pokedex.json', import.meta.url), JSON.stringify(out));
console.log(`wrote ${out.length} species`);
