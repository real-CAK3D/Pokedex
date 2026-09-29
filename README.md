# Pokédex

A real-life Pokédex for your phone. Open it and you're holding a Kanto-style
Pokédex. Walk around to find and catch Pokémon on a real map. Every Pokémon
you catch or hatch goes into the Pokédex, and you can raise it
TamaPoke-style inside the Pokédex screen.

**All 1025 Pokémon** (Gen 1–9) are in the Pokédex and can appear in the wild.

## Controls

- **4-bar speaker grille** (bottom-right of the screen), the screen title, or **START**: opens the mode menu.
- **Blue lens** (or **SELECT**): opens the **AR camera**.
- **D-pad / A / B**: navigate, confirm, back. In the GAME tab they are the Game Boy's controls, and the black pills are SELECT/START.
- Keyboard: arrows, Z = A, X = B, Enter = START, Shift = SELECT, M = menu, 1–7 = modes.
- LEDs: red = buddy needs care, yellow = egg ready, green = GPS locked.

## Modes

| Mode | What it does |
|---|---|
| **CAMERA** | AR scanner. The live rear camera fills the screen, and nearby Pokémon are drawn at their real compass bearing, so turning the phone pans them into view. Tap one (or aim and press A) to catch it over the camera. With no camera or compass, it uses a drawn scene you can drag to look around. Encounters also have an 📷 AR toggle. |
| **GAME** | Play your own ROMs (GB/GBC/GBA/DS, .zip OK) inside the Pokédex, via [EmulatorJS](https://emulatorjs.org). ROMs and saves stay on the device (IndexedDB) and are never uploaded. See the two-way link below. |
| **PET** | Your buddy lives here (TamaPoke care sim). Feed, play, train, clean, put to sleep, pet it, and evolve it. Food / Joy / Energy / Hygiene drain over time; poops happen. |
| **DEX** | National Pokédex: search by name or number, filter caught/missing/region, open an entry for stats, flavour text and the evolution chain. ◀ ▶ steps through entries (like pokedexsam). |
| **MAP** | Real map around you. Pokémon spawn in the world, stops (◆) give balls, berries and eggs. Walk within 80 m to catch. |
| **BOX** | Every Pokémon you own, plus eggs. Pick any one as your buddy to raise it on the PET screen. Transfer extras for Rare Candy. |
| **BAG** | Items, trainer card, settings, save export/import, journal. |

## The ROM ↔ Pokédex two-way link (Red/Blue/Yellow/Gold/Silver/Crystal, English)

1. **Game → Pokédex:** every in-game save (auto-checked every 10 s) is read. Its Pokédex marks merge into this Pokédex,
   and your **party comes over as Pokémon you can raise** on the PET screen.
2. **Pokédex → Game:** care you give a linked Pokémon (feeding, playing, walking…) becomes in-game **EXP**
   (Gen 2 also gets **happiness** from bond). It's written into the save the next time you launch the game.
   Each hand-off fills EXP to one point short of the next level. The game then levels the Pokémon up itself in its
   next battle (real stats, moves, evolution), and leftover care waits for the next launch.
3. Linked Pokémon evolve **in their game**, not in the Pokédex, so the two never disagree.

Every read is gated on the game's own save checksum, and every write recomputes it. A save it doesn't understand is left alone.
Tested with a real Pokémon Yellow save. Gen 2 uses the same code path but hasn't been tested with a real Gold/Silver save yet.

**Gen1Recomp / other emulators / cartridge dumps:** export the `.sav` and use **GAME → Import a .sav file** to sync it.
([Gen1Recomp](https://github.com/bryanthaboi/gen1recomp) is a native app for PC, Android and iOS, so it can't run inside this web page,
but its save converter writes standard Red/Blue saves.)

No ROMs are included or hosted here. Load files you own.

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

## Android app

The same code is packaged as a native Android app with [Capacitor](https://capacitorjs.com) (`android/`).
It bundles everything offline and uses native GPS and camera permissions.

```bash
npm install
npm run apk        # copies the web app to www/, syncs, builds android/app/build/outputs/apk/debug/app-debug.apk
```

The build needs `JAVA_HOME` (JDK 21) and `ANDROID_HOME` (SDK with platform 36), plus `android/local.properties` pointing at the SDK.
On this project's build PC these live in `G:\Android`.

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
Data and sprites: [PokeAPI](https://pokeapi.co). Gen 1 save layout and species order: [pret/pokered](https://github.com/pret/pokered).
Emulation: [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS). Map: © OpenStreetMap contributors, [Leaflet](https://leafletjs.com).
Inspired by [pokedexsam](https://github.com/samuelaraujoc/pokedexsam) (web Pokédex) and
[TamaPoke](https://github.com/socquique/TamaPoke) (the care/evolution rules are ported from its game design).
