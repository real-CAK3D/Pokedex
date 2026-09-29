// Small shared helpers: DOM, randomness, geo math, sprite URLs.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// h('div.card#id', {onclick}, child, 'text', ...)
export function h(tag, attrs, ...kids) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9]*)(.*)$/i);
  const node = document.createElement(name || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') node.classList.add(part.slice(1));
    else node.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    kids.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const pad3 = n => String(n).padStart(3, '0');
export const now = () => Date.now();

// Deterministic 32-bit hash of any number of integers/strings.
export function hash(...parts) {
  let h1 = 0x9e3779b9;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h1 = Math.imul(h1 ^ s.charCodeAt(i), 0x85ebca6b);
      h1 = (h1 << 13) | (h1 >>> 19);
    }
    h1 = Math.imul(h1 ^ 0x2f, 0xc2b2ae35);
  }
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x7feb352d);
  h1 ^= h1 >>> 15;
  return h1 >>> 0;
}

// Seeded PRNG (mulberry32) so everyone at the same place+time sees the same spawns.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function weightedPick(items, weightOf, rand = Math.random) {
  let total = 0;
  for (const it of items) total += weightOf(it);
  let r = rand() * total;
  for (const it of items) {
    r -= weightOf(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

// Haversine distance in metres.
export function distM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Compass bearing from a to b, degrees clockwise from north.
export function bearing(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

export const angleDiff = (a, b) => ((a - b + 540) % 360) - 180;

export const uid =() => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites';
export const spriteUrl = (id, shiny) => `${SPRITES}/pokemon/${shiny ? 'shiny/' : ''}${id}.png`;
export const animUrl = (id, shiny) => `${SPRITES}/pokemon/other/showdown/${shiny ? 'shiny/' : ''}${id}.gif`;
export const artUrl = (id, shiny) => `${SPRITES}/pokemon/other/official-artwork/${shiny ? 'shiny/' : ''}${id}.png`;
export const itemUrl = name => `${SPRITES}/items/${name}.png`;

// <img> that tries the animated sprite first and falls back to the static one.
export function monImg(id, { shiny = false, anim = true, cls = '' } = {}) {
  const img = h('img' + (cls ? '.' + cls.split(' ').join('.') : ''), {
    alt: '', draggable: 'false', loading: 'lazy', decoding: 'async',
  });
  img.onerror = () => {
    img.onerror = null;
    img.src = spriteUrl(id, shiny);
  };
  img.src = anim ? animUrl(id, shiny) : spriteUrl(id, shiny);
  return img;
}

export const TYPE_COLORS = {
  normal: '#a8a77a', fire: '#ee8130', water: '#6390f0', electric: '#f7d02c', grass: '#7ac74c',
  ice: '#96d9d6', fighting: '#c22e28', poison: '#a33ea1', ground: '#e2bf65', flying: '#a98ff3',
  psychic: '#f95587', bug: '#a6b91a', rock: '#b6a136', ghost: '#735797', dragon: '#6f35fc',
  dark: '#705746', steel: '#b7b7ce', fairy: '#d685ad',
};

export function typeChip(t) {
  return h('span.type', { style: { background: TYPE_COLORS[t] || '#777' } }, t);
}

export function fmtKm(m) {
  return (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' km';
}

export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}
