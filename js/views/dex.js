// DEX: the national Pokédex. Browse / search every species, see what you've
// caught, open an entry (prev/next like pokedexsam), jump to your own ones.
import { h, monImg, spriteUrl, itemUrl, typeChip, pad3 } from '../util.js';
import { DEX, byId, family, REGIONS, statNames } from '../data.js';
import * as st from '../store.js';
import { ticker } from '../ui.js';

export default function dexView(app) {
  let root, gridEl, countEl, list = [], focus = 0, detailId = null, shinyView = false;
  let filter = 'all', region = 0, query = '';

  function status(id) {
    const d = st.S().dex;
    return d.caught[id] ? 'caught' : d.seen[id] ? 'seen' : 'unseen';
  }

  function mount(el, params) {
    root = h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: 0 } });
    el.append(root);
    if (params?.id) openDetail(params.id);
    else renderList();
  }

  function renderList() {
    detailId = null;
    const search = h('input.input', {
      type: 'search', placeholder: 'Name or number', value: query,
      oninput: e => { query = e.target.value.trim().toLowerCase(); build(); },
      onkeydown: e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.target.blur();
          if (list.length) openDetail(list[0].id);
        }
      },
    });
    const seg = h('div.seg', ['all', 'caught', 'missing'].map(f =>
      h('button' + (f === filter ? '.on' : ''), { onclick: e => {
        filter = f;
        [...seg.children].forEach(b => b.classList.toggle('on', b === e.currentTarget));
        build();
      } }, f.toUpperCase())));
    const regionSel = h('select.input', { style: { width: 'auto', padding: '6px' }, onchange: e => { region = +e.target.value; build(); } },
      h('option', { value: 0 }, 'All'),
      REGIONS.map((r, i) => h('option', { value: i + 1, selected: region === i + 1 || null }, r)));
    countEl = h('div.dex-count');
    gridEl = h('div.dex-grid');
    root.replaceChildren(
      h('div.dex-top', h('div.row', search, regionSel), seg, countEl),
      h('div.scroll', gridEl),
    );
    build();
  }

  function build() {
    const d = st.S().dex;
    const hide = st.S().settings.hideUncaught;
    list = DEX.filter(s => {
      if (region && s.gen !== region) return false;
      if (filter === 'caught' && !d.caught[s.id]) return false;
      if (filter === 'missing' && d.caught[s.id]) return false;
      if (query) {
        if (/^\d+$/.test(query)) return String(s.id).startsWith(query.replace(/^0+/, '')) || s.id === +query;
        if (hide && !d.seen[s.id]) return false;
        return s.name.toLowerCase().includes(query);
      }
      return true;
    });
    const caught = st.caughtCount();
    countEl.replaceChildren(
      h('span', `Caught ${caught} / ${DEX.length}`),
      h('span', `Seen ${st.seenCount()}`),
      h('span', `Showing ${list.length}`),
    );
    focus = Math.min(focus, Math.max(0, list.length - 1));
    const frag = document.createDocumentFragment();
    list.forEach((s, i) => {
      const stt = status(s.id);
      const masked = hide && stt === 'unseen';
      frag.append(h(`div.dex-cell.${stt}`, { onclick: () => { focus = i; openDetail(s.id); } },
        h('span.num', pad3(s.id)),
        stt === 'caught' ? h('img.ball', { src: itemUrl('poke-ball'), alt: '' }) : null,
        d.shiny[s.id] ? h('span.shiny', '✨') : null,
        h('img', { src: spriteUrl(s.id), loading: 'lazy', alt: '' }),
        masked ? '???' : s.name,
      ));
    });
    gridEl.replaceChildren(frag);
    paintFocus(false);
    ticker(`POKéDEX ${caught}/${DEX.length} caught`);
  }

  function cols() {
    return getComputedStyle(gridEl).gridTemplateColumns.split(' ').length || 4;
  }

  function paintFocus(scroll = true) {
    const cells = gridEl.children;
    for (const c of gridEl.querySelectorAll('.focus')) c.classList.remove('focus');
    const c = cells[focus];
    if (c) {
      c.classList.add('focus');
      if (scroll) c.scrollIntoView({ block: 'nearest' });
      const s = list[focus];
      if (s) ticker(`#${pad3(s.id)} ${st.S().settings.hideUncaught && status(s.id) === 'unseen' ? '???' : s.name}`);
    }
  }

  function openDetail(id) {
    detailId = id;
    const s = byId(id);
    const stt = status(id);
    const hide = st.S().settings.hideUncaught && stt === 'unseen';
    const d = st.S().dex;
    const mine = st.S().mons.filter(m => m.id === id);
    const big = hide ? h('img.big.unseen', { src: spriteUrl(id) }) : monImg(id, { shiny: shinyView, cls: 'big' });
    const hero = h('div.dd-hero',
      h('button.nav.prev', { onclick: () => step(-1) }, '‹'),
      big,
      h('button.nav.next', { onclick: () => step(1) }, '›'),
      h('div.caught-badge', stt === 'caught' ? [h('img', { src: itemUrl('poke-ball'), width: 14 }), `x${d.caught[id]}`] : stt === 'seen' ? '👁 Seen' : 'Not caught'),
      hide ? null : h('button.shiny-toggle', { onclick: () => { shinyView = !shinyView; openDetail(id); } }, shinyView ? '✨ Shiny' : 'Normal'),
    );
    const maxStat = 180;
    const body = h('div.pad.col',
      h('div.dd-title', h('span.no', '#' + pad3(id)), h('h2', hide ? '???' : s.name)),
      hide ? h('div.muted.small', 'Catch or hatch this Pokémon to reveal its data.') : [
        h('div.row', s.types.map(typeChip), h('span.small.muted', s.genus || '')),
        h('div.small', s.text || ''),
        h('div.kv.small',
          'Height', h('b', (s.h / 10).toFixed(1) + ' m'),
          'Weight', h('b', (s.w / 10).toFixed(1) + ' kg'),
          'Catch rate', h('b', s.capture + '/255'),
          'Egg steps', h('b', s.hatch ? (s.hatch * 257).toLocaleString() : '—'),
          'Region', h('b', REGIONS[s.gen - 1]),
          s.rarity ? ['Class', h('b.cap', s.rarity)] : null,
        ),
        h('h3', 'Base stats'),
        s.stats.map((v, i) => h('div.stat-row', statNames[i], h('b', v),
          h('div.bar' + (v < 50 ? '.low' : v < 90 ? '.mid' : ''), h('i', { style: { width: Math.min(100, (v / maxStat) * 100) + '%' } })))),
        h('h3', 'Evolution'),
        evoChain(id),
      ],
      mine.length ? [h('h3', `Your ${s.name} (${mine.length})`), h('div.col', mine.map(m => h('div.item-row',
        monImg(m.id, { shiny: m.shiny, anim: false }),
        h('div.grow', h('b', (m.shiny ? '✨ ' : '') + st.monName(m)), h('div.tiny.muted', `Lv ${st.monLevel(m.xp)} · ${m.origin}`)),
        st.S().buddy === m.uid ? h('span.small', '⭐ Buddy')
          : h('button.btn.sm', { onclick: () => { st.setBuddy(m.uid); app.go('pet'); } }, 'Make buddy'),
      )))] : null,
      h('button.btn.alt', { onclick: renderList }, '← Back to list'),
    );
    root.replaceChildren(h('div.dex-detail', hero, h('div.scroll', body)));
    ticker(`#${pad3(id)} ${hide ? '???' : s.name}`);
  }

  function evoChain(id) {
    const fam = family(id);
    if (fam.length === 1) return h('div.small.muted', 'Does not evolve.');
    const d = st.S().dex;
    const hide = st.S().settings.hideUncaught;
    return h('div.evo-chain', fam.map((f, i) => {
      const fs = byId(f);
      const masked = hide && !d.seen[f];
      return [
        i > 0 ? h('span.arrow', `→${fs.evoLv ? ' Lv' + fs.evoLv : ''}`) : null,
        h('button.evo' + (f === id ? '.cur' : ''), { onclick: () => openDetail(f) },
          h('img', { src: spriteUrl(f), style: masked ? { filter: 'brightness(0)', opacity: '.3' } : null }),
          masked ? '???' : fs.name),
      ];
    }));
  }

  function step(dir) {
    const idx = list.findIndex(s => s.id === detailId);
    let next;
    if (idx >= 0) {
      const ni = idx + dir;
      if (ni < 0 || ni >= list.length) return;
      focus = ni;
      next = list[ni].id;
    } else {
      next = detailId + dir;
      if (next < 1 || next > DEX.length) return;
    }
    openDetail(next);
  }

  function key(k) {
    if (detailId) {
      if (k === 'left') step(-1);
      else if (k === 'right') step(1);
      else if (k === 'up' || k === 'down') root.querySelector('.scroll')?.scrollBy({ top: k === 'up' ? -80 : 80, behavior: 'smooth' });
      else if (k === 'a') { shinyView = !shinyView; openDetail(detailId); }
      else if (k === 'b') { renderList(); paintFocus(); }
      return true;
    }
    const c = cols();
    const moves = { left: -1, right: 1, up: -c, down: c };
    if (k in moves) {
      focus = Math.max(0, Math.min(list.length - 1, focus + moves[k]));
      paintFocus();
      return true;
    }
    if (k === 'a' && list[focus]) { openDetail(list[focus].id); return true; }
    return false;
  }

  function refresh(kind) {
    // re-render the list only when the dex actually changes (not on every tick)
    if (kind === 'change' && !detailId && gridEl && countEl) {
      const txt = `Caught ${st.caughtCount()} / ${DEX.length}`;
      if (countEl.firstChild?.textContent !== txt) build();
    }
  }

  return { title: 'DEX', mount, key, refresh, unmount() {} };
}
