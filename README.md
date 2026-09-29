# Pokédex

A real-life Pokédex for your phone. Open it and you're holding a Kanto-style
Pokédex. Walk around to find and catch Pokémon on a real map. Every Pokémon
you catch or hatch goes into the Pokédex, and you can raise it
TamaPoke-style inside the Pokédex screen.

**All 1025 Pokémon** (Gen 1–9) are in the Pokédex and can appear in the wild.

## Screens (tabs under the screen)

| Tab | What it does |
|---|---|
| **PET** | Your buddy lives here (TamaPoke care sim). Feed, play, train, clean, put to sleep, pet it, and evolve it. Food / Joy / Energy / Hygiene drain over time; poops happen. |
| **DEX** | National Pokédex: search by name or number, filter caught/missing/region, open an entry for stats, flavour text and the evolution chain. ◀ ▶ steps through entries (like pokedexsam). |
| **MAP** | Real map around you. Pokémon spawn in the world, stops (◆) give balls, berries and eggs. Walk within 80 m to catch. |
| **BOX** | Every Pokémon you own, plus eggs. Pick any one as your buddy to raise it on the PET screen. Transfer extras for Rare Candy. |
| **BAG** | Items, trainer card, settings, save export/import, journal. |

The D-pad and A/B buttons work on every screen (keyboard: arrows, Enter/Z = A, Esc/X = B, 1–5 = tabs).
The blue lens jumps to the map and pulses when a Pokémon comes into range. The LEDs show:
red = buddy needs care, yellow = egg ready, green = GPS locked.

## How it all connects

One save holds everything, so a Pokémon is the same Pokémon on every screen:

- **Catch** on the MAP → registered in the **DEX** → stored in the **BOX** → can become your **PET** buddy.
- **Raise** it on PET → it levels up (time, care, walking) → **evolves** → the new form is registered in the DEX.
- **Eggs** from stops **hatch by walking** (2 / 5 / 10 km, plus a slow warm-up over time) → new Pokémon → DEX + BOX.
- **Walking** (real GPS, walking speed only) hatches eggs and gives your buddy XP and joy.

## Game rules (quick reference)

- Care tick every 5 min. Letting a stat hit ≤10 is a slip-up: evolution is delayed 1 level and bond drops.
- When the app is closed, your buddy rests (slow drain, no slip-ups) for up to 2 weeks.
- Evolution: species level (from PokeAPI) + slip-ups, all stats ≥ 40, friendship evolutions need bond ≥ 60.
  Stone/trade evolutions become Lv 30 / Lv 40. Branching species (Eevee…) favour forms you haven't caught.
- Each species has a hidden favourite berry (red/blue/green).
- Wild spawns rotate every 15 min, are deterministic per ~130 m cell, and depend on the **biome**
  (Meadow, Lakeside, Volcanic, Urban, Forest, Mountain, Mystic) and **day/night** (ghost/dark/psychic boost at night).
- Legendaries appear from trainer level 10, mythicals from 20. Wild shiny odds 1/200. Egg shiny odds improve with your care streak.
- Catching: flick the ball up (or press A). A smaller ring means a better chance. Razz Berry = ×1.5. Great/Ultra Balls = ×1.5 / ×2.

**Desk mode** (BAG → Settings) lets you tap the map to move, for testing at a computer. Walking distance never counts in desk mode.

## Running it

It's a static site (no build step). GPS needs HTTPS, so on a phone use GitHub Pages (or any HTTPS host):

```bash
npx http-server -p 8321      # local testing at http://localhost:8321
```

On your phone, open the site and use **Add to Home Screen**. It runs full-screen, like a real device, and works offline for anything you've already loaded.

## Regenerating data

```bash
node tools/build-dex.mjs     # pulls all species from PokeAPI → data/pokedex.json
node tools/make-icons.mjs    # app icons
```

## About Pokémon GO

This project does **not** connect to Niantic's servers (PokemonGo-Bot / PokemonGo-Map did that, which breaks
Niantic's ToS and gets accounts banned). Instead it recreates the same idea as its own game: GPS spawns, stops, eggs,
and a buddy you walk with. You can run it alongside Pokémon GO on your walks.

## Credits

Fan-made, non-commercial. Pokémon © Nintendo / Game Freak / Creatures.
Data and sprites: [PokeAPI](https://pokeapi.co). Map: © OpenStreetMap contributors, [Leaflet](https://leafletjs.com).
Inspired by [pokedexsam](https://github.com/samuelaraujoc/pokedexsam) (web Pokédex) and
[TamaPoke](https://github.com/socquique/TamaPoke) (the care/evolution rules are ported from its game design).
