// GPS tracking, running for the whole app (not just the map tab) so walking
// counts toward eggs and buddy XP whatever screen you're looking at.
import { distM } from './util.js';
import { S, addWalk, emit } from './store.js';

const MIN_STEP_M = 8;         // ignore GPS jitter
const MAX_SPEED_MS = 7;       // ~25 km/h: driving doesn't count (like PoGo)
const MAX_ACCURACY_M = 45;
const FALLBACK = { lat: 40.7829, lng: -73.9654 }; // Central Park, for desk mode

export const geo = {
  pos: null,          // current position used by the game
  gps: null,          // last real fix
  status: 'idle',     // idle | waiting | ok | denied | unsupported
  accuracy: null,
  _last: null,
  _watch: null,
};

export function startGeo() {
  if (!('geolocation' in navigator)) {
    geo.status = 'unsupported';
    useFallback();
    return;
  }
  if (geo._watch != null) return;
  geo.status = 'waiting';
  geo._watch = navigator.geolocation.watchPosition(onFix, onErr, {
    enableHighAccuracy: true, maximumAge: 5000, timeout: 20000,
  });
}

function onFix(p) {
  const fix = { lat: p.coords.latitude, lng: p.coords.longitude, t: p.timestamp };
  geo.gps = fix;
  geo.accuracy = p.coords.accuracy;
  geo.status = 'ok';
  if (!S().settings.deskMode || !geo.pos) geo.pos = { lat: fix.lat, lng: fix.lng };

  // distance only counts from real, accurate, walking-speed movement
  if (p.coords.accuracy <= MAX_ACCURACY_M) {
    const last = geo._last;
    if (!last) geo._last = fix;
    else {
      const d = distM(last, fix);
      const dt = Math.max(1, (fix.t - last.t) / 1000);
      if (d >= MIN_STEP_M) {
        if (d / dt <= MAX_SPEED_MS) addWalk(d);
        geo._last = fix;
      }
    }
  }
  emit('geo');
}

function onErr(err) {
  if (err.code === 1) geo.status = 'denied';
  else if (geo.status !== 'ok') geo.status = 'waiting';
  if (!geo.pos) useFallback();
  emit('geo');
}

function useFallback() {
  geo.pos = S().lastPos || { ...FALLBACK };
  emit('geo');
}

// Desk mode: move your trainer by tapping the map. Distance never counts.
export function teleport(latlng) {
  geo.pos = { lat: latlng.lat, lng: latlng.lng };
  S().lastPos = geo.pos;
  emit('geo');
}

export function recenterToGps() {
  if (geo.gps) geo.pos = { lat: geo.gps.lat, lng: geo.gps.lng };
  emit('geo');
}
