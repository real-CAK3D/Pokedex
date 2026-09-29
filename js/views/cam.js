// CAMERA: AR scanner opened by the blue lens. The live rear camera fills the
// Pokédex screen and nearby Pokémon are drawn where they really are: each one
// sits at its compass bearing from you, so turning the phone pans them in and
// out of view. No camera/compass (e.g. a desktop)? A drawn scene is used and
// you drag (or use the D-pad) to look around.
import { h, monImg, bearing, angleDiff, clamp } from '../util.js';
import { byId } from '../data.js';
import * as st from '../store.js';
import { geo, startGeo } from '../geo.js';
import { spawnsNear, CATCH_RANGE_M, isNight } from '../world.js';
import { acquireCamera, releaseCamera, videoFor, compass } from '../camera.js';
import { toast, ticker } from '../ui.js';

const FOV = 62;           // horizontal field of view in degrees
const AR_RANGE_M = 220;   // how far away Pokémon show up in the camera
const DECOR = [['🌳', 20], ['🏠', 75], ['🌲', 130], ['🌳', 200], ['🏢', 250], ['🌲', 310], ['🌼', 345]];

export default function camView(app) {
  let root, stage, fake, layer, hud, edgeL, edgeR, raf = 0, refreshT = 0;
  let camOn = false, manualHeading = 0, heading = 0, spawns = [], nodes = new Map(), focusKey = null;
  let drag = null;

  async function mount(el) {
    startGeo();
    layer = h('div.ar-layer');
    hud = h('div.ar-hud');
    edgeL = h('div.ar-edge.left');
    edgeR = h('div.ar-edge.right');
    fake = h('div.ar-fake' + (isNight() ? '.night' : ''), DECOR.map(([e, b]) => h('span.ar-decor', { 'data-b': b }, e)));
    stage = h('div.ar-stage', fake, layer, h('div.ar-reticle'), edgeL, edgeR, hud);
    root = h('div.ar', stage);
    el.append(root);

    stage.addEventListener('pointerdown', e => {
      if (e.target.closest('.ar-mon')) return;
      drag = { x: e.clientX, h: manualHeading };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', e => {
      if (!drag) return;
      manualHeading = (drag.h - ((e.clientX - drag.x) / stage.clientWidth) * FOV + 360) % 360;
    });
    const end = () => (drag = null);
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);

    try {
      const s = await acquireCamera();
      if (!root?.isConnected) { releaseCamera(); return; }
      camOn = true;
      stage.prepend(videoFor(s));
      stage.classList.add('live');
    } catch (e) {
      toast('Camera unavailable, showing a simulated view. (' + (e.name || e.message) + ')');
    }
    update();
    ticker('Point the lens at a Pokémon, then tap it or press A');
    refreshT = setInterval(update, 5000);
    raf = requestAnimationFrame(frame);
  }

  function unmount() {
    cancelAnimationFrame(raf);
    clearInterval(refreshT);
    if (camOn) releaseCamera();
    camOn = false;
    nodes.clear();
    root = null;
  }

  function update() {
    if (!geo.pos || !layer) return;
    spawns = spawnsNear(geo.pos).filter(s => s.dist <= AR_RANGE_M);
    const keys = new Set(spawns.map(s => s.key));
    for (const [k, n] of nodes) if (!keys.has(k)) { n.remove(); nodes.delete(k); }
    for (const sp of spawns) {
      sp.bearing = bearing(geo.pos, sp);
      if (nodes.has(sp.key)) continue;
      const img = monImg(sp.id, { shiny: sp.shiny });
      const node = h('button.ar-mon', { onclick: () => tryCatch(sp) },
        h('div.ar-shadow'), img,
        h('div.ar-tag', `${sp.shiny ? '✨' : ''}${byId(sp.id).name} · ${Math.round(sp.dist)}m`));
      layer.append(node);
      nodes.set(sp.key, node);
    }
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!stage) return;
    const target = compass.live && camOn ? compass.heading : manualHeading;
    heading = (heading + angleDiff(target, heading) * 0.2 + 360) % 360;
    const W = stage.clientWidth, H = stage.clientHeight;
    const desk = st.S().settings.deskMode;

    // fake scenery pans with the heading so the simulated view feels 3D
    if (!camOn) {
      fake.style.backgroundPositionX = `${-heading * 6}px`;
      for (const d of fake.children) {
        const rel = angleDiff(+d.dataset.b, heading);
        d.style.display = Math.abs(rel) > FOV ? 'none' : '';
        d.style.left = W / 2 + (rel / FOV) * W + 'px';
      }
    }

    let best = null, left = null, right = null;
    for (const sp of spawns) {
      const n = nodes.get(sp.key);
      if (!n) continue;
      const rel = angleDiff(sp.bearing, heading);
      const inView = Math.abs(rel) <= FOV / 2 + 8;
      n.style.display = inView ? '' : 'none';
      if (!inView) {
        if (rel < 0 && (!left || -rel < -left.rel)) left = { sp, rel };
        if (rel > 0 && (!right || rel < right.rel)) right = { sp, rel };
        continue;
      }
      const near = clamp(1 - sp.dist / AR_RANGE_M, 0, 1);
      const scale = 0.55 + near * 1.1;
      const x = W / 2 + (rel / FOV) * W;
      const y = H * (0.5 + near * 0.22) + Math.sin(performance.now() / 500 + sp.lat * 1e4) * 4;
      n.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) scale(${scale})`;
      n.style.zIndex = String(Math.round(near * 100));
      const catchable = sp.dist <= CATCH_RANGE_M || desk;
      n.classList.toggle('far', !catchable);
      if (catchable && (!best || Math.abs(rel) < Math.abs(best.rel))) best = { sp, rel };
    }
    focusKey = best?.sp.key || null;
    for (const [k, n] of nodes) n.classList.toggle('aim', k === focusKey);
    edgeL.textContent = left ? `◀ ${byId(left.sp.id).name}` : '';
    edgeR.textContent = right ? `${byId(right.sp.id).name} ▶` : '';

    const dir = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(heading / 45) % 8];
    const txt = `${camOn ? '📷 LIVE' : '🎨 SIM'} · ${dir} ${Math.round(heading)}° · ${spawns.length} nearby${compass.live && camOn ? '' : ' · drag to look'}`;
    if (hud.textContent !== txt) hud.textContent = txt;
  }

  function tryCatch(sp) {
    if (sp.dist > CATCH_RANGE_M && !st.S().settings.deskMode) {
      toast(`${byId(sp.id).name} is ${Math.round(sp.dist)} m away. Get within ${CATCH_RANGE_M} m.`);
      return;
    }
    app.encounter(sp, update, { ar: true });
  }

  function key(k) {
    if (k === 'left') { manualHeading = (manualHeading - 15 + 360) % 360; return true; }
    if (k === 'right') { manualHeading = (manualHeading + 15) % 360; return true; }
    if (k === 'a') {
      const sp = spawns.find(s => s.key === focusKey);
      if (sp) tryCatch(sp); else ticker('Point the Pokédex at a Pokémon', 2000);
      return true;
    }
    return false;
  }

  function refresh(kind) {
    if (kind === 'geo') update();
  }

  return { title: 'CAMERA', mount, unmount, key, refresh };
}
