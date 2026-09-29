// Reads Game Boy Pokémon save RAM (Red/Blue/Yellow and Gold/Silver/Crystal,
// international versions) so what you catch in the real games syncs into
// this Pokédex. Offsets follow the pret disassemblies; every read is gated
// on the game's own checksum, so a save we don't understand is rejected
// instead of being misread.

// Gen 1 internal species index (1-based) -> national dex number (pokered dex_order.asm)
const G1_INDEX = [112,115,32,35,21,100,34,80,2,103,108,102,88,94,29,31,104,111,131,59,151,130,90,72,92,123,120,9,127,114,0,0,58,95,22,16,79,64,75,113,67,122,106,107,24,47,54,96,76,0,126,0,125,82,109,0,56,86,50,128,0,0,0,83,48,149,0,0,0,84,60,124,146,144,145,132,52,98,0,0,0,37,38,25,26,0,0,147,148,140,141,116,117,0,0,27,28,138,139,39,40,133,136,135,134,66,41,23,46,61,62,13,14,15,0,85,57,51,49,87,0,0,10,11,12,68,0,55,97,42,150,143,129,0,0,89,0,99,91,0,101,36,110,53,105,0,93,63,65,17,18,121,1,3,73,0,118,119,0,0,0,0,77,78,19,20,33,30,74,137,142,0,81,0,0,4,7,5,8,6,0,0,0,0,43,44,45,69,70,71];

const LAYOUTS = {
  gen1: {
    gen: 1, dexSize: 151, owned: 0x25a3, seen: 0x25b6, party: 0x2f2c, structSize: 44, levelOff: 0x21,
    trainer: 0x2598, checksum: s => s[0x3523] === ((~sum(s, 0x2598, 0x3522)) & 0xff),
  },
  gs: {
    gen: 2, dexSize: 251, owned: 0x2a4c, seen: 0x2a6c, party: 0x288a, structSize: 48, levelOff: 0x1f,
    trainer: 0x200b, checksum: s => (s[0x2d69] | (s[0x2d6a] << 8)) === (sum(s, 0x2009, 0x2d68) & 0xffff),
  },
  crystal: {
    gen: 2, dexSize: 251, owned: 0x2a27, seen: 0x2a47, party: 0x2865, structSize: 48, levelOff: 0x1f,
    trainer: 0x200b, checksum: s => (s[0x2d0d] | (s[0x2d0e] << 8)) === (sum(s, 0x2009, 0x2b82) & 0xffff),
  },
};

function sum(s, a, b) {
  let t = 0;
  for (let i = a; i <= b; i++) t += s[i];
  return t;
}

// Game Boy text: 0x80-0x99 A-Z, 0xA0-0xB9 a-z, 0xF6-0xFF 0-9, 0x50 = end
function gbText(s, off, max = 11) {
  let out = '';
  for (let i = 0; i < max; i++) {
    const c = s[off + i];
    if (c === 0x50 || c === 0x00) break;
    if (c >= 0x80 && c <= 0x99) out += String.fromCharCode(65 + c - 0x80);
    else if (c >= 0xa0 && c <= 0xb9) out += String.fromCharCode(97 + c - 0xa0);
    else if (c >= 0xf6) out += String(c - 0xf6);
    else if (c === 0x7f) out += ' ';
    else if (c === 0xe3) out += '-';
    else if (c === 0xe8) out += '.';
    else if (c === 0xef) out += '♂';
    else if (c === 0xf5) out += '♀';
  }
  return out;
}

function bits(s, off, count) {
  const ids = [];
  for (let i = 0; i < count; i++) if (s[off + (i >> 3)] & (1 << (i & 7))) ids.push(i + 1);
  return ids;
}

// Gen 2 shininess from DVs: DEF/SPE/SPC = 10 and ATK in a specific set
function g2Shiny(dv0, dv1) {
  const atk = dv0 >> 4, def = dv0 & 15, spe = dv1 >> 4, spc = dv1 & 15;
  return def === 10 && spe === 10 && spc === 10 && [2, 3, 6, 7, 10, 11, 14, 15].includes(atk);
}

// EXP for level n in each Gen 1/2 growth group (PokeAPI growth_rate ids)
export function expForLevel(group, n) {
  if (n <= 1) return 0;
  switch (group) {
    case 1: return Math.floor((5 * n ** 3) / 4);            // slow
    case 3: return Math.floor((4 * n ** 3) / 5);            // fast
    case 4: return Math.floor((6 * n ** 3) / 5 - 15 * n ** 2 + 100 * n - 140); // medium-slow
    default: return n ** 3;                                  // medium
  }
}

function writeChecksum(s, layout) {
  if (layout === 'gen1') s[0x3523] = (~sum(s, 0x2598, 0x3522)) & 0xff;
  else {
    const [a, b, at] = layout === 'gs' ? [0x2009, 0x2d68, 0x2d69] : [0x2009, 0x2b82, 0x2d0d];
    const c = sum(s, a, b) & 0xffff;
    s[at] = c & 0xff;
    s[at + 1] = c >> 8;
  }
}

// Two-way link: write care done in the Pokédex back into the cartridge save.
// `care(key, id)` returns { exp, happiness } for a party Pokémon (or null).
// Only EXP (and Gen 2 happiness) are touched: the game itself then levels
// the Pokémon up, recalculating stats, learning moves and evolving, the
// next time it gains EXP in battle, exactly as if it had earned it there.
// Returns { bytes, changed: [{id, exp}] } with a fresh checksum, or null.
export function applyCare(bytes, care, growthOf) {
  const s = new Uint8Array(bytes);
  const parsed = parseSave(s);
  if (!parsed) return null;
  const L = LAYOUTS[parsed.layout];
  const structs = L.party + 8;
  const changed = [];
  const count = Math.min(6, s[L.party]);
  for (let i = 0; i < count; i++) {
    const p = structs + i * L.structSize;
    const raw = s[p];
    const id = L.gen === 1 ? G1_INDEX[raw - 1] || 0 : raw;
    const dvOff = L.gen === 1 ? 27 : 21;
    const otId = (s[p + (L.gen === 1 ? 12 : 6)] << 8) | s[p + (L.gen === 1 ? 13 : 7)];
    const c = care(`${parsed.layout}:${otId}-${s[p + dvOff]}-${s[p + dvOff + 1]}`, id);
    if (!c) continue;
    const eo = p + (L.gen === 1 ? 14 : 8);
    const cur = (s[eo] << 16) | (s[eo + 1] << 8) | s[eo + 2];
    // Fill EXP up to one point short of the next level: the Pokémon levels up
    // properly in its next battle and the in-game summary stays correct.
    // Leftover care waits for the next hand-off.
    const lvl = s[p + L.levelOff];
    const cap = lvl >= 100 ? cur : Math.max(cur, expForLevel(growthOf(id), lvl + 1) - 1);
    const next = Math.min(cur + Math.max(0, Math.floor(c.exp || 0)), cap);
    c.used = next - cur;
    let touched = false;
    if (next > cur) {
      s[eo] = (next >> 16) & 0xff;
      s[eo + 1] = (next >> 8) & 0xff;
      s[eo + 2] = next & 0xff;
      touched = true;
    }
    if (L.gen === 2 && c.happiness != null && c.happiness > s[p + 27]) {
      s[p + 27] = Math.min(255, c.happiness);
      touched = true;
    }
    if (touched) changed.push({ id, exp: next - cur });
  }
  if (!changed.length) return null;
  writeChecksum(s, parsed.layout);
  return { bytes: s, changed };
}

export function parseSave(bytes) {
  const s = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (s.length < 0x8000) return null;
  for (const [name, L] of Object.entries(LAYOUTS)) {
    if (!L.checksum(s)) continue;
    const party = [];
    const count = Math.min(6, s[L.party]);
    const structs = L.party + 8;               // count byte + 7-byte species list
    const otNames = structs + 6 * L.structSize;
    const nicks = otNames + 6 * 11;
    for (let i = 0; i < count; i++) {
      const p = structs + i * L.structSize;
      const raw = s[p];
      const id = L.gen === 1 ? G1_INDEX[raw - 1] || 0 : raw;
      if (!id || id > L.dexSize) continue;
      const otId = (s[p + (L.gen === 1 ? 12 : 6)] << 8) | s[p + (L.gen === 1 ? 13 : 7)];
      const dvOff = L.gen === 1 ? 27 : 21;
      const dv0 = s[p + dvOff], dv1 = s[p + dvOff + 1];
      party.push({
        id,
        level: s[p + L.levelOff] || 5,
        nick: gbText(s, nicks + i * 11),
        ot: gbText(s, otNames + i * 11),
        shiny: L.gen === 2 && g2Shiny(dv0, dv1),
        key: `${otId}-${dv0}-${dv1}`,
      });
    }
    return {
      layout: name,
      gen: L.gen,
      trainer: gbText(s, L.trainer, 8),
      owned: bits(s, L.owned, L.dexSize),
      seen: bits(s, L.seen, L.dexSize),
      party,
    };
  }
  return null;
}
