// Boot + router + physical button wiring for the Pokédex device.
import { $, $$, h } from './util.js';
import { startCompass } from './camera.js';
import { installDebugLog } from './debuglog.js';
import camView from './views/cam.js';
import { loadDex } from './data.js';
import * as st from './store.js';
import { geo, startGeo } from './geo.js';
import { toast, ticker, dialogOpen, closeDialog, flashLed } from './ui.js';
import petView from './views/pet.js';
import dexView from './views/dex.js';
import mapView from './views/map.js';
import boxView from './views/box.js';
import bagView from './views/bag.js';
import starterView from './views/starter.js';
import gameView from './views/game.js';
import { openEncounter } from './views/encounter.js';

const app = {
  current: null,
  currentName: null,
  encounterApi: null,
  views: {},

  go(name, params) {
    if (!st.S().mons.length && name !== 'starter') name = 'starter';
    closeDialog();
    this.current?.unmount?.();
    const view = this.views[name];
    const el = $('#view');
    el.replaceChildren();
    this.current = view;
    this.currentName = name;
    view.mount(el, params);
    $('#sb-title').textContent = view.title;
    if (name === 'map') startGeo();
    try { sessionStorage.setItem('tab', name); } catch { /* private mode */ }
  },

  encounter(spawn, onDone, opts) {
    if (this.encounterApi && !this.encounterApi.closed) return;
    this.encounterApi = openEncounter($('#overlay'), spawn, goTo => {
      this.encounterApi = null;
      onDone?.();
      if (goTo) this.go(goTo);
    }, opts);
  },

  key(k) {
    if (menu.open) return menu.key(k);
    if (this.encounterApi && !this.encounterApi.closed) return this.encounterApi.key(k);
    if (document.querySelector('.cine')) {
      if (k === 'a' || k === 'b') document.querySelector('.cine button')?.click();
      return true;
    }
    if (dialogOpen()) {
      if (k === 'b') closeDialog();
      return true;
    }
    if (this.current?.key?.(k)) return true;
    if (k === 'start') { menu.show(); return true; }
    if (k === 'select') { openCamera(); return true; }
    if (k === 'b' && this.currentName !== 'pet') this.go('pet');
    return true;
  },
};

// ---- the mode menu, opened from the 4-bar speaker grille (or START) ----
const MODES = [
  { key: 'pet', ic: '🐾', label: 'PET' },
  { key: 'dex', ic: '📖', label: 'DEX' },
  { key: 'map', ic: '🗺️', label: 'MAP' },
  { key: 'cam', ic: '📷', label: 'CAMERA' },
  { key: 'box', ic: '📦', label: 'BOX' },
  { key: 'bag', ic: '🎒', label: 'BAG' },
  { key: 'game', ic: '🎮', label: 'GAME' },
];

const menu = {
  open: false,
  focus: 0,
  nodes: null,
  show() {
    if (this.open || !st.S().mons.length) return;
    closeDialog();
    this.open = true;
    this.focus = Math.max(0, MODES.findIndex(m => m.key === app.currentName));
    const s = st.S();
    const b = st.buddy();
    const alert = {
      pet: b && Math.min(b.food, b.joy, b.energy, b.hygiene) < 30,
      box: s.eggs.some(st.eggReady),
    };
    const sheet = h('div.menu-sheet', MODES.map((m, i) => h('button' + (m.key === app.currentName ? '.active' : ''),
      { onclick: () => this.pick(i) },
      h('span.ic', m.ic), m.label, alert[m.key] ? h('span.dot') : null, h('small', i + 1))));
    const back = h('div.menu-back', { onclick: () => this.hide() });
    this.nodes = [back, sheet];
    $('#screen').append(back, sheet);
    $('#menu-btn').classList.add('open');
    this.paint();
  },
  hide() {
    this.open = false;
    this.nodes?.forEach(n => n.remove());
    this.nodes = null;
    $('#menu-btn').classList.remove('open');
  },
  pick(i) {
    this.hide();
    if (MODES[i].key === 'cam') openCamera();
    else app.go(MODES[i].key);
  },
  paint() {
    [...this.nodes[1].children].forEach((n, i) => n.classList.toggle('focus', i === this.focus));
  },
  key(k) {
    if (k === 'up' || k === 'down') {
      this.focus = (this.focus + (k === 'up' ? -1 : 1) + MODES.length) % MODES.length;
      this.paint();
    } else if (k === 'a') this.pick(this.focus);
    else if (k === 'b' || k === 'start') this.hide();
    return true;
  },
};

// The blue lens: open the AR camera. Compass permission must be asked
// from inside the tap on iOS, so it happens here.
function openCamera() {
  if (!st.S().mons.length) return;
  startCompass();
  flashLed();
  menu.hide();
  app.go('cam');
}

function statusInfo() {
  const s = st.S();
  const tm = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const lv = st.trainerLevel(s.trainer.xp);
  $('#sb-info').textContent = `LV${lv} ◓${s.bag.poke + s.bag.great + s.bag.ultra} ${tm}`;

  const b = st.buddy();
  const low = b ? Math.min(b.food, b.joy, b.energy, b.hygiene) : 100;
  const care = $('#led-care');
  care.classList.toggle('on', low < 30 || (b && st.canEvolve(b)));
  care.classList.toggle('blink', low < 15);
  const eggReady = s.eggs.some(st.eggReady);
  $('#led-egg').classList.toggle('on', eggReady);
  $('#led-egg').classList.toggle('blink', eggReady);
  $('#led-gps').classList.toggle('on', geo.status === 'ok' || s.settings.deskMode);
  $('#led-gps').classList.toggle('blink', geo.status === 'waiting');
  $('#menu-btn').classList.toggle('notify', eggReady || low < 30);
}

// A view that wants raw press/release (the emulator), when nothing is on top of it.
function rawTarget() {
  if (menu.open || dialogOpen() || (app.encounterApi && !app.encounterApi.closed)) return null;
  return app.current?.raw ? app.current : null;
}

function wireControls() {
  $('#menu-btn').addEventListener('click', () => (menu.open ? menu.hide() : menu.show()));
  $('#sb-title').addEventListener('click', () => (menu.open ? menu.hide() : menu.show()));
  $$('[data-key]').forEach(b => {
    const k = b.dataset.key;
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      b.setPointerCapture?.(e.pointerId);
      navigator.vibrate?.(8);
      if (rawTarget()?.raw(k, true)) return;
      app.key(k);
    });
    const release = () => rawTarget()?.raw(k, false);
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
  });
  $('#lens').addEventListener('click', openCamera);
  const keyMap = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    z: 'a', x: 'b', Enter: 'start', Shift: 'select', ' ': 'a', Escape: 'b', Backspace: 'b',
  };
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') document.activeElement.blur();
      return;
    }
    const k = keyMap[e.key];
    if (k) {
      e.preventDefault();
      if (e.repeat && rawTarget()) return;
      if (rawTarget()?.raw(k, true)) return;
      app.key(k);
    } else if (/^[1-7]$/.test(e.key)) menu.pick(+e.key - 1);
    else if (e.key === 'm') menu.open ? menu.hide() : menu.show();
  });
  document.addEventListener('keyup', e => {
    const k = keyMap[e.key];
    if (k) rawTarget()?.raw(k, false);
  });
}

async function boot() {
  installDebugLog();
  // ask the browser to keep our storage (ROMs, saves) instead of evicting it
  navigator.storage?.persist?.().catch(() => {});
  ticker('Loading Pokédex…');
  st.load();
  try {
    await loadDex();
  } catch (e) {
    ticker('Could not load Pokédex data.');
    console.error(e);
    return;
  }
  st.prune();
  st.runTicks();

  app.views = { pet: petView(app), dex: dexView(app), map: mapView(app), box: boxView(app), bag: bagView(app), game: gameView(app), cam: camView(app), starter: starterView(app) };
  wireControls();

  st.on((kind, data) => {
    if (kind === 'toast') toast(data);
    if (kind === 'trainerLevel') { toast(`🎉 Trainer level ${data}!`); flashLed(); }
    if (kind === 'reset' && !st.S().mons.length) { app.go('starter'); return; }
    app.current?.refresh?.(kind, data);
    statusInfo();
  });

  let start = 'pet';
  try { start = sessionStorage.getItem('tab') || 'pet'; } catch { /* ignore */ }
  const q = new URLSearchParams(location.search);
  const link = q.get('addrom') || q.get('shelf') ? { addrom: q.get('addrom'), shelf: q.get('shelf') } : null;
  if (link) history.replaceState(null, '', location.pathname);
  if (link && st.S().mons.length) app.go('game', link);
  else {
    app.pendingRom = link; // opened right after the starter is chosen
    app.go(start);
  }
  statusInfo();

  // resume GPS straight away if the user already granted it before
  navigator.permissions?.query({ name: 'geolocation' }).then(p => { if (p.state === 'granted') startGeo(); }).catch(() => {});

  setInterval(() => { st.runTicks(); statusInfo(); }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { st.runTicks(); statusInfo(); }
    else st.save();
  });
  window.addEventListener('pagehide', st.save);

  // the Android app already ships everything offline; the SW is for the website
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.Capacitor?.isNativePlatform?.()) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
window.__app = app; // handy for debugging from the console
