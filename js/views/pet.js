// PET: the TamaPoke-style care screen. Your buddy (any Pokémon you caught or
// hatched) lives here: feed, play, train, clean, sleep, evolve.
import { h, monImg, itemUrl, clamp } from '../util.js';
import { byId } from '../data.js';
import * as st from '../store.js';
import { toast, ticker, dialog, closeDialog, prompt, evolveCinematic, flashLed } from '../ui.js';

const ACTIONS = [
  { key: 'feed', ic: '🍎', label: 'Feed' },
  { key: 'play', ic: '⚽', label: 'Play' },
  { key: 'train', ic: '🥊', label: 'Train' },
  { key: 'clean', ic: '🫧', label: 'Clean' },
  { key: 'sleep', ic: '🌙', label: 'Sleep' },
  { key: 'info', ic: '📋', label: 'Info' },
];

const timeOfDay = () => {
  const hr = new Date().getHours();
  return hr >= 6 && hr < 17 ? 'day' : hr >= 17 && hr < 20 ? 'dusk' : 'night';
};

export default function petView(app) {
  let root, scene, sky, hud, nameEl, xpEl, walker, img, shade, zzz, poopsEl, evoBtn, eggStrip, actionsEl;
  let focus = 0;
  let walkTimer = 0, x = 50, dir = 1, curSpecies = null;
  let game = null; // active minigame

  function mount(el) {
    sky = h('div.sky', h('div.stars'), h('div.hills'));
    hud = h('div.pet-hud');
    nameEl = h('div.pet-name');
    xpEl = h('div.xpbar', h('i'));
    walker = h('div.walker', h('div.shadow'));
    shade = h('div.sleep-shade');
    zzz = h('div.zzz', 'Z z z');
    poopsEl = h('div');
    eggStrip = h('div.egg-strip', { onclick: () => app.go('box') });
    evoBtn = h('button.btn.gold.evolve-btn', { onclick: doEvolve }, '✨ Evolve!');
    scene = h('div.pet-scene', sky, poopsEl, walker, shade, hud, nameEl, xpEl, eggStrip, evoBtn);
    actionsEl = h('div.pet-actions', ACTIONS.map((a, i) =>
      h('button', { onclick: () => { focus = i; paintFocus(); act(a.key); } }, h('span.ic', a.ic), a.label)));
    root = h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: 0 } }, scene, actionsEl);
    el.append(root);
    refresh();
    paintFocus();
    walkTimer = setInterval(stroll, 120);
  }

  function unmount() {
    clearInterval(walkTimer);
    endGame(true);
  }

  function stroll() {
    const m = st.buddy();
    if (!m || !img || game) return;
    if (m.sleeping || m.eatUntil > Date.now()) return;
    if (Math.random() < 0.02) dir = -dir;
    x += dir * 0.35;
    if (x > 78) { x = 78; dir = -1; }
    if (x < 22) { x = 22; dir = 1; }
    walker.style.left = x + '%';
    img.classList.toggle('flip', dir > 0);
  }

  function statBar(label, v) {
    const cls = v < 25 ? 'low' : v < 50 ? 'mid' : '';
    return h('div.stat', label, h('div.bar' + (cls ? '.' + cls : ''), h('i', { style: { width: v + '%' } })));
  }

  function refresh() {
    const m = st.buddy();
    if (!m || !root) return;
    const s = byId(m.id);
    const lv = st.monLevel(m.xp);
    const tod = timeOfDay();
    sky.className = 'sky ' + tod;

    hud.replaceChildren(statBar('FOOD', m.food), statBar('JOY', m.joy), statBar('ENE', m.energy), statBar('HYG', m.hygiene));
    nameEl.replaceChildren(
      h('span', (m.shiny ? '✨ ' : '') + st.monName(m)),
      h('span.lv', `Lv${lv}`),
    );
    const lo = st.xpForLevel(lv), hi = st.xpForLevel(lv + 1);
    xpEl.firstChild.style.width = lv >= 100 ? '100%' : clamp(((m.xp - lo) / (hi - lo)) * 100, 0, 100) + '%';

    if (curSpecies !== `${m.uid}:${m.id}:${m.shiny}`) {
      curSpecies = `${m.uid}:${m.id}:${m.shiny}`;
      img?.remove();
      img = monImg(m.id, { shiny: m.shiny, cls: 'mon' });
      img.addEventListener('click', petIt);
      walker.append(img);
    }
    img.classList.toggle('sleeping', m.sleeping);
    img.classList.toggle('eating', m.eatUntil > Date.now());
    if (m.eatUntil > Date.now()) setTimeout(refresh, m.eatUntil - Date.now() + 50);

    shade.style.opacity = m.sleeping ? 1 : 0;
    if (m.sleeping) walker.append(zzz); else zzz.remove();

    poopsEl.replaceChildren(...Array.from({ length: m.poops }, (_, i) =>
      h('div.poop', { style: { left: 12 + i * 26 + '%' }, onclick: () => act('clean') }, '💩')));

    evoBtn.style.display = st.canEvolve(m) && !game ? '' : 'none';

    const eggs = st.S().eggs.slice(0, 4);
    eggStrip.replaceChildren(...eggs.map(e => h(`div.egg.t${e.km}${st.eggReady(e) ? '.ready' : ''}`)));

    actionsEl.children[4].lastChild.textContent = m.sleeping ? 'Wake' : 'Sleep';
    actionsEl.children[4].firstChild.textContent = m.sleeping ? '☀️' : '🌙';

    if (!game) {
      const low = Math.min(m.food, m.joy, m.energy, m.hygiene);
      const need = m.food === low ? 'hungry' : m.joy === low ? 'bored' : m.energy === low ? 'tired' : 'dirty';
      ticker(m.sleeping ? `${st.monName(m)} is sleeping… Zzz`
        : st.canEvolve(m) ? `${st.monName(m)} is ready to evolve!`
          : low < 30 ? `${st.monName(m)} looks ${need}!`
            : `${s.name} · Lv${lv} · Bond ${m.bond}`);
    }
  }

  function showHeart() {
    const heart = h('div.heart', '❤️');
    walker.append(heart);
    setTimeout(() => heart.remove(), 1500);
  }

  function petIt() {
    const m = st.buddy();
    if (m.sleeping) { toast(`Shh… ${st.monName(m)} is asleep.`); return; }
    st.caress(m);
    showHeart();
  }

  function paintFocus() {
    [...actionsEl.children].forEach((b, i) => b.classList.toggle('focus', i === focus));
  }

  function act(key) {
    const m = st.buddy();
    if (game) return;
    if (key === 'feed') return feedMenu(m);
    if (key === 'clean') {
      st.clean(m);
      toast('🫧 Squeaky clean!');
      return;
    }
    if (key === 'sleep') {
      st.toggleSleep(m);
      return;
    }
    if (key === 'info') return infoSheet(m);
    if (m.sleeping) { toast(`${st.monName(m)} is asleep. Wake it first.`); return; }
    if (m.energy < 15) { toast(`${st.monName(m)} is too tired. Let it sleep.`); return; }
    if (key === 'play') return startBallGame(m);
    if (key === 'train') return startBagGame(m);
  }

  function feedMenu(m) {
    const bag = st.S().bag;
    const berry = (color, key, name, cls) => {
      const known = m.berryKnown && st.lovesBerry(m, color);
      return h('button.item-row', {
        disabled: bag[key] <= 0 || null,
        style: { opacity: bag[key] > 0 ? 1 : 0.45 },
        onclick: () => {
          closeDialog();
          const r = st.feedBerry(m, color);
          if (r === 'loved') { showHeart(); toast(`${st.monName(m)} LOVES ${name}!`); } else toast(`Yum! ${name}`);
        },
      }, h('span.ico', cls), h('div.grow', name, known ? ' ❤️' : ''), h('span.n', `x${bag[key]}`));
    };
    dialog(h('div.col',
      h('h2', `Feed ${st.monName(m)}`),
      h('button.item-row', { onclick: () => { closeDialog(); st.feedBasic(m); toast('Munch munch.'); } },
        h('span.ico', '🥣'), h('div.grow', 'Poké Food', h('div.tiny.muted', '+15 food')), h('span.n', '∞')),
      berry(0, 'berryR', 'Red Berry', '🍒'),
      berry(1, 'berryB', 'Blue Berry', '🫐'),
      berry(2, 'berryG', 'Green Berry', '🍏'),
      h('div.tiny.muted', 'Every species has a secret favourite berry flavour.'),
      h('button.item-row', {
        style: { opacity: bag.poffin > 0 ? 1 : 0.45 },
        onclick: () => { closeDialog(); if (st.feedPoffin(m) === 'none') toast('No Poffins. Spin stops to find some.'); else { showHeart(); toast('Sweet treat! (+weight)'); } },
      }, h('span.ico', '🧁'), h('div.grow', 'Poffin', h('div.tiny.muted', '+joy, but fattening')), h('span.n', `x${bag.poffin}`)),
      h('button.item-row', {
        style: { opacity: bag.rareCandy > 0 ? 1 : 0.45 },
        onclick: () => { closeDialog(); if (st.useRareCandy(m)) { flashLed(); toast(`${st.monName(m)} grew a level!`); } else toast('No Rare Candy.'); },
      }, h('img', { src: itemUrl('rare-candy') }), h('div.grow', 'Rare Candy', h('div.tiny.muted', '+1 level')), h('span.n', `x${bag.rareCandy}`)),
    ));
  }

  function infoSheet(m) {
    const s = byId(m.id);
    const lv = st.monLevel(m.xp);
    const bs = st.battleStats(m);
    const hint = st.nextEvoHint(m);
    const favIdx = [0, 1, 2].find(c => st.lovesBerry(m, c));
    dialog(h('div.col',
      h('div.row', monImg(m.id, { shiny: m.shiny, anim: false }),
        h('div.grow',
          h('h2', (m.shiny ? '✨ ' : '') + st.monName(m)),
          h('div.small.muted', `#${s.id} ${s.name} · ${s.genus || ''}`),
          h('div.small', `Level ${lv} · ${m.xp.toLocaleString()} XP`),
        )),
      h('div.kv',
        'Attack', h('b', bs.atk),
        'Defense', h('b', bs.def),
        'Speed', h('b', bs.spe),
        'Genes (ATK/DEF/SPE)', h('b', m.genes.join(' / ') + '%'),
        'Training (bag/care/game)', h('b', m.tr.join(' / ')),
        'Bond', h('b', `${m.bond}/100`),
        'Weight', h('b', m.weight > 50 ? `${m.weight} (chubby!)` : m.weight),
        'Slip-ups', h('b', m.mistakes),
        'Favourite berry', h('b', m.berryKnown ? ['Red', 'Blue', 'Green'][favIdx] : '???'),
        'Next evolution', h('b', hint ? `Lv ${hint.lv}${hint.friend ? ' + bond 60' : ''}` : 'Final form'),
        'Care streak', h('b', `${st.S().trainer.streak} days`),
        'Met', h('b', `${m.origin} · ${new Date(m.got).toLocaleDateString()}`),
      ),
      h('button.btn.alt', { onclick: async () => {
        closeDialog();
        const n = await prompt('Nickname', m.nick || s.name);
        if (n != null) st.rename(m.uid, n);
      } }, '✏️ Rename'),
    ));
  }

  async function doEvolve() {
    const m = st.buddy();
    if (!st.canEvolve(m)) return;
    const res = st.evolve(m);
    if (res) {
      curSpecies = null;
      await evolveCinematic(res.from, res.to, m.shiny);
      refresh();
    }
  }

  // ---- minigames ----
  function endGame(silent) {
    if (!game) return;
    clearInterval(game.iv);
    clearTimeout(game.spawnT);
    game.nodes.forEach(n => n.remove());
    const g = game;
    game = null;
    if (!silent) g.finish();
    refresh();
  }

  function startBallGame(m) {
    let score = 0, left = 15;
    const hudEl = h('div.game-hud', h('span', 'CATCH!'), h('span', `★ 0`), h('span', '15s'));
    const nodes = [hudEl];
    scene.append(hudEl);
    let target = null;
    const spawn = () => {
      target?.remove();
      const w = scene.clientWidth, hgt = scene.clientHeight;
      target = h('img.ball-target', {
        src: itemUrl('poke-ball'),
        style: { left: 10 + Math.random() * (w - 64) + 'px', top: 50 + Math.random() * (hgt - 110) + 'px' },
        onpointerdown: e => { e.stopPropagation(); hit(); },
      });
      scene.append(target);
      nodes.push(target);
      clearTimeout(game.spawnT);
      game.spawnT = setTimeout(spawn, Math.max(450, 1100 - score * 25));
    };
    const hit = () => {
      score++;
      hudEl.children[1].textContent = `★ ${score}`;
      spawn();
    };
    game = {
      nodes, hit,
      finish: () => { st.playResult(m, score); toast(`⚽ Score ${score}! Speed trained, joy up.`); },
      iv: setInterval(() => {
        left--;
        hudEl.children[2].textContent = left + 's';
        if (left <= 0) endGame(false);
      }, 1000),
    };
    ticker('Tap the Poké Balls! (A works too)');
    evoBtn.style.display = 'none';
    spawn();
  }

  function startBagGame(m) {
    let hits = 0, left = 8;
    const hudEl = h('div.game-hud', h('span', 'PUNCH!'), h('span', 'x0'), h('span', '8s'));
    const bag = h('div.bag-target', '🥊');
    const hit = () => {
      hits++;
      hudEl.children[1].textContent = 'x' + hits;
      bag.classList.remove('hit');
      void bag.offsetWidth;
      bag.classList.add('hit');
    };
    bag.addEventListener('pointerdown', e => { e.preventDefault(); hit(); });
    scene.append(hudEl, bag);
    game = {
      nodes: [hudEl, bag], hit,
      finish: () => { const g = st.trainResult(m, hits); toast(`🥊 ${hits} hits! Attack +${g}`); },
      iv: setInterval(() => {
        left--;
        hudEl.children[2].textContent = left + 's';
        if (left <= 0) endGame(false);
      }, 1000),
    };
    ticker('Mash the glove (or A)!');
    evoBtn.style.display = 'none';
  }

  function key(k) {
    if (game) {
      if (k === 'a') { game.hit(); return true; }
      if (k === 'b') { endGame(true); return true; }
      return true;
    }
    if (k === 'left') { focus = (focus + ACTIONS.length - 1) % ACTIONS.length; paintFocus(); return true; }
    if (k === 'right') { focus = (focus + 1) % ACTIONS.length; paintFocus(); return true; }
    if (k === 'up') { if (st.canEvolve(st.buddy())) doEvolve(); else petIt(); return true; }
    if (k === 'a') { act(ACTIONS[focus].key); return true; }
    return false;
  }

  return { title: 'PET', mount, unmount, refresh, key };
}
