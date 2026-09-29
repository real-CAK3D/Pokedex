// Catch encounter, shown over the Pokédex screen. Flick the ball up (or press
// A) while the coloured ring is small for a better chance.
import { h, monImg, itemUrl, vibrate, clamp } from '../util.js';
import { byId, isLegend } from '../data.js';
import * as st from '../store.js';
import { isNight } from '../world.js';
import { geo } from '../geo.js';
import { toast, ticker, flashLed } from '../ui.js';

const BALLS = [
  { key: 'poke', item: 'poke-ball', name: 'Poké Ball' },
  { key: 'great', item: 'great-ball', name: 'Great Ball' },
  { key: 'ultra', item: 'ultra-ball', name: 'Ultra Ball' },
];

export function openEncounter(host, spawn, onDone) {
  const s = byId(spawn.id);
  const bag = st.S().bag;
  spawn.level ||= st.wildLevel(spawn.id);
  const firstSeen = st.markSeen(spawn.id);
  st.emit();

  let ballIdx = BALLS.findIndex(b => bag[b.key] > 0);
  if (ballIdx < 0) ballIdx = 0;
  let berry = false, busy = false, done = false, ringT = 0, ringRaf = 0, fails = 0;

  const diff = s.capture >= 150 ? '' : s.capture >= 60 ? '.mid' : '.hard';
  const monWrap = h('div.enc-mon', monImg(spawn.id, { shiny: spawn.shiny }));
  const inner = h('div.ring.inner' + diff);
  const outer = h('div.ring.outer');
  const held = h('div.ball-hold', h('img', { src: itemUrl(BALLS[ballIdx].item), alt: 'ball', draggable: 'false' }));
  const msg = h('div.enc-msg');
  const hint = h('div.enc-hint', 'Flick the ball up! (or press A)');
  const ballBtn = h('button.itm.on', { onclick: cycleBall });
  const berryBtn = h('button.itm', { onclick: toggleBerry });
  const runBtn = h('button.itm', { onclick: () => close() }, '🏃 Run');
  const root = h('div.enc',
    h('div.enc-bg' + (isNight() ? '.night' : '')),
    h('div.enc-top',
      h('div.enc-name', (spawn.shiny ? '✨ ' : '') + s.name, h('small', `Lv${spawn.level}`), st.S().dex.caught[spawn.id] ? ' ◓' : ''),
      firstSeen ? h('div.enc-name', { style: { fontSize: '10px' } }, 'NEW!') : null),
    monWrap, outer, inner, msg, hint, held,
    h('div.enc-bottom', ballBtn, berryBtn, runBtn),
  );
  host.replaceChildren(root);
  host.hidden = false;
  paintItems();
  ticker(`A wild ${s.name} appeared!`);
  vibrate(100);

  // shrinking target ring (1 = big/easy, ~0.15 = tiny/excellent)
  const ringLoop = t => {
    ringT = 0.15 + 0.85 * (1 - ((t / 1600) % 1));
    const px = 150 * ringT;
    inner.style.width = inner.style.height = px + 'px';
    ringRaf = requestAnimationFrame(ringLoop);
  };
  ringRaf = requestAnimationFrame(ringLoop);

  // ---- flick to throw ----
  let samples = [];
  held.addEventListener('pointerdown', e => {
    if (busy || done) return;
    e.preventDefault();
    held.setPointerCapture(e.pointerId);
    samples = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    const rootRect = root.getBoundingClientRect();
    const move = ev => {
      samples.push({ x: ev.clientX, y: ev.clientY, t: performance.now() });
      if (samples.length > 8) samples.shift();
      held.style.left = ev.clientX - rootRect.left + 'px';
      held.style.bottom = Math.max(20, rootRect.bottom - ev.clientY - 32) + 'px';
    };
    const up = ev => {
      held.removeEventListener('pointermove', move);
      held.removeEventListener('pointerup', up);
      held.removeEventListener('pointercancel', up);
      const a = samples[0], b = { x: ev.clientX, y: ev.clientY, t: performance.now() };
      const dt = Math.max(16, b.t - a.t);
      const vy = (a.y - b.y) / dt, vx = (b.x - a.x) / dt;
      if (vy < 0.4) { resetBall(); return; } // not a real flick
      const r = root.getBoundingClientRect();
      const m = monWrap.getBoundingClientRect();
      const targetY = m.top + m.height * 0.6;
      const t = (b.y - targetY) / (vy * 1); // "time" to reach monster height
      const landX = b.x + vx * t;
      const aimErr = Math.abs(landX - (m.left + m.width / 2)) / (m.width / 2);
      const power = vy > 0.9;
      throwBall({ x: b.x - r.left, y: b.y - r.top }, aimErr < 0.85 && power, landX - r.left);
    };
    held.addEventListener('pointermove', move);
    held.addEventListener('pointerup', up);
    held.addEventListener('pointercancel', up);
  });

  function resetBall() {
    held.style.left = '';
    held.style.bottom = '';
    held.classList.remove('hide');
    held.firstChild.src = itemUrl(BALLS[ballIdx].item);
  }

  function paintItems() {
    const b = BALLS[ballIdx];
    ballBtn.replaceChildren(h('img', { src: itemUrl(b.item) }), `x${bag[b.key]}`);
    berryBtn.replaceChildren(h('img', { src: itemUrl('razz-berry') }), `x${bag.razz}`);
    berryBtn.classList.toggle('berry-on', berry);
    held.firstChild.src = itemUrl(b.item);
  }

  function cycleBall() {
    if (busy) return;
    for (let i = 1; i <= BALLS.length; i++) {
      const j = (ballIdx + i) % BALLS.length;
      if (bag[BALLS[j].key] > 0) { ballIdx = j; break; }
    }
    paintItems();
  }

  function toggleBerry() {
    if (busy || berry) return;
    if (bag.razz <= 0) { toast('No Razz Berries. Spin stops to get some.'); return; }
    bag.razz--;
    berry = true;
    st.emit();
    paintItems();
    toast('Razz Berry: next throw is easier!');
  }

  function say(text, ms = 1000) {
    msg.textContent = text;
    if (ms) setTimeout(() => { if (msg.textContent === text) msg.textContent = ''; }, ms);
  }

  // Animate the ball along an arc; on a hit, run the shake/catch sequence.
  function throwBall(from, hit, landX) {
    const b = BALLS[ballIdx];
    if (bag[b.key] <= 0) { toast(`Out of ${b.name}s!`); resetBall(); cycleBall(); return; }
    busy = true;
    bag[b.key]--;
    st.emit();
    const ring = ringT;
    held.classList.add('hide');
    const r = root.getBoundingClientRect();
    const m = monWrap.getBoundingClientRect();
    const to = { x: hit ? m.left + m.width / 2 - r.left : landX ?? from.x + (Math.random() - 0.5) * 200, y: m.top + m.height * 0.55 - r.top };
    const ball = h('div.thrown', h('img', { src: itemUrl(b.item) }));
    root.append(ball);
    const start = performance.now(), dur = 520;
    const anim = now => {
      const p = Math.min(1, (now - start) / dur);
      const x = from.x + (to.x - from.x) * p;
      const y = from.y + (to.y - from.y) * p - Math.sin(p * Math.PI) * 90;
      ball.style.left = x - 22 + 'px';
      ball.style.top = y - 22 + 'px';
      ball.style.transform = `rotate(${p * 720}deg) scale(${1 - p * 0.35})`;
      if (p < 1) return requestAnimationFrame(anim);
      if (!hit) {
        ball.remove();
        say('Missed!');
        setTimeout(() => { busy = false; resetBall(); paintItems(); checkBalls(); }, 500);
        return;
      }
      resolveHit(ball, b.key, ring);
    };
    requestAnimationFrame(anim);
  }

  function resolveHit(ball, ballKey, ring) {
    const ringMult = 1 + (1 - ring) * 1.2;
    const bonus = ring < 0.3 ? 'Excellent!' : ring < 0.55 ? 'Great!' : ring < 0.8 ? 'Nice!' : '';
    if (bonus) say(bonus, 900);
    const p = st.catchChance(spawn.id, ballKey, ringMult, berry);
    berry = false;
    monWrap.classList.add('gone');
    // Each wobble is a separate check, like the main games: p^(1/3) per shake.
    const perShake = Math.pow(p, 1 / 3);
    let shakes = 0;
    ball.style.transition = 'top .3s ease-in';
    ball.style.top = parseFloat(ball.style.top) + 40 + 'px';
    const doShake = () => {
      if (Math.random() > perShake) return breakOut(ball);
      shakes++;
      vibrate(40);
      ball.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-25deg)' }, { transform: 'rotate(25deg)' }, { transform: 'rotate(0)' }], { duration: 500 });
      if (shakes >= 3) setTimeout(() => caught(ball), 650);
      else setTimeout(doShake, 800);
    };
    setTimeout(doShake, 700);
  }

  function breakOut(ball) {
    ball.remove();
    monWrap.classList.remove('gone');
    monWrap.classList.add('jump');
    setTimeout(() => monWrap.classList.remove('jump'), 1000);
    fails++;
    const fleeP = (isLegend(s) ? 0.18 : 0.06 + (1 - s.capture / 255) * 0.12) + fails * 0.01;
    if (Math.random() < clamp(fleeP, 0, 0.5)) {
      say('Oh no! It fled…', 0);
      st.S().caughtSpawns[spawn.key] = Date.now();
      st.emit();
      monWrap.classList.add('gone');
      setTimeout(() => close(), 1400);
      return;
    }
    say(['Argh! Almost had it!', 'Aww! It appeared to be caught!', 'Shoot! It was so close!'][Math.floor(Math.random() * 3)], 1300);
    setTimeout(() => { busy = false; resetBall(); paintItems(); checkBalls(); }, 900);
  }

  function checkBalls() {
    if (BALLS.every(b => bag[b.key] <= 0)) {
      say('Out of balls!', 0);
      hint.textContent = 'Spin stops (◆ on the map) for more balls.';
    }
  }

  function caught(ball) {
    done = true;
    flashLed();
    vibrate([100, 50, 200]);
    const where = geo.pos ? { lat: +geo.pos.lat.toFixed(4), lng: +geo.pos.lng.toFixed(4) } : null;
    const { mon, isNew } = st.catchMon(spawn, where);
    ball.remove();
    root.append(h('div.captured',
      h('div.pixel', { style: { fontSize: '10px' } }, 'Gotcha!'),
      monImg(mon.id, { shiny: mon.shiny }),
      h('h2', `${mon.shiny ? '✨ ' : ''}${s.name} was caught!`),
      isNew ? h('span.new-tag', 'NEW POKéDEX ENTRY') : null,
      h('div.small.muted', `Lv ${st.monLevel(mon.xp)} · +100 XP${isNew ? ' · +500 XP' : ''}`),
      h('div.small', 'It now lives in your BOX and can be raised as your buddy.'),
      h('div.row',
        h('button.btn.alt', { onclick: () => { st.setBuddy(mon.uid); close('pet'); } }, '⭐ Make buddy'),
        h('button.btn.go', { onclick: () => close() }, 'OK')),
    ));
    ticker(`${s.name} registered in the Pokédex!`);
  }

  function close(goTo) {
    cancelAnimationFrame(ringRaf);
    host.hidden = true;
    host.replaceChildren();
    api.closed = true;
    onDone?.(goTo);
  }

  const api = {
    closed: false,
    key(k) {
      if (done) { if (k === 'a' || k === 'b') close(); return true; }
      if (k === 'a' && !busy) {
        // A = a straight throw; aim is perfect but you still need ring timing
        const r = root.getBoundingClientRect(), hb = held.getBoundingClientRect();
        throwBall({ x: hb.left + hb.width / 2 - r.left, y: hb.top + hb.height / 2 - r.top }, Math.random() < 0.9);
      } else if (k === 'left' || k === 'right') cycleBall();
      else if (k === 'up') toggleBerry();
      else if (k === 'b' && !busy) close();
      return true;
    },
    close,
  };
  return api;
}
