// Width/height of a PNG file (reads the IHDR chunk).
import { readFileSync } from 'node:fs';

export function imageSize(file) {
  const b = readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
