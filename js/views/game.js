// GAME: play your own Pokémon ROMs inside the Pokédex screen. The device's
// D-pad and A/B buttons are the controller. ROMs and saves stay on this
// device (IndexedDB). Game Boy saves auto-sync into the Pokédex.
import { h } from '../util.js';
import * as st from '../store.js';
import { SYSTEMS, systemFor, listRoms, getRom, addRom, deleteRom, unzipRom, getSave, putSave } from '../gamedb.js';
import { parseSave, applyCare } from '../cart.js';
import { byId } from '../data.js';
import { toast, ticker, confirm, flashLed } from '../ui.js';

// RetroArch joypad ids
const PAD = { b: 0, select: 2, start: 3, up: 4, down: 5, left: 6, right: 7, a: 8, l: 10, r: 11 };
const ICON = { gb: '🟩', gbc: '🟪', gba: '🟦', nds: '⬛', n64: '🕹️' };

export default function gameView(app) {
  let root, roms = [], focus = 0, playing = null, frame = null, onMsg = null;

  function mount(el, params) {
    root = h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: 0 } });
    el.append(root);
    if (params?.shelf) setShelf(params.shelf);
    library();
    if (params?.addrom) installFromUrl(params.addrom);
  }

  // ---- PC shelf: a folder of your own ROMs shared from your PC (e.g. over
  // Tailscale, tailnet-only) with an index.json. The phone lists them and
  // downloads whichever you tap straight into this device's library.
  const SHELF_KEY = 'pokedex-rom-shelf';
  const getShelf = () => { try { return localStorage.getItem(SHELF_KEY); } catch { return null; } };
  function setShelf(url) {
    try {
      const u = new URL(url);
      if (!u.pathname.endsWith('/')) u.pathname += '/';
      localStorage.setItem(SHELF_KEY, u.href);
    } catch { toast('Bad shelf link'); }
  }

  async function download(url, name, onProgress) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = +res.headers.get('content-length') || 0;
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      onProgress?.(total ? got / total : 0);
    }
    return new File(parts, name);
  }

  async function installFromUrl(url) {
    let u;
    try { u = new URL(url); } catch { toast('Bad ROM link'); return; }
    const name = decodeURIComponent(u.pathname.split('/').pop() || 'game');
    if (!(await confirm(`Install “${name}” from ${u.host}? It's saved on this device only.`, 'Install'))) return;
    try {
      const f = await download(u, name, p => ticker(`Downloading ${Math.round(p * 100)}%`));
      await addFiles([f]);
    } catch (e) {
      toast(`Download failed (${e.message}).`, 6000);
    }
  }

  async function renderShelf(box, installed) {
    const base = getShelf();
    if (!base) return;
    box.replaceChildren(h('div.tiny.muted', 'Connecting to your PC…'));
    let list;
    try {
      const res = await fetch(base + 'index.json', { mode: 'cors', cache: 'no-store' });
      list = await res.json();
    } catch {
      box.replaceChildren(h('div.tiny.muted', `Can't reach ${new URL(base).host}. Is the PC on and Tailscale connected on both devices?`),
        h('button.btn.alt.sm', { onclick: () => renderShelf(box, installed) }, '↻ Retry'));
      return;
    }
    const rows = list.map(g => {
      const have = installed.has(g.name);
      const btn = h('button.btn.sm' + (have ? '.alt' : '.go'), { disabled: have || null }, have ? '✓' : '⬇');
      const sub = h('div.tiny.muted', `${SYSTEMS[g.system] || g.system} · ${(g.size / 1048576).toFixed(g.size > 1e7 ? 0 : 1)} MB`);
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          const f = await download(base + encodeURIComponent(g.file), g.file, p => (sub.textContent = `Downloading… ${Math.round(p * 100)}%`));
          await addRom(f, g.system);
          toast(`Installed ${g.name}`);
          library();
        } catch (e) {
          sub.textContent = `Failed: ${e.message}`;
          btn.disabled = false;
        }
      };
      return h('div.item-row', h('span.ico', ICON[g.system] || '🎮'), h('div.grow', h('b.small', g.name), sub), btn);
    });
    const missingSmall = list.filter(g => !installed.has(g.name) && g.size < 8e6);
    box.replaceChildren(
      h('div.tiny.muted', `From ${new URL(base).host}. Downloads go straight into this device's library.`),
      missingSmall.length > 1 ? h('button.btn.go.sm', { onclick: async e => {
        e.currentTarget.disabled = true;
        for (const g of missingSmall) {
          ticker(`Installing ${g.name}…`);
          try { await addRom(await download(base + encodeURIComponent(g.file), g.file), g.system); } catch (err) { toast(`${g.name}: ${err.message}`); }
        }
        toast('Game Boy games installed!');
        library();
      } }, `⬇ Install all ${missingSmall.length} Game Boy games`) : null,
      h('div.col', rows),
    );
  }

  function unmount() {
    stop();
  }

  async function library() {
    stop();
    roms = (await listRoms()).sort((a, b) => a.name.localeCompare(b.name));
    focus = Math.min(focus, Math.max(0, roms.length - 1));
    const shelfBox = h('div.col');
    renderShelf(shelfBox, new Set(roms.map(r => r.name)));
    const input = h('input', { type: 'file', accept: '.gb,.gbc,.gba,.nds,.z64,.n64,.v64,.zip', multiple: true, style: { display: 'none' }, onchange: e => addFiles([...e.target.files]) });
    const savInput = h('input', { type: 'file', accept: '.sav,.srm,.dat', style: { display: 'none' }, onchange: e => importSav(e.target.files[0]) });
    root.replaceChildren(h('div.scroll', h('div.pad.col',
      h('div.row', h('h2.grow', 'Game Library'), h('button.btn.go.sm', { onclick: () => input.click() }, '＋ Add game'), input),
      h('div.tiny.muted', 'Load your own ROM files (.gb .gbc .gba .nds or .zip). They are stored on this device only and never uploaded. The Pokédex buttons are the controller.'),
      roms.length ? null : h('div.card.small', 'No games yet. Tap “Add game” and pick a ROM from your phone’s files.'),
      h('div.col', roms.map((r, i) => h('div.item-row' + (i === focus ? '.focus' : ''),
        h('span.ico', ICON[r.system] || '🎮'),
        h('button.grow', { style: { textAlign: 'left' }, onclick: () => play(r.id) },
          h('b.small', r.name), h('div.tiny.muted', `${SYSTEMS[r.system]} · ${(r.size / 1048576).toFixed(1)} MB`)),
        h('button.btn.sm.go', { onclick: () => play(r.id) }, '▶'),
        h('button.btn.sm.alt', { onclick: () => remove(r) }, '🗑')))),
      getShelf() ? [h('h3', '📡 PC shelf'), shelfBox] : null,
      h('h3', 'Pokédex link'),
      h('div.tiny.muted', 'Red, Blue, Yellow, Gold, Silver and Crystal (English / international carts) sync automatically each time you save in-game: your in-game Pokédex marks and your party come over here, ready to raise as buddies. DS games play but don’t sync.'),
      h('button.btn.alt.sm', { onclick: () => savInput.click() }, '📥 Import a .sav file'),
      h('div.tiny.muted', 'Playing somewhere else, like Gen1Recomp, another emulator or a real cartridge dump? Export its .sav and import it here to sync.'),
      savInput,
    )));
    ticker(`GAMES: ${roms.length} installed`);
  }

  async function addFiles(files) {
    for (let f of files) {
      try {
        if (f.name.toLowerCase().endsWith('.zip')) {
          ticker('Unzipping…');
          const inner = await unzipRom(f);
          if (!inner) { toast(`${f.name}: no ROM inside`); continue; }
          f = inner;
        }
        const sys = systemFor(f.name);
        if (!sys) { toast(`${f.name}: unsupported file`); continue; }
        await addRom(f, sys);
        toast(`Added ${f.name}`);
      } catch (e) {
        toast(`Couldn't add ${f.name}: ${e.message}`);
      }
    }
    library();
  }

  async function importSav(file) {
    if (!file) return;
    const parsed = parseSave(new Uint8Array(await file.arrayBuffer()));
    if (!parsed) {
      toast('Not a recognised Red/Blue/Yellow/Gold/Silver/Crystal save (English versions only).');
      return;
    }
    const name = parsed.gen === 1 ? 'Gen 1 save' : 'Gen 2 save';
    const r = st.syncCartridge(parsed, name);
    flashLed();
    toast(`◓ Synced ${parsed.trainer || name}: +${r.newCaught} Pokédex, +${r.newSeen} seen, +${r.newMons} Pokémon`, 4000);
  }

  async function remove(r) {
    if (!(await confirm(`Remove ${r.name} and its save from this device?`, 'Remove', true))) return;
    await deleteRom(r.id);
    library();
  }

  async function play(id) {
    const rom = await getRom(id);
    if (!rom) return;
    playing = rom;
    let save = await getSave(id);
    // hand the care you gave in the Pokédex back to the game's own Pokémon
    if (save && isCart(rom)) {
      const patched = applyCare(save, st.careFor, sid => byId(sid)?.g);
      if (patched) await putSave(id, (save = patched.bytes));
      st.commitCare();
      if (patched) {
        flashLed();
        toast('💝 Your care paid off: ' + patched.changed.map(c => `${byId(c.id).name} +${c.exp.toLocaleString()} EXP`).join(', '), 5000);
      }
    }
    const aspect = { gb: '10 / 9', gbc: '10 / 9', gba: '3 / 2', nds: '2 / 3', n64: '4 / 3' }[rom.system];
    frame = h('iframe', { src: 'games/player.html', title: rom.name, allow: 'autoplay; fullscreen; gamepad', style: { aspectRatio: aspect, maxWidth: '100%', maxHeight: '100%', width: rom.system === 'nds' ? 'auto' : '100%', height: rom.system === 'nds' ? '100%' : 'auto', border: '0', background: '#000' } });
    const stage = h('div.game-stage', frame);
    const pill = (label, k) => h('button.btn.sm', {
      onpointerdown: e => { e.preventDefault(); press(k, 1); },
      onpointerup: () => press(k, 0), onpointerleave: () => press(k, 0), onpointercancel: () => press(k, 0),
    }, label);
    const bar = h('div.game-bar',
      h('button.btn.sm.alt', { onclick: () => library() }, '✕'),
      rom.system === 'gba' || rom.system === 'nds' || rom.system === 'n64' ? [pill('L', 'l'), pill('R', 'r')] : null,
      h('span.tiny', { style: { color: '#9ab', alignSelf: 'center' } }, 'Red pill = SELECT · Blue pill = START'),
      isCart(rom) ? h('button.btn.sm.gold', { onclick: () => frame?.contentWindow?.postMessage({ type: 'flush' }, location.origin) }, '◓ Sync') : null,
    );
    root.replaceChildren(stage, bar);
    onMsg = async e => {
      if (e.source !== frame?.contentWindow || e.origin !== location.origin) return;
      const m = e.data;
      if (m.type === 'ready') {
        frame.contentWindow.postMessage({
          type: 'boot', rom: new File([rom.blob], rom.blob.name || `${rom.id}.${rom.system}`),
          system: rom.system, name: rom.id, save, touch: rom.system === 'nds' || rom.system === 'n64',
        }, location.origin);
      } else if (m.type === 'started') {
        ticker(`▶ ${rom.name}`);
      } else if (m.type === 'save') {
        await putSave(rom.id, m.data);
        if (isCart(rom)) syncSave(m.data, rom);
      }
    };
    window.addEventListener('message', onMsg);
    ticker(`Loading ${rom.name}…`);
  }

  const isCart = rom => rom.system === 'gb' || rom.system === 'gbc';

  function syncSave(data, rom) {
    const parsed = parseSave(data);
    if (!parsed) return;
    const name = rom.name.replace(/\s*\(.*$/, '');
    const r = st.syncCartridge(parsed, name);
    if (r.newCaught || r.newMons) {
      flashLed();
      toast(`◓ ${name} synced: +${r.newCaught} Pokédex, +${r.newMons} Pokémon`);
    } else ticker(`◓ Synced with ${parsed.trainer || name}`, 2500);
  }

  function stop() {
    if (frame) {
      try { frame.contentWindow?.postMessage({ type: 'flush' }, location.origin); } catch { /* gone */ }
    }
    if (onMsg) {
      const handler = onMsg;
      // give the final save a moment to arrive before detaching
      setTimeout(() => window.removeEventListener('message', handler), 1500);
      onMsg = null;
    }
    frame?.remove();
    frame = null;
    playing = null;
  }

  function press(k, v) {
    if (!frame || !(k in PAD)) return;
    frame.contentWindow?.postMessage({ type: 'input', index: PAD[k], value: v }, location.origin);
  }

  // Physical Pokédex buttons: pass press AND release straight to the game.
  function raw(k, down) {
    if (!playing) return false;
    press(k, down ? 1 : 0);
    return true;
  }

  function key(k) {
    if (playing) return true;
    if (k === 'up' || k === 'down') {
      focus = Math.max(0, Math.min(roms.length - 1, focus + (k === 'up' ? -1 : 1)));
      library();
      return true;
    }
    if (k === 'a' && roms[focus]) { play(roms[focus].id); return true; }
    return false;
  }

  return { title: 'GAME', mount, unmount, key, raw, refresh() {} };
}
