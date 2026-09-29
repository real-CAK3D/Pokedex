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

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const u = size / 64; // design grid matches icon.svg
  const set = (x, y, [r, g, b]) => { const i = (y * size + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; };
  const circle = (cx, cy, rad) => (x, y) => (x - cx * u) ** 2 + (y - cy * u) ** 2 <= (rad * u) ** 2;
  const rect = (x0, y0, w, hh) => (x, y) => x >= x0 * u && x < (x0 + w) * u && y >= y0 * u && y < (y0 + hh) * u;
  const layers = [
    [() => true, [215, 38, 61]],
    [circle(22, 22, 13), [255, 255, 255]],
    [circle(22, 22, 10), [30, 167, 232]],
    [circle(18.5, 18.5, 3), [191, 243, 255]],
    [circle(42, 13, 4.5), [34, 34, 34]], [circle(42, 13, 3.5), [255, 75, 75]],
    [circle(51, 13, 4.5), [34, 34, 34]], [circle(51, 13, 3.5), [255, 216, 74]],
    [rect(9, 39, 46, 18), [34, 34, 34]], [rect(10, 40, 44, 16), [222, 222, 222]],
    [rect(14, 43, 36, 10), [155, 188, 15]],
  ];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    for (const [hit, col] of layers) if (hit(x + 0.5, y + 0.5)) set(x, y, col);
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const s of [192, 512]) writeFileSync(new URL(`../img/icon-${s}.png`, import.meta.url), render(s));
console.log('icons written');
