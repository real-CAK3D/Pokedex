// Boot + router + physical button wiring for the Pokédex device.
import { $, $$ } from './util.js';
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
    $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    if (name === 'map') startGeo();
    try { sessionStorage.setItem('tab', name); } catch { /* private mode */ }
  },

  encounter(spawn, onDone) {
    if (this.encounterApi && !this.encounterApi.closed) return;
    this.encounterApi = openEncounter($('#overlay'), spawn, goTo => {
      this.encounterApi = null;
      onDone?.();
      if (goTo) this.go(goTo);
    });
  },

  key(k) {
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
    if (k === 'b' && this.currentName !== 'pet') this.go('pet');
    return true;
  },
};

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
  document.querySelector('#tabs [data-tab=box]').classList.toggle('notify', eggReady);
  document.querySelector('#tabs [data-tab=pet]').classList.toggle('notify', low < 30);
}

function wireControls() {
  $$('#tabs button').forEach(b => b.addEventListener('click', () => app.go(b.dataset.tab)));
  $$('[data-key]').forEach(b => b.addEventListener('pointerdown', e => {
    e.preventDefault();
    app.key(b.dataset.key);
    navigator.vibrate?.(8);
  }));
  $('#lens').addEventListener('click', () => {
    flashLed();
    app.go('map');
  });
  const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'a', ' ': 'a', z: 'a', x: 'b', Escape: 'b', Backspace: 'b' };
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') document.activeElement.blur();
      return;
    }
    const k = map[e.key];
    if (k) {
      e.preventDefault();
      app.key(k);
    } else if (/^[1-5]$/.test(e.key)) app.go(['pet', 'dex', 'map', 'box', 'bag'][+e.key - 1]);
  });
}

async function boot() {
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

  app.views = { pet: petView(app), dex: dexView(app), map: mapView(app), box: boxView(app), bag: bagView(app), starter: starterView(app) };
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
  app.go(start);
  statusInfo();

  // resume GPS straight away if the user already granted it before
  navigator.permissions?.query({ name: 'geolocation' }).then(p => { if (p.state === 'granted') startGeo(); }).catch(() => {});

  setInterval(() => { st.runTicks(); statusInfo(); }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { st.runTicks(); statusInfo(); }
    else st.save();
  });
  window.addEventListener('pagehide', st.save);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
window.__app = app; // handy for debugging from the console
