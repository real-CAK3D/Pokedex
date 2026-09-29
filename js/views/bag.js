// BAG: items, trainer card, settings, save backup.
import { h, itemUrl, fmtKm } from '../util.js';
import { DEX } from '../data.js';
import * as st from '../store.js';
import { toast, ticker, confirm, prompt } from '../ui.js';
import { recenterToGps } from '../geo.js';

const ITEMS = [
  ['poke', 'Poké Ball', 'poke-ball'],
  ['great', 'Great Ball', 'great-ball'],
  ['ultra', 'Ultra Ball', 'ultra-ball'],
  ['razz', 'Razz Berry', 'razz-berry'],
  ['berryR', 'Red Berry', null, '🍒'],
  ['berryB', 'Blue Berry', null, '🫐'],
  ['berryG', 'Green Berry', null, '🍏'],
  ['poffin', 'Poffin', null, '🧁'],
  ['rareCandy', 'Rare Candy', 'rare-candy'],
];

export default function bagView(app) {
  let root;

  function mount(el) {
    root = h('div.scroll');
    el.append(root);
    render();
  }

  function render() {
    const s = st.S();
    const t = s.trainer;
    const lv = st.trainerLevel(t.xp);
    const lo = st.xpForTrainer(lv), hi = st.xpForTrainer(lv + 1);
    const toggle = (key, label, sub, after) => h('label.switch',
      h('div', label, h('div.tiny.muted', sub)),
      h('input', { type: 'checkbox', checked: s.settings[key] || null, onchange: e => { s.settings[key] = e.target.checked; after?.(); st.emit(); } }));

    root.replaceChildren(h('div.pad.col',
      h('div.card.col',
        h('div.row',
          h('div.grow', h('h2', t.name), h('div.small.muted', `Trainer level ${lv}`)),
          h('button.btn.sm.alt', { onclick: async () => {
            const n = await prompt('Trainer name', t.name);
            if (n) { t.name = n.slice(0, 12); st.emit(); render(); }
          } }, '✏️')),
        h('div.bar', h('i', { style: { width: lv >= 50 ? '100%' : ((t.xp - lo) / (hi - lo)) * 100 + '%', background: '#4aa8ff' } })),
        h('div.tiny.muted', `${t.xp.toLocaleString()} XP${lv < 50 ? ` · ${(hi - t.xp).toLocaleString()} to next` : ''}`),
        h('div.kv',
          'Pokédex caught', h('b', `${st.caughtCount()} / ${DEX.length}`),
          'Shinies', h('b', Object.keys(s.dex.shiny).length),
          'Pokémon caught', h('b', t.caught),
          'Eggs hatched', h('b', t.hatched),
          'Stops spun', h('b', t.spins),
          'Distance walked', h('b', fmtKm(t.meters)),
          'Care streak', h('b', `${t.streak} (best ${t.bestStreak})`),
        ),
        lv < 5 ? h('div.tiny.muted', 'Great Balls unlock at level 5, Ultra Balls at 12, legendaries start appearing at 10, mythicals at 20.') : null,
      ),

      h('h3', 'Items'),
      h('div.col', ITEMS.map(([k, name, img, emoji]) => h('div.item-row',
        img ? h('img', { src: itemUrl(img), alt: '' }) : h('span.ico', emoji),
        h('div.grow', name), h('span.n', `x${s.bag[k]}`)))),

      h('h3', 'Settings'),
      h('div.card',
        toggle('deskMode', 'Desk mode', 'Tap the map to move your trainer. For testing at a computer. Walking distance never counts in desk mode.', () => { if (!s.settings.deskMode) recenterToGps(); }),
        toggle('hideUncaught', 'Hide unseen Pokédex entries', 'Show ??? until you encounter a species, like a real Pokédex.'),
      ),

      h('h3', 'Save data'),
      h('div.row', { style: { flexWrap: 'wrap' } },
        h('button.btn.alt.sm', { onclick: exportFile }, '💾 Export save'),
        h('button.btn.alt.sm', { onclick: importFile }, '📂 Import save'),
        h('button.btn.danger.sm', { onclick: async () => {
          if (await confirm('Erase EVERYTHING and start over? This cannot be undone.', 'Erase', true)) {
            st.wipe();
            app.go('pet');
          }
        } }, '🗑️ Reset game')),

      h('h3', 'Journal'),
      h('div', s.log.slice(0, 25).map(l => h('div.logline', h('span.muted.tiny', new Date(l.t).toLocaleString() + ' · '), l.msg))),

      h('h3', 'About'),
      h('div.tiny.muted',
        'Fan-made, non-commercial. Pokémon and all related names and artwork are © Nintendo / Game Freak / Creatures. ',
        'Data and sprites from PokeAPI. Map © OpenStreetMap contributors. Device design inspired by pokedexsam; the care sim is inspired by TamaPoke.'),
    ));
    ticker(`${t.name} · Lv${lv} · ${fmtKm(t.meters)}`);
  }

  function exportFile() {
    const blob = new Blob([st.exportSave()], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `pokedex-save-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importFile() {
    const input = h('input', { type: 'file', accept: 'application/json,.json' });
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      try {
        st.importSave(await f.text());
        toast('Save imported!');
        render();
      } catch (e) {
        toast('Import failed: ' + e.message);
      }
    };
    input.click();
  }

  return { title: 'BAG', mount, key: () => false, refresh: kind => { if (kind === 'reset') render(); }, unmount() {} };
}
