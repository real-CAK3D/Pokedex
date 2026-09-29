// Renders the app icon to PNG (192 & 512) with no dependencies.
// Usage: node tools/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}

// Draws the icon at `size` px, centred on a W x H canvas (background `bg`
// fills the rest). With round=true the icon is clipped to a circle.
function render(size, W = size, H = size, bg = null, round = false) {
  const px = Buffer.alloc(W * H * 4);
  const u = size / 64; // design grid matches icon.svg
  const ox = (W - size) / 2, oy = (H - size) / 2;
  const set = (x, y, [r, g, b]) => { const i = (y * W + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; };
  const circle = (cx, cy, rad) => (x, y) => (x - cx * u) ** 2 + (y - cy * u) ** 2 <= (rad * u) ** 2;
  const rect = (x0, y0, w, hh) => (x, y) => x >= x0 * u && x < (x0 + w) * u && y >= y0 * u && y < (y0 + hh) * u;
  const inside = round ? circle(32, 32, 32) : (x, y) => x >= 0 && y >= 0 && x < size && y < size;
  if (bg) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, bg);
  const layers = [
    [inside, [215, 38, 61]],
    [circle(22, 22, 13), [255, 255, 255]],
    [circle(22, 22, 10), [30, 167, 232]],
    [circle(18.5, 18.5, 3), [191, 243, 255]],
    [circle(42, 13, 4.5), [34, 34, 34]], [circle(42, 13, 3.5), [255, 75, 75]],
    [circle(51, 13, 4.5), [34, 34, 34]], [circle(51, 13, 3.5), [255, 216, 74]],
    [rect(9, 39, 46, 18), [34, 34, 34]], [rect(10, 40, 44, 16), [222, 222, 222]],
    [rect(14, 43, 36, 10), [155, 188, 15]],
  ];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!inside(x + 0.5, y + 0.5)) continue;
    for (const [hit, col] of layers) if (hit(x + 0.5, y + 0.5)) set(Math.floor(x + ox), Math.floor(y + oy), col);
  }
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const s of [192, 512]) writeFileSync(new URL(`../img/icon-${s}.png`, import.meta.url), render(s));

// Android launcher icons + splash screens (only if the Capacitor project exists)
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { imageSize } from './png-size.mjs';
const res = new URL('../android/app/src/main/res/', import.meta.url);
if (existsSync(res)) {
  const dens = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [d, s] of Object.entries(dens)) {
    writeFileSync(new URL(`mipmap-${d}/ic_launcher.png`, res), render(s));
    writeFileSync(new URL(`mipmap-${d}/ic_launcher_round.png`, res), render(s, s, s, null, true));
    rmSync(new URL(`mipmap-${d}/ic_launcher_foreground.png`, res), { force: true });
  }
  // use the plain PNG icons rather than Capacitor's adaptive placeholder
  rmSync(new URL('mipmap-anydpi-v26/', res), { recursive: true, force: true });
  for (const dir of readdirSync(res).filter(n => n.startsWith('drawable'))) {
    const f = new URL(`${dir}/splash.png`, res);
    if (!existsSync(f)) continue;
    const { width, height } = imageSize(f);
    const s = Math.round(Math.min(width, height) * 0.35);
    writeFileSync(f, render(s, width, height, [20, 22, 31]));
  }
  console.log('android icons + splash written');
}
console.log('icons written');
