// BOX: every Pokémon you own + your eggs. Pick a buddy to raise on the PET
// screen, hatch eggs you've walked, transfer extras for Rare Candy.
import { h, monImg, pad3, fmtKm } from '../util.js';
import { byId } from '../data.js';
import * as st from '../store.js';
import { dialog, closeDialog, confirm, prompt, toast, ticker, hatchCinematic } from '../ui.js';

const SORTS = {
  recent: (a, b) => b.got - a.got,
  level: (a, b) => b.xp - a.xp,
  number: (a, b) => a.id - b.id || b.xp - a.xp,
  name: (a, b) => st.monName(a).localeCompare(st.monName(b)),
};

export default function boxView(app) {
  let root, gridEl, sort = 'recent', focus = 0, list = [];

  function mount(el) {
    root = h('div.scroll');
    el.append(root);
    render();
  }

  function render() {
    const s = st.S();
    list = [...s.mons].sort(SORTS[sort]);
    const eggs = s.eggs.map(e => {
      const ready = st.eggReady(e);
      return h('button.egg-card', { onclick: () => eggTap(e) },
        h(`div.egg.t${e.km}${ready ? '.ready' : ''}`),
        `${e.km} km egg`,
        h('div.bar', { style: { width: '100%' } }, h('i', { style: { width: Math.min(100, (e.walked / (e.km * 1000)) * 100) + '%' } })),
        h('span.muted', ready ? 'HATCH!' : `${fmtKm(e.walked)}`));
    });
    const seg = h('div.seg', Object.keys(SORTS).map(k =>
      h('button' + (k === sort ? '.on' : ''), { onclick: () => { sort = k; render(); } }, k.toUpperCase())));
    gridEl = h('div.box-list', list.map((m, i) => h('button.box-mon' + (i === focus ? '.focus' : ''), { onclick: () => { focus = i; openMon(m); } },
      h('span.lv', `Lv${st.monLevel(m.xp)}`),
      s.buddy === m.uid ? h('span.buddy-tag', '⭐') : m.shiny ? h('span.buddy-tag', '✨') : null,
      monImg(m.id, { shiny: m.shiny, anim: false }),
      h('span.nm', st.monName(m)),
    )));
    root.replaceChildren(
      h('div.pad', { style: { paddingBottom: 0 } },
        h('h3', { style: { marginTop: 0 } }, `Eggs ${s.eggs.length}/${st.MAX_EGGS}`),
        s.eggs.length ? null : h('div.small.muted', 'No eggs. Spin stops (◆) on the map to find some. Walking hatches them.')),
      s.eggs.length ? h('div.egg-row', eggs) : null,
      h('div.pad', { style: { paddingBottom: 0 } }, h('h3', `Pokémon ${s.mons.length}`), seg),
      gridEl,
    );
    ticker(`BOX: ${s.mons.length} Pokémon, ${s.eggs.length} eggs`);
  }

  async function eggTap(e) {
    if (!st.eggReady(e)) {
      toast(`Walk ${fmtKm(e.km * 1000 - e.walked)} more to hatch. Eggs also warm up slowly over time.`);
      return;
    }
    const res = st.hatchEgg(e.uid);
    if (!res) return;
    await hatchCinematic(res.mon, res.isNew);
    render();
  }

  function openMon(m) {
    const s = byId(m.id);
    const isBuddy = st.S().buddy === m.uid;
    dialog(h('div.col',
      h('div.row', monImg(m.id, { shiny: m.shiny }),
        h('div.grow',
          h('h2', (m.shiny ? '✨ ' : '') + st.monName(m)),
          h('div.small.muted', `#${pad3(s.id)} ${s.name} · Lv ${st.monLevel(m.xp)}`),
          h('div.small', `Bond ${m.bond} · ${m.origin}${m.where ? ` @ ${m.where.lat}, ${m.where.lng}` : ''}`))),
      isBuddy ? h('div.small', '⭐ This is your current buddy.') :
        h('button.btn.go', { onclick: () => { closeDialog(); st.setBuddy(m.uid); app.go('pet'); } }, '⭐ Make buddy (raise on PET screen)'),
      h('button.btn.alt', { onclick: () => { closeDialog(); app.go('dex', { id: m.id }); } }, '📖 Pokédex entry'),
      h('button.btn.alt', { onclick: async () => {
        closeDialog();
        const n = await prompt('Nickname', m.nick || s.name);
        if (n != null) { st.rename(m.uid, n); render(); }
      } }, '✏️ Rename'),
      h('button.btn.danger', { disabled: st.S().mons.length <= 1 || null, onclick: async () => {
        closeDialog();
        if (await confirm(`Transfer ${st.monName(m)} to the Professor? You'll get a Rare Candy. This can't be undone.`, 'Transfer', true)) {
          st.releaseMon(m.uid);
          toast('Bye bye! +1 Rare Candy');
          render();
        }
      } }, '👋 Transfer'),
    ));
  }

  function cols() {
    return getComputedStyle(gridEl).gridTemplateColumns.split(' ').length || 3;
  }

  function key(k) {
    const c = cols();
    const moves = { left: -1, right: 1, up: -c, down: c };
    if (k in moves) {
      focus = Math.max(0, Math.min(list.length - 1, focus + moves[k]));
      [...gridEl.children].forEach((n, i) => n.classList.toggle('focus', i === focus));
      gridEl.children[focus]?.scrollIntoView({ block: 'nearest' });
      const m = list[focus];
      if (m) ticker(`${st.monName(m)} Lv${st.monLevel(m.xp)}`);
      return true;
    }
    if (k === 'a' && list[focus]) { openMon(list[focus]); return true; }
    return false;
  }

  function refresh(kind) {
    if (kind === 'reset' || kind === 'walk') render();
  }

  return { title: 'BOX', mount, key, refresh, unmount() {} };
}
