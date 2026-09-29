// Screen-level UI helpers: toasts, bottom-sheet dialogs, the green LCD
// ticker under the screen, and full-screen cinematics (evolve / hatch).
import { $, h, monImg, vibrate } from './util.js';
import { byId } from './data.js';

export function toast(msg, ms = 2600) {
  const box = $('#toasts');
  const t = h('div.toast', msg);
  box.append(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

let tickerTimer = 0;
let tickerIdle = '';
export function ticker(text, ms = 0) {
  const el = $('#ticker');
  clearTimeout(tickerTimer);
  el.textContent = text;
  if (ms) tickerTimer = setTimeout(() => (el.textContent = tickerIdle), ms);
  else tickerIdle = text;
}

export function flashLed() {
  const led = $('#bezel-led');
  led.classList.remove('flash');
  void led.offsetWidth;
  led.classList.add('flash');
}

export function pulseLens() {
  const lens = $('#lens');
  lens.classList.remove('pulse');
  void lens.offsetWidth;
  lens.classList.add('pulse');
}

// Bottom-sheet dialog inside the Pokédex screen. Returns close().
let openDialog = null;
export function dialog(content, { onClose } = {}) {
  closeDialog();
  const back = h('div.dialog-back');
  const box = h('div.dialog', content);
  back.append(box);
  back.addEventListener('click', e => { if (e.target === back) closeDialog(); });
  $('#screen').append(back);
  openDialog = { back, onClose };
  return closeDialog;
}

export function closeDialog() {
  if (!openDialog) return false;
  const { back, onClose } = openDialog;
  openDialog = null;
  back.remove();
  onClose?.();
  return true;
}
export const dialogOpen = () => !!openDialog;

export function confirm(text, okLabel = 'OK', danger = false) {
  return new Promise(res => {
    let answered = false;
    const done = v => { answered = true; closeDialog(); res(v); };
    dialog(h('div.col',
      h('div', { style: { fontWeight: 700, fontSize: '14px' } }, text),
      h('div.row', { style: { justifyContent: 'flex-end' } },
        h('button.btn.alt', { onclick: () => done(false) }, 'Cancel'),
        h('button.btn' + (danger ? '.danger' : '.go'), { onclick: () => done(true) }, okLabel)),
    ), { onClose: () => { if (!answered) res(false); } });
  });
}

export function prompt(text, value = '') {
  return new Promise(res => {
    const input = h('input.input', { value, maxlength: 12 });
    let answered = false;
    const done = v => { answered = true; closeDialog(); res(v); };
    dialog(h('form.col', { onsubmit: e => { e.preventDefault(); done(input.value); } },
      h('div', { style: { fontWeight: 700 } }, text),
      input,
      h('div.row', { style: { justifyContent: 'flex-end' } },
        h('button.btn.alt', { type: 'button', onclick: () => done(null) }, 'Cancel'),
        h('button.btn.go', { type: 'submit' }, 'Save')),
    ), { onClose: () => { if (!answered) res(null); } });
    setTimeout(() => input.focus(), 50);
  });
}

// Evolution cinematic: flicker between the old and new form, then reveal.
export function evolveCinematic(from, to, shiny) {
  return new Promise(res => {
    const a = monImg(from, { shiny });
    const b = monImg(to, { shiny });
    b.style.display = 'none';
    const msg = h('div.msg', `What? ${byId(from).name} is evolving!`);
    const wrap = h('div.cine', h('div.flick', a, b), msg);
    $('#screen').append(wrap);
    vibrate([60, 60, 60, 60, 200]);
    let i = 0;
    const iv = setInterval(() => {
      i++;
      const showB = i % 2 === 0 ? i > 10 : i > 14;
      a.style.display = showB ? 'none' : '';
      b.style.display = showB ? '' : 'none';
      if (i >= 18) {
        clearInterval(iv);
        wrap.firstChild.classList.remove('flick');
        a.remove();
        b.style.display = '';
        msg.textContent = `Congratulations! ${byId(from).name} evolved into ${byId(to).name}!`;
        flashLed();
        vibrate(200);
        const close = h('button.btn.gold', { onclick: () => { wrap.remove(); res(); } }, 'Awesome!');
        wrap.append(close);
      }
    }, 260);
  });
}

export function hatchCinematic(mon, isNew) {
  return new Promise(res => {
    const egg = h('div.egg.ready', { style: { width: '90px', height: '112px' } });
    const msg = h('div.msg', 'Oh? The egg is hatching!');
    const wrap = h('div.cine', egg, msg);
    $('#screen').append(wrap);
    vibrate([80, 80, 80, 80, 300]);
    setTimeout(() => {
      egg.replaceWith(monImg(mon.id, { shiny: mon.shiny }));
      wrap.append(h('div.flash-white'));
      msg.textContent = `${mon.shiny ? '✨ Shiny ' : ''}${byId(mon.id).name} hatched!${isNew ? ' New Pokédex entry!' : ''}`;
      flashLed();
      wrap.append(h('button.btn.gold', { onclick: () => { wrap.remove(); res(); } }, 'Welcome!'));
    }, 2200);
  });
}
