// First run: choose a starter from any region (TamaPoke lets you pick one of
// the Kanto three; here every generation's starters are on offer).
import { h, monImg } from '../util.js';
import { byId, STARTERS, REGIONS } from '../data.js';
import * as st from '../store.js';
import { ticker, confirm } from '../ui.js';

export default function starterView(app) {
  let region = 0, focus = 0, grid;

  function mount(el) {
    grid = h('div.starter-grid');
    const sel = h('select.input', { onchange: e => { region = +e.target.value; focus = 0; paint(); } },
      REGIONS.map((r, i) => h('option', { value: i }, r)));
    el.append(h('div.starter',
      h('div.pad.col',
        h('h2', 'Welcome to the world of Pokémon!'),
        h('div.small', 'Choose your first partner. You\'ll raise it here, then head out on the MAP to catch more. Everything you catch can be raised the same way.'),
        sel),
      h('div.scroll', grid)));
    paint();
  }

  function paint() {
    grid.replaceChildren(...STARTERS[region].map((id, i) => h('button' + (i === focus ? '.focus' : ''), { onclick: () => pick(id) },
      monImg(id), byId(id).name)));
    ticker(`Pick a ${REGIONS[region]} starter!`);
  }

  async function pick(id) {
    if (!(await confirm(`Choose ${byId(id).name} as your partner?`, 'I choose you!'))) return;
    const mon = st.makeMon(id, { level: 5, origin: 'starter' });
    mon.bond = 20;
    st.addMon(mon);
    st.S().buddy = mon.uid;
    st.giveEgg();
    st.log(`Chose ${byId(id).name} as a partner. Received an egg!`);
    st.emit();
    if (app.pendingRom) {
      const link = app.pendingRom;
      app.pendingRom = null;
      app.go('game', link);
    } else app.go('pet');
  }

  function key(k) {
    if (k === 'left') { focus = (focus + 2) % 3; paint(); }
    else if (k === 'right') { focus = (focus + 1) % 3; paint(); }
    else if (k === 'up') { region = (region + REGIONS.length - 1) % REGIONS.length; document.querySelector('.starter select').value = region; paint(); }
    else if (k === 'down') { region = (region + 1) % REGIONS.length; document.querySelector('.starter select').value = region; paint(); }
    else if (k === 'a') pick(STARTERS[region][focus]);
    return true;
  }

  return { title: 'NEW GAME', mount, key, refresh() {}, unmount() {} };
}
