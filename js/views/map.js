// MAP: real-world map around you (Leaflet + OpenStreetMap). Pokémon spawn
// around you, stops give items, walk close to catch.
import { h, spriteUrl, fmtKm, vibrate } from '../util.js';
import { byId } from '../data.js';
import * as st from '../store.js';
import { geo, teleport, recenterToGps, startGeo } from '../geo.js';
import { spawnsNear, stopsNear, biomeAt, isNight, spinStop, stopReady, CATCH_RANGE_M, STOP_RANGE_M } from '../world.js';
import { toast, ticker, pulseLens } from '../ui.js';

export default function mapView(app) {
  let map, layer, me, rangeCircle, hudEl, nearbyEl, msgEl, wrap;
  let spawns = [], stops = [], focus = 0, follow = true, refreshT = 0, showCatches = false;
  const inRangeSeen = new Set();

  function mount(el) {
    startGeo();
    hudEl = h('div.map-hud');
    nearbyEl = h('div.nearby');
    const btns = h('div.map-btns',
      h('button', { title: 'Center on me', onclick: () => { follow = true; if (!st.S().settings.deskMode) recenterToGps(); center(true); } }, '🎯'),
      h('button', { title: 'Zoom in', onclick: () => map?.zoomIn() }, '＋'),
      h('button', { title: 'Zoom out', onclick: () => map?.zoomOut() }, '－'),
      h('button', { title: 'Where I caught my Pokémon', onclick: e => {
        showCatches = !showCatches;
        e.currentTarget.style.background = showCatches ? '#dbeafe' : '';
        toast(showCatches ? '📍 Showing where you caught each Pokémon' : 'Catch spots hidden');
        update();
      } }, '📍'),
    );
    const mapEl = h('div#map');
    wrap = h('div.map-wrap', mapEl, hudEl, btns, nearbyEl);
    el.append(wrap);

    if (!window.L) {
      msgEl = h('div.map-msg', h('b', 'Map could not load.'), h('div.small', 'Check your connection. Catching still works from the nearby list.'));
      wrap.append(msgEl);
    } else {
      map = L.map(mapEl, { zoomControl: false, attributionControl: true, zoomSnap: 0.5, minZoom: 14, maxZoom: 19 })
        .setView(geo.pos ? [geo.pos.lat, geo.pos.lng] : [40.7829, -73.9654], 17);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap',
      }).addTo(map);
      layer = L.layerGroup().addTo(map);
      map.on('dragstart', () => (follow = false));
      map.on('click', e => {
        if (st.S().settings.deskMode) {
          teleport(e.latlng);
          follow = true;
        }
      });
      // leaflet needs a size recalculation once the screen has laid out
      setTimeout(() => map?.invalidateSize(), 60);
    }
    update();
    refreshT = setInterval(update, 15000); // spawns rotate on 15-min windows; keep distances fresh
  }

  function unmount() {
    clearInterval(refreshT);
    map?.remove();
    map = me = rangeCircle = null;
  }

  function center(force) {
    if (map && geo.pos && (follow || force)) map.setView([geo.pos.lat, geo.pos.lng], map.getZoom(), { animate: true });
  }

  function hud() {
    const s = st.S();
    const b = geo.pos ? biomeAt(geo.pos) : null;
    const gpsTxt = s.settings.deskMode ? '🖥️ Desk mode' : geo.status === 'ok' ? `📡 ±${Math.round(geo.accuracy)}m` : geo.status === 'denied' ? '⚠️ GPS denied' : '📡 Finding GPS…';
    hudEl.replaceChildren(
      b ? h('div.chip', `${b.icon} ${b.name}${isNight() ? ' · 🌙' : ''}`) : null,
      h('div.chip', gpsTxt),
      h('div.chip', { style: { marginLeft: 'auto' } }, `🔴${s.bag.poke} 🔵${s.bag.great} 🟡${s.bag.ultra}`),
    );
  }

  function update() {
    hud();
    if (!geo.pos) {
      nearbyEl.replaceChildren(h('div.empty', 'Waiting for location…'));
      return;
    }
    spawns = spawnsNear(geo.pos);
    stops = stopsNear(geo.pos);
    const desk = st.S().settings.deskMode;

    // alert when something new comes within catching range
    let fresh = false;
    for (const sp of spawns) {
      if (sp.dist <= CATCH_RANGE_M && !inRangeSeen.has(sp.key)) {
        inRangeSeen.add(sp.key);
        fresh = true;
      }
    }
    if (fresh) { pulseLens(); vibrate(80); }

    if (map) {
      layer.clearLayers();
      for (const stop of stops) {
        const ready = stopReady(stop);
        const mk = L.marker([stop.lat, stop.lng], {
          icon: L.divIcon({ className: 'stop-icon' + (ready ? '' : ' spun'), html: `<div>${stop.icon || '◆'}</div>`, iconSize: [30, 30] }),
          zIndexOffset: -100,
        }).on('click', () => spin(stop)).addTo(layer);
        if (stop.name) mk.bindTooltip(stop.name, { direction: 'top', offset: [0, -14] });
      }
      if (showCatches) {
        for (const m of st.S().mons) {
          if (!m.where) continue;
          L.marker([m.where.lat, m.where.lng], {
            icon: L.divIcon({ className: 'catch-icon', html: `<img src="${spriteUrl(m.id, m.shiny)}" alt="">`, iconSize: [36, 36], iconAnchor: [18, 30] }),
            zIndexOffset: -200,
          }).bindTooltip(`${st.monName(m)} · caught ${new Date(m.got).toLocaleDateString()}`, { direction: 'top' }).addTo(layer);
        }
      }
      for (const sp of spawns) {
        const far = sp.dist > CATCH_RANGE_M && !desk;
        L.marker([sp.lat, sp.lng], {
          icon: L.divIcon({
            className: 'spawn-icon' + (far ? ' far' : ''),
            html: `<img src="${spriteUrl(sp.id, sp.shiny)}" alt="">${sp.shiny ? '<span class="sparkle">✨</span>' : ''}`,
            iconSize: [48, 48], iconAnchor: [24, 40],
          }),
        }).on('click', () => tryEncounter(sp)).addTo(layer);
      }
      if (!me) {
        me = L.marker([geo.pos.lat, geo.pos.lng], { icon: L.divIcon({ className: 'player-icon', html: '<div></div>', iconSize: [22, 22] }), zIndexOffset: 1000 });
        rangeCircle = L.circle([geo.pos.lat, geo.pos.lng], { radius: CATCH_RANGE_M, color: '#d7263d', weight: 1, fillOpacity: 0.06, interactive: false });
      }
      me.setLatLng([geo.pos.lat, geo.pos.lng]).addTo(layer);
      rangeCircle.setLatLng([geo.pos.lat, geo.pos.lng]).addTo(layer);
      center(false);
    }
    renderNearby();
  }

  function renderNearby() {
    const desk = st.S().settings.deskMode;
    const dex = st.S().dex;
    focus = Math.min(focus, Math.max(0, spawns.length - 1));
    if (!spawns.length) {
      nearbyEl.replaceChildren(h('div.empty', 'Nothing nearby right now.', h('br'), 'Walk around, or wait for the next spawn wave.'));
      ticker(`Walked ${fmtKm(st.S().trainer.meters)}`);
      return;
    }
    nearbyEl.replaceChildren(...spawns.map((sp, i) => h('button.nb' + (sp.dist <= CATCH_RANGE_M || desk ? '.inrange' : '') + (i === focus ? '.focus' : ''),
      { onclick: () => { focus = i; tryEncounter(sp); } },
      !dex.caught[sp.id] ? h('span.new', 'NEW') : null,
      h('img', { src: spriteUrl(sp.id, sp.shiny), alt: '' }),
      `${Math.round(sp.dist)}m`,
    )));
    const sp = spawns[focus];
    if (sp) ticker(`${sp.shiny ? '✨' : ''}${byId(sp.id).name} ${Math.round(sp.dist)}m away`);
  }

  function tryEncounter(sp) {
    const desk = st.S().settings.deskMode;
    const fresh = spawnsNear(geo.pos).find(x => x.key === sp.key);
    if (!fresh) { toast('It wandered off…'); update(); return; }
    if (fresh.dist > CATCH_RANGE_M && !desk) {
      toast(`${byId(sp.id).name} is ${Math.round(fresh.dist)} m away. Walk closer (within ${CATCH_RANGE_M} m).`);
      map?.panTo([sp.lat, sp.lng]);
      follow = false;
      return;
    }
    app.encounter(fresh, () => update());
  }

  function spin(stop) {
    const desk = st.S().settings.deskMode;
    const d = Math.round(stop.dist);
    if (d > STOP_RANGE_M && !desk) { toast(`Stop is ${d} m away. Get within ${STOP_RANGE_M} m to spin.`); return; }
    if (!stopReady(stop)) { toast('Already spun. Try again in a few minutes.'); return; }
    const got = spinStop(stop, st.giveEgg);
    st.addTrainerXp(50);
    st.emit();
    vibrate([40, 40, 40]);
    toast(`${stop.icon || '◆'} ${stop.name ? stop.name + ': ' : ''}` + got.map(([n, c]) => `${n} x${c}`).join(', '), 4500);
    update();
  }

  function refresh(kind) {
    if (kind === 'geo' || kind === 'reset') update();
    else if (kind === 'change') hud();
  }

  function key(k) {
    if (k === 'left' || k === 'right') {
      if (!spawns.length) return true;
      focus = (focus + (k === 'left' ? -1 : 1) + spawns.length) % spawns.length;
      renderNearby();
      nearbyEl.children[focus]?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      const sp = spawns[focus];
      if (map && sp) { follow = false; map.panTo([sp.lat, sp.lng]); }
      return true;
    }
    if (k === 'up') { map?.zoomIn(); return true; }
    if (k === 'down') { map?.zoomOut(); return true; }
    if (k === 'a' && spawns[focus]) { tryEncounter(spawns[focus]); return true; }
    if (k === 'b') { follow = true; center(true); return true; }
    return false;
  }

  return { title: 'MAP', mount, unmount, refresh, key };
}
