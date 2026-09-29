// On-device game library: ROMs and their battery saves live in this
// browser's IndexedDB only. Nothing is uploaded anywhere.
const DB = 'pokedex-games';
let dbp = null;

function db() {
  dbp ||= new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('roms', { keyPath: 'id' });
      req.result.createObjectStore('saves', { keyPath: 'id' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => res(r?.result);
    t.onerror = () => rej(t.error);
  });
}

export const SYSTEMS = { gb: 'Game Boy', gbc: 'Game Boy Color', gba: 'Game Boy Advance', nds: 'Nintendo DS', n64: 'Nintendo 64' };

export function systemFor(name) {
  const ext = name.toLowerCase().split('.').pop();
  return { gb: 'gb', gbc: 'gbc', sgb: 'gb', gba: 'gba', nds: 'nds', z64: 'n64', n64: 'n64', v64: 'n64' }[ext] || null;
}

// Pull the first ROM out of a .zip (stored or deflate) using the browser's
// built-in DecompressionStream. Returns a File, or null if none found.
export async function unzipRom(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const base = name.split('/').pop();
    if (!systemFor(base)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = buf.subarray(start, start + csize);
    let out;
    if (method === 0) out = data;
    else if (method === 8) out = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else continue;
    return new File([out], base);
  }
  return null;
}

export const listRoms =() => tx('roms', 'readonly', s => s.getAll());
export const getRom = id => tx('roms', 'readonly', s => s.get(id));
export const deleteRom = async id => {
  await tx('roms', 'readwrite', s => s.delete(id));
  await tx('saves', 'readwrite', s => s.delete(id));
};

export async function addRom(file, system) {
  const rom = {
    id: file.name.replace(/\.[^.]+$/, '').replace(/[^\w\- ().,']/g, '').slice(0, 80),
    name: file.name.replace(/\.[^.]+$/, ''),
    system,
    size: file.size,
    added: Date.now(),
    blob: file,
  };
  await tx('roms', 'readwrite', s => s.put(rom));
  return rom;
}

export const getSave = async id => (await tx('saves', 'readonly', s => s.get(id)))?.data || null;
export const putSave = (id, data) => tx('saves', 'readwrite', s => s.put({ id, data, t: Date.now() }));
