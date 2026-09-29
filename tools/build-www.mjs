// Copies the web app into www/ for the Capacitor Android build.
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const out = new URL('../www/', import.meta.url);
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const p of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'data', 'img', 'games', 'vendor']) {
  cpSync(new URL('../' + p, import.meta.url), new URL(p, out), { recursive: true });
}
console.log('www/ ready');
