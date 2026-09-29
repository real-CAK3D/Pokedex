// Debug reports for your own PC. Only active while a PC shelf is connected
// (GAME tab): errors and the key steps of installing/launching games are sent
// to that shelf's /log endpoint, so problems on the phone can be diagnosed.
const SHELF_KEY = 'pokedex-rom-shelf';
let queue = [];
let timer = 0;

function shelf() {
  try { return localStorage.getItem(SHELF_KEY); } catch { return null; }
}

export function dlog(msg, src = 'app') {
  if (!shelf()) return;
  queue.push({ t: Date.now(), src, msg: String(msg).slice(0, 1500) });
  if (queue.length > 200) queue = queue.slice(-200);
  clearTimeout(timer);
  timer = setTimeout(flush, 1500);
}

async function flush() {
  const base = shelf();
  if (!base || !queue.length) return;
  const batch = queue;
  queue = [];
  try {
    await fetch(base + 'log', { method: 'POST', body: JSON.stringify(batch), headers: { 'Content-Type': 'text/plain' } });
  } catch {
    queue = batch.concat(queue).slice(-200); // try again later
  }
}

const fmt = a => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'object' ? (() => { try { return JSON.stringify(a); } catch { return String(a); } })() : String(a));

export function installDebugLog() {
  window.addEventListener('error', e => dlog(`error: ${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', e => dlog(`unhandled rejection: ${fmt(e.reason)}`));
  const orig = console.error.bind(console);
  console.error = (...a) => { dlog('console.error: ' + a.map(fmt).join(' ')); orig(...a); };
  window.addEventListener('pagehide', flush);

  const native = !!window.Capacitor?.isNativePlatform?.();
  dlog(`boot: ${native ? 'android app' : 'website'} | ${navigator.userAgent} | ${screen.width}x${screen.height}`);
  navigator.storage?.estimate?.().then(e => dlog(`storage: used ${(e.usage / 1048576).toFixed(1)} MB of ${(e.quota / 1048576).toFixed(0)} MB`)).catch(() => {});
  navigator.storage?.persisted?.().then(p => dlog(`storage persisted: ${p}`)).catch(() => {});
}
