// Reduced motion is checked live: the canvas follows reduceMotion (updated below when the
// setting changes), and opening or closing a project checks motionPref.matches each time.
const motionPref = matchMedia('(prefers-reduced-motion: reduce)');
let reduceMotion = motionPref.matches;
const root = document.documentElement;

// ---------- the dither ----------
// Things develop in, and the tiles break up, through an ordered (Bayer) dither: an 8px tile of 2px
// squares, filled in this order. Pattern n shows the first n squares of the 16. They're drawn here
// as tiny pictures, square for square on the screen's own pixels. (styles.css spells the even ones
// out as SVG, for before this runs. But each SVG costs the browser a little document of its own,
// built the first time it's used, which held up the first click, and they're slower to draw.)
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const DITHER_TILE = 8;                     // px, so 2px squares
const dither = [];                         // dither[n]: pattern n, from 0 to 16, as a mask image

function drawDither() {
  const scale = devicePixelRatio || 1;
  const size = Math.max(4, Math.round(DITHER_TILE * scale));
  const edge = k => Math.round(k * size / 4);   // where the squares start and end, on whole pixels
  const pad = document.createElement('canvas');
  pad.width = pad.height = size;
  const g = pad.getContext('2d');
  for (let n = 0; n <= 16; n++) {
    g.clearRect(0, 0, size, size);
    BAYER4.forEach((order, i) => {
      const x = i % 4, y = i >> 2;
      if (order < n) g.fillRect(edge(x), edge(y), edge(x + 1) - edge(x), edge(y + 1) - edge(y));
    });
    dither[n] = `url("${pad.toDataURL()}")`;
  }
  for (let n = 2; n < 16; n += 2) root.style.setProperty(`--dither-${n}`, dither[n]);
  // Zooming, or moving to a screen with smaller or bigger pixels, draws them again to suit.
  matchMedia(`(resolution: ${scale}dppx)`).addEventListener('change', drawDither, { once: true });
}
drawDither();

// With a mouse, a card's demo plays while it's hovered. On a touch screen there's no hovering, so
// it plays when it's tapped instead, and so it does with reduced motion on, so nothing moves until
// it's asked to. index.html sets html.tap first; this keeps it up to date.
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
let tap = root.classList.contains('tap');
function checkTap() {
  tap = reduceMotion || !finePointer.matches;
  root.classList.toggle('tap', tap);
}
checkTap();

// ---------- view switching ----------

const views = [...document.querySelectorAll('.view')];
const navLinks = [...document.querySelectorAll('.dock a')];
const dock = document.querySelector('.dock');
const aliases = { work: 'home', about: 'contact' };   // old links still land somewhere sensible

function show(id) {
  id = aliases[id] || id;
  const index = Math.max(0, views.findIndex(v => v.id === id));   // anything else, a project's address included, is home
  views.forEach((v, i) => v.classList.toggle('is-active', i === index));
  navLinks.forEach((a, i) => {
    if (i === index) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  dock.style.setProperty('--i', index);
  window.scrollTo(0, 0);
}

show(location.hash.slice(1) || 'home');   // after that, route() at the bottom follows the address

// ---------- project cards: hover, keyboard focus and open ----------
// A card lights up while the mouse is over it or it has keyboard focus, and stays hot while its
// write-up is open or its demo is playing. styles.css warms the card, and the cloud background
// around it heats up too (below).

const projectList = document.querySelector('.projects');
const home = document.getElementById('home');

// Without this script each card's title is a link down to its write-up. With it, the title
// becomes a button that opens the write-up in place. Each card's demo gets a play button too,
// which only shows on touch screens (styles.css).
const cards = [...projectList.querySelectorAll('.project')].map(el => {
  const link = el.querySelector('a.card-open');
  const id = link.getAttribute('href').slice(1);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'card-open';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', id);
  button.setAttribute('aria-describedby', link.getAttribute('aria-describedby'));
  button.append(...link.childNodes);
  link.replaceWith(button);

  const demo = el.querySelector('.demo');
  const video = demo.querySelector('video');
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'demo-play';
  play.setAttribute('aria-pressed', 'false');
  const label = document.createElement('span');
  label.className = 'vh';
  label.textContent = `play the ${button.textContent.trim()} demo`;
  play.append(label);
  demo.append(play);

  return {
    el, button, panel: document.getElementById(id), demo, video, play,
    still: demo.querySelector('.still'), cardTitle: el.querySelector('.card-title'),
    label: el.querySelector('.card-label'), head: el.querySelector('.card-head'), about: el.querySelector('.card-about'),
    start: parseFloat(video.dataset.start) || 0,   // the second the still was taken at
    lit: false, open: false, playing: false,
    carried: false,   // whether its clip is off flying into a write-up, so it's left playing
    heat: 0, target: 0,   // how hot the card is, and heading to: warms the clouds around it
  };
});
let hovered = null;        // the card under the mouse
let focused = null;        // the card whose button has keyboard focus
let openCard = null;       // the card whose write-up is open
let reading = false;       // whether a write-up has taken the tiles' place
const homeShown = () => home.classList.contains('is-active');   // not switched away to the contact view

// ---------- demos ----------
// Each card has a still frame over a short muted clip. Playing it dissolves the still away
// through the dither (styles.css), once the clip's actually moving; stopping it develops the
// still back in, and the clip goes back to where the still was taken, ready for next time.

function playDemo(card) {
  if (card.playing || card.demo.classList.contains('no-clip')) return;
  const { video } = card;
  card.playing = true;
  clearTimeout(card.rewind);
  card.play.setAttribute('aria-pressed', 'true');
  card.demo.classList.add('is-loading');
  // The clips aren't loaded until they're first played (preload="none"), so the first time, it
  // goes to the still's second once the browser knows how long the clip is.
  if (video.readyState) { if (video.currentTime < card.start) video.currentTime = card.start; }
  else video.addEventListener('loadedmetadata', () => { if (video.currentTime < card.start) video.currentTime = card.start; }, { once: true });
  video.play()?.catch(error => {
    if (error.name === 'AbortError') return;   // stopped again before it started: nothing wrong
    if (error.name === 'NotSupportedError') card.demo.classList.add('no-clip');
    stopDemo(card);
    relight();
  });
}

function stopDemo(card) {
  if (!card.playing) return;
  card.playing = false;
  card.video.pause();
  card.play.setAttribute('aria-pressed', 'false');
  card.demo.classList.remove('is-playing', 'is-loading');
  // Back to the still's frame, once the still has developed back in over it.
  clearTimeout(card.rewind);
  card.rewind = setTimeout(() => {
    if (!card.playing && card.video.readyState) card.video.currentTime = card.start;
  }, 300);
}

for (const card of cards) {
  const { video, demo } = card;
  video.addEventListener('playing', () => {
    if (!card.playing) { video.pause(); return; }
    demo.classList.add('is-playing');
    demo.classList.remove('is-loading');
  });
  video.addEventListener('waiting', () => { if (card.playing) demo.classList.add('is-loading'); });
  // Neither of the clip's files would load: the still stays, and the tag says so.
  [...video.querySelectorAll('source')].pop()?.addEventListener('error', () => {
    demo.classList.add('no-clip');
    stopDemo(card);
    relight();
  });
}

// On a touch screen, a demo that's played stops again once it's mostly scrolled out of sight.
// (With a mouse, it stops as soon as the mouse leaves the card.)
const demoSight = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const card = cards.find(card => card.demo === entry.target);
    if (tap && card.playing && !card.carried && entry.intersectionRatio < 0.5) { stopDemo(card); relight(); }
  }
}, { threshold: [0, 0.5] });
cards.forEach(card => demoSight.observe(card.demo));

function relight() {
  for (const card of cards) {
    card.lit = !reading && (card === hovered || card === focused);   // the tiles are out of sight while reading
    if (!tap && !card.carried) {   // with a mouse, a lit card's demo plays, and only a lit card's
      if (card.lit) playDemo(card);
      else stopDemo(card);
    }
    card.el.classList.toggle('is-lit', card.lit || card.playing);
    card.el.classList.toggle('is-open', card.open);
    // A card stays hot while its demo's away, and cools once it's back on the tile.
    const away = card.el.classList.contains('is-away');
    card.target = !reading && (card.lit || card.open || card.playing || away) ? 1 : 0;
    if (reduceMotion) card.heat = card.target;   // no fading in or out
  }
  invalidate();
}

const cardFor = node => cards.find(card => card.el.contains(node)) || null;

// Mouse and pen only. On a touch screen a tap just opens the card, or plays its demo.
// `pointerover` rather than `pointermove`: when the page scrolls a new card under a mouse that
// isn't moving, the browser fires `pointerover` for it but no `pointermove`.
projectList.addEventListener('pointerover', e => {
  const card = e.pointerType === 'touch' ? null : cardFor(e.target);
  if (card !== hovered) { hovered = card; relight(); }
});
projectList.addEventListener('pointerleave', () => {
  if (hovered) { hovered = null; relight(); }
});

// Keyboard focus only. A click focuses the button too, but the mouse is already lighting that card.
projectList.addEventListener('focusin', e => {
  focused = e.target.matches(':focus-visible') ? cardFor(e.target) : null;
  relight();
});
projectList.addEventListener('focusout', () => {
  focused = null;
  relight();
});

// ---------- cloud halftone background ----------
// Venus is wrapped in thick clouds, so the background is a halftone of them: a grid of
// tiny square dots whose brightness follows slowly drifting, churning cloud cover.
// Around a lit project card the clouds heat up: they thicken and glow amber.

const canvas = document.getElementById('clouds');
const ctx = canvas.getContext('2d');
const PITCH = 7;                          // a dot every 7px…
const DOT = 4;                            // …each one 4px square
const NODE = 3;                           // the cloud is measured every 3rd dot and blended in between
const SHADES = [0, 7, 13, 20, 27, 33, 40, 47];   // dot alpha out of 255. Clouds use the first six (~13% at most); heat unlocks the last two
const FRAME_MS = 100;                     // the clouds move slowly, so 10fps is plenty
const START = Math.random() * 1000;       // different clouds on every visit

const COOL = [239, 233, 225];             // warm white, same as the text
const HOT = [255, 166, 88];               // the orange of the glow behind the name
const HEAT_REACH = 120;                   // how far the warmth spreads past a card's edge, in px
const HEAT_LIFT = 0.45;                   // how much thicker the cloud gets at full heat

const fade = t => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;

// Turns up to three integers into a repeatable random number from 0 to 1.
function hash(i, j, k = 0) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1440662683)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Value noise: random values on a 3D grid, smoothly blended in between. Returns 0..1.
function noise(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const u = fade(x - i), v = fade(y - j), w = fade(z - k);
  return mix(
    mix(mix(hash(i, j, k), hash(i + 1, j, k), u), mix(hash(i, j + 1, k), hash(i + 1, j + 1, k), u), v),
    mix(mix(hash(i, j, k + 1), hash(i + 1, j, k + 1), u), mix(hash(i, j + 1, k + 1), hash(i + 1, j + 1, k + 1), u), v),
    w
  );
}

// How thick the cloud is at a point, 0..1. One noise unit is about 260px.
function cloud(x, y, t) {
  // The whole sky drifts slowly left and a little downward.
  x = x / 260 + t * 0.03;
  y = y / 260 - t * 0.012;
  // A broad, slow warp bends the coordinates so the clouds curl instead of sitting in round blobs.
  const bendX = noise(x * 0.5, y * 0.5, t * 0.01) - 0.5;
  const bendY = noise(x * 0.5 + 31, y * 0.5 - 17, t * 0.01 + 7) - 0.5;
  x += bendX * 1.4;
  y += bendY * 1.4;
  // Three layers, each finer and quicker to change shape, so the clouds churn as they drift.
  const z = t * 0.04;
  return 0.6 * noise(x, y, z) + 0.28 * noise(x * 2.1 + 5, y * 2.1 - 9, z * 1.4) + 0.12 * noise(x * 4.3 - 3, y * 4.3 + 7, z * 1.9);
}

// Each dot's shade goes into a tiny canvas (one pixel per dot) that is scaled up 7×,
// then trimmed down to 4×4 squares by a repeating tile.
const cells = document.createElement('canvas');
const cellCtx = cells.getContext('2d');
const tile = document.createElement('canvas');
tile.width = tile.height = PITCH;
tile.getContext('2d').fillRect(1, 1, DOT, DOT);
const dots = ctx.createPattern(tile, 'repeat');

let cols, rows, nodeCols, nodeRows, field, image;
let grain;                                // each dot's own random dimming, which never changes
let colNode, colFrac, rowNode, rowFrac;   // which measured points each column and row lies between, and how far along

function resize() {
  // One canvas pixel per CSS pixel; `image-rendering: pixelated` keeps the dots sharp on hi-dpi screens.
  // At least 1×1, since a canvas with no size (a hidden window, say) can't make image data.
  canvas.width = Math.max(1, canvas.clientWidth);
  canvas.height = Math.max(1, canvas.clientHeight);
  cols = Math.ceil(canvas.width / PITCH);
  rows = Math.ceil(canvas.height / PITCH);
  nodeCols = Math.floor((cols - 1) / NODE) + 2;
  nodeRows = Math.floor((rows - 1) / NODE) + 2;
  field = new Float32Array(nodeCols * nodeRows);
  cells.width = cols;
  cells.height = rows;
  image = cellCtx.createImageData(cols, rows);
  grain = new Float64Array(cols * rows);
  for (let j = 0, n = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++, n++) grain[n] = 0.8 + 0.2 * hash(i, j);
  }
  [colNode, colFrac] = between(cols);
  [rowNode, rowFrac] = between(rows);
}

function between(count) {
  const node = new Int32Array(count), frac = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    node[i] = Math.floor(i / NODE);
    frac[i] = (i % NODE) / NODE;
  }
  return [node, frac];
}

// Samples the cloud at every NODE-th dot; paint() blends between the samples.
function measure(t) {
  for (let b = 0, n = 0; b < nodeRows; b++) {
    for (let a = 0; a < nodeCols; a++, n++) field[n] = cloud(a * NODE * PITCH, b * NODE * PITCH, t);
  }
}

// Where the warm cards are on screen, and how hot each one is.
function heatSources() {
  const sources = [];
  for (const card of cards) {
    if (!card.heat) continue;
    const r = card.el.getBoundingClientRect();
    if (r.width) sources.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, heat: card.heat });
  }
  return sources;
}

// How far each of `count` dots in a line is from the span lo..hi, squared (0 inside it).
function reach(count, lo, hi) {
  const d2 = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const at = i * PITCH + 3, d = Math.max(lo - at, 0, at - hi);
    d2[i] = d * d;
  }
  return d2;
}

const REACH2 = HEAT_REACH * HEAT_REACH;

function paint() {
  dirty = false;
  // How warm the air is: full heat over a card, fading out HEAT_REACH px past its edge. Each
  // card's distance from every column and every row is worked out once, and a row out of a
  // card's reach doesn't look at it.
  const sources = heatSources().map(s => ({ heat: s.heat, dx2: reach(cols, s.left, s.right), dy2: reach(rows, s.top, s.bottom) }));
  const data = image.data;
  for (let j = 0, k = 0, c = 0; j < rows; j++) {
    const b = rowNode[j], fy = rowFrac[j];
    const near = sources.filter(s => s.dy2[j] < REACH2);
    for (let i = 0; i < cols; i++, k += 4, c++) {
      const a = colNode[i], fx = colFrac[i];
      const n = b * nodeCols + a;
      const thickness = mix(
        mix(field[n], field[n + 1], fx),
        mix(field[n + nodeCols], field[n + nodeCols + 1], fx),
        fy
      );
      let heat = 0;
      for (const s of near) {
        const d2 = s.dx2[i] + s.dy2[j];
        if (d2 < REACH2) heat = Math.max(heat, s.heat * fade(1 - Math.sqrt(d2) / HEAT_REACH));
      }
      // Thin cloud leaves clear patches of sky. The shades step like a halftone print, and
      // each dot is dimmed by a random 0–20% (its grain) so the edges between steps break up a
      // little. Heat thickens the cloud, so near a lit card dots appear even in clear sky.
      const density = fade(Math.min(1, Math.max(0, (thickness - 0.27) / 0.44))) + heat * HEAT_LIFT;
      const level = Math.floor(6 * density * grain[c]);
      if (heat) {
        data[k] = mix(COOL[0], HOT[0], heat);
        data[k + 1] = mix(COOL[1], HOT[1], heat);
        data[k + 2] = mix(COOL[2], HOT[2], heat);
        data[k + 3] = SHADES[Math.min(level, 5 + Math.round(2 * heat))];
      } else {
        data[k] = COOL[0];
        data[k + 1] = COOL[1];
        data[k + 2] = COOL[2];
        data[k + 3] = SHADES[Math.min(level, 5)];
      }
    }
  }
  cellCtx.putImageData(image, 0, 0);

  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(cells, 0, 0, cols * PITCH, rows * PITCH);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = dots;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// Eases each card's heat toward its target. The easing goes by elapsed time, not frames, so it
// takes just as long on a slow or throttled screen. Heats up quickly, cools down slowly. Returns
// true while any card's heat is still changing.
let lastFrame = performance.now();
function warm(now) {
  const dt = Math.max(0, now - lastFrame) / 1000;
  lastFrame = now;
  let changing = false;
  for (const card of cards) {
    if (card.heat === card.target) continue;
    card.heat += (card.target - card.heat) * (1 - Math.exp(-dt / (card.target > card.heat ? 0.2 : 0.45)));
    if (Math.abs(card.target - card.heat) < 0.004) card.heat = card.target;
    changing = true;
  }
  return changing;
}

// The clouds only move 10 times a second, but while a card is heating or cooling (or a warm
// card scrolls) the dots repaint every frame so the glow stays smooth.
let last = 0;
let dirty = false;
let ticking = false;   // whether tick() is running; it stops for reduced motion
function tick(now) {
  if (reduceMotion) { ticking = false; return; }
  requestAnimationFrame(tick);
  if (warm(now)) dirty = true;
  if (now - last >= FRAME_MS) {
    last = now - ((now - last) % FRAME_MS);
    measure(START + now / 1000);
    paint();
  } else if (dirty) paint();
}

// Asks for a repaint. With reduced motion there's no tick, so it schedules one itself.
function invalidate() {
  if (dirty) return;
  dirty = true;
  if (reduceMotion) requestAnimationFrame(paint);
}

const drawNow = () => { measure(START + (reduceMotion ? 0 : performance.now() / 1000)); paint(); };
resize();
drawNow();
// Watching the canvas, not the window: a scrollbar coming or going changes its width too.
new ResizeObserver(() => { resize(); drawNow(); }).observe(canvas);
// A flight is measured as it sets off, so if the page reflows under it, it lands at once.
let lastWidth = innerWidth;
window.addEventListener('resize', () => {
  placeOrigin();
  if (innerWidth !== lastWidth) { lastWidth = innerWidth; flight?.finish(); }
});
// A warm card that scrolls with the page takes its glow with it.
const followCards = () => { if (cards.some(card => card.heat)) invalidate(); };
window.addEventListener('scroll', followCards, { passive: true });

// If reduced motion is switched on or off while the page is open, everything follows: the canvas
// stops or starts, the demos stop and switch between hover and tap, and the name's heat haze
// stills or wavers again. Plugging in a mouse, or a tablet's keyboard, switches them too.
motionPref.addEventListener('change', () => {
  reduceMotion = motionPref.matches;
  cards.forEach(stopDemo);
  checkTap();
  if (reduceMotion) {
    hazeWaves.forEach(({ wave }) => wave.remove());
    dirty = false;   // so the repaint below gets scheduled, now that tick() has stopped
    relight();
    drawNow();
  } else {
    hazeWaves.forEach(({ wave, parent }) => wave.isConnected || parent.append(wave));
    if (!ticking) { ticking = true; requestAnimationFrame(tick); }
    relight();
  }
});
finePointer.addEventListener('change', () => {
  cards.forEach(stopDemo);
  checkTap();
  relight();
});

// ---------- heat haze on the name ----------
// With reduced motion the haze holds still. They're kept, so it can waver again if that changes.

const hazeWaves = [...document.querySelectorAll('#heat-haze animate')].map(wave => ({ wave, parent: wave.parentNode }));
if (reduceMotion) hazeWaves.forEach(({ wave }) => wave.remove());

// ---------- project details ----------
// Each card opens its write-up in the tiles' place, as the page itself rather than a pop-up over
// it: the other tiles get out of the way (scatter, below), the card's picture and title fly into
// the write-up (flights, below), and the rest of it develops in through a dither, the pieces
// nearest the card first, so it reads as heat spreading out from the card. Its "← all projects"
// button, or Esc, closes it, and it all runs backwards.
//
// Opening scrolls the write-up into view, smoothly. Closing scrolls back to the card, smoothly,
// rather than leaving the page wherever the write-up's going left it.
//
// The closed write-ups are hidden with hidden="until-found": they take no room, but the
// browser's find-in-page still searches them, and finding something in one opens it.
// Without this script they all show, one after another, and the cards jump down to them.
//
// Opening, swapping and closing take a few steps, with short waits between them for the
// animations. What's open changes straight away; the picture catches up. Every open or close
// bumps `generation`, and a step that finds it's changed while it waited stops there, so
// clicking around quickly always ends on the last thing clicked.

const details = document.getElementById('details');
const frame = details.querySelector('.details-frame');
const contactTitle = document.getElementById('contact-title');
const DEV_PARTS = ':scope > .detail-head, :scope > .detail-title, .detail-grid > :not(.detail-figure), .detail-figure > *, :scope > h3, :scope > .highlights, :scope > .detail-foot';
let generation = 0;
const wait = ms => new Promise(done => setTimeout(done, ms));
const cardById = id => cards.find(card => card.panel.id === id) || null;
const shownCard = () => cards.find(card => !card.panel.hasAttribute('hidden')) || null;

for (const card of cards) {
  card.title = card.panel.querySelector('.detail-title');
  card.pageLabel = card.panel.querySelector('.detail-label');
  card.full = card.panel.querySelector('.demo-full');   // the write-up's player
  card.panel.querySelectorAll(DEV_PARTS).forEach(el => el.classList.add('dev'));   // the pieces that develop in
  card.panel.setAttribute('hidden', 'until-found');
  card.panel.addEventListener('beforematch', () => openDetail(card, { instant: true, focus: false, scroll: false }));
}
details.classList.add('is-ready');   // styles.css keeps the panel out of sight until now, so the write-ups don't flash up

// The first time a write-up shows, the browser has to lay it all out, which holds up the first
// frame of its opening. So once the page has settled, each write-up is laid out once in the
// background, one per idle moment, and hidden again before anything's drawn. Hidden this way it
// keeps that layout, so opening it later starts straight away.
const whenIdle = window.requestIdleCallback || (fn => setTimeout(fn, 200));
document.fonts.ready.then(() => {
  const queue = [...cards];
  const next = () => {
    const card = queue.shift();
    if (!card) return;
    if (!openCard && !reading && !flight && !scattered && card.panel.hasAttribute('hidden')) {
      card.panel.removeAttribute('hidden');
      void card.panel.offsetHeight;
      card.panel.setAttribute('hidden', 'until-found');
    }
    whenIdle(next);
  };
  whenIdle(next);
});

// Keeps the address on the open project, without adding to the history or jumping the page to
// it. So Back leaves the page as usual, and Back from the contact view comes back to the
// project that was open.
function setHash(hash) {
  try { history.replaceState(history.state, '', hash || location.pathname + location.search); } catch {}
}

// The panel's height right now. Stops it growing or shrinking, if it was, so it can start again
// from here.
function heightNow() {
  const height = frame.getBoundingClientRect().height;
  frame.getAnimations().forEach(a => { if (a.id === 'resize') a.cancel(); });
  return height;
}

// Grows or shrinks the panel from one height to another, then lets it fit its write-up again.
function grow(from, to, ms) {
  if (Math.abs(from - to) < 1) return Promise.resolve(true);
  const resize = frame.animate({ height: [`${from}px`, `${to}px`] },
    { id: 'resize', duration: ms, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' });
  return resize.finished.then(() => { resize.cancel(); return true; }, () => false);
}

// While the page scrolls back to a card after its write-up closes, the page is held at its old
// height, so taking the write-up away doesn't cut the scroll short with a jump. This lets go.
function releaseHeight() {
  document.body.style.minHeight = '';
}

// Scrolls the page to `y`, and resolves once it's there.
function scrollToY(y, fast) {
  if (Math.abs(window.scrollY - y) < 1) return Promise.resolve();
  if (fast) { window.scrollTo(0, y); return Promise.resolve(); }
  return new Promise(done => {
    const finish = () => {
      clearTimeout(timer);
      window.removeEventListener('scrollend', finish);
      done();
    };
    const timer = setTimeout(finish, 900);   // for browsers without `scrollend`, or if it's cut short
    window.addEventListener('scrollend', finish);
    window.scrollTo({ top: y, behavior: 'smooth' });
  });
}

// Hides a write-up, and stops anything playing in it.
function hidePanel(card) {
  const panel = card.panel;
  if (!panel.hasAttribute('hidden')) {
    panel.querySelectorAll('video').forEach(video => { video.pause(); video.muted = video.defaultMuted; });   // a flight may have muted it
    panel.querySelectorAll('iframe').forEach(embed => embed.setAttribute('src', embed.getAttribute('src')));   // reloading an embed stops it
  }
  panel.classList.remove('is-developing', 'is-leaving');
  panel.setAttribute('hidden', 'until-found');
}

// Dissolves a write-up, all at once, in 0.12s (styles.css).
function leave(card) {
  card.panel.classList.remove('is-developing');
  card.panel.classList.add('is-leaving');
}

// Which card is open (or none), for the cards, their buttons and the heat.
function markOpen(card) {
  openCard = card;
  for (const other of cards) {
    other.open = other === card;
    other.button.setAttribute('aria-expanded', String(other.open));
  }
  relight();
}

// Where a write-up develops in from: the top of the panel, in line with the middle of the open card.
function placeOrigin() {
  if (!openCard) return;
  const box = details.getBoundingClientRect();
  const anchor = openCard.el.getBoundingClientRect();
  const mid = anchor.left + anchor.width / 2;
  details.style.setProperty('--origin-x', `${Math.round(Math.min(box.width - 16, Math.max(16, mid - box.left)))}px`);
}

// Starts the pieces of a write-up developing in. Each waits a little longer the further it is
// from the origin: 30ms, plus 0.4ms for each pixel away, up to 0.29s in all (and `after` ms more).
function develop(panel, after = 0) {
  const box = details.getBoundingClientRect();
  const ox = box.left + (parseFloat(details.style.getPropertyValue('--origin-x')) || box.width / 2);
  const oy = box.top;
  // All measured first, then all set, so the page is only laid out the once.
  const parts = [...panel.querySelectorAll('.dev')];
  const delays = parts.map(el => {
    const r = el.getBoundingClientRect();
    const dx = Math.max(r.left - ox, 0, ox - r.right);
    const dy = Math.max(r.top - oy, 0, oy - r.bottom);
    return Math.round(after + 30 + Math.min(260, Math.hypot(dx, dy) * 0.4));
  });
  parts.forEach((el, i) => el.style.setProperty('--d', `${delays[i]}ms`));
  const running = panel.classList.contains('is-developing');
  panel.classList.remove('is-developing', 'is-leaving');
  panel.querySelectorAll('.is-landed').forEach(el => el.classList.remove('is-landed'));   // flown in last time
  if (running) void panel.offsetWidth;   // so the animation starts over
  panel.classList.add('is-developing');
  clearTimeout(panel.devTimer);
  panel.devTimer = setTimeout(() => panel.classList.remove('is-developing'), 1200);
}

// Shows a card's write-up, developing it in if `animate` (starting `after` ms from now).
function reveal(card, animate, after = 0) {
  const panel = card.panel;
  panel.removeAttribute('hidden');
  panel.classList.remove('is-leaving');
  if (animate) develop(panel, after);
  else panel.classList.remove('is-developing');
}

// Where to scroll the page to bring a card back into sight: its middle in the middle of the screen
// above the dock (or its top near the top, if it's taller than that). It can only go as far down
// as the page will reach once it's `gone` px shorter. Null if the card's in sight already.
function backTo(card, gone) {
  const lowest = Math.max(0, root.scrollHeight - gone - innerHeight);
  const box = card.el.getBoundingClientRect();
  const room = innerHeight - 96;             // the screen above the dock
  if (box.top >= 0 && box.bottom <= room && window.scrollY <= lowest) return null;
  const y = box.height > room
    ? box.top + window.scrollY - 24
    : box.top + window.scrollY - (room - box.height) / 2;
  return Math.round(Math.min(lowest, Math.max(0, y)));
}

// ---------- flights ----------
// A tile opens its write-up in the grid's place, and the tile's picture, title and label fly
// from the tile into place in the write-up. On the way the picture uncrops, from filling the tile
// to the whole frame in the player, and the title and label grow into the write-up's, changing over
// from one to the other through the dither. The dark plate under the title rides along with it and
// breaks up as the title changes over. Closing flies them home again. What flies is a stand-in
// (a "flyer") over the page, while the real ones at either end are hidden. If the tile's demo is
// playing, the clip itself flies, still playing, and the write-up's player carries on from the
// same second once it lands. Going home, the write-up's player flies, as it is. A flight that's
// turned round on the way (Esc straight after opening, say) flies back from where it got to.

const FLY_MS = 520;
const FLY_EASE = 'cubic-bezier(.45, 0, .15, 1)';
const FADE_AT = 170;                       // the titles change over from 170ms in to 170ms from the end
const MASK = CSS.supports('mask-image', 'none') ? 'maskImage' : 'webkitMaskImage';
const FACE_STYLE = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textTransform', 'color'];
let flight = null;                         // the flight on its way, or landing

// The dither as keyframes, from nothing to all of it, or (`out`) back. Each frame holds until the
// next, like develop and undevelop in styles.css.
function ditherFrames(out) {
  const frames = [0, 2, 4, 6, 8, 10, 12, 14].map(n => dither[n]).concat('none').map(mask => ({ [MASK]: mask, easing: 'steps(1, end)' }));
  return out ? frames.reverse() : frames;
}

// Where an element is, from the corner of #home, which the flyers are placed in.
function boxOf(el) {
  const r = el.getBoundingClientRect(), o = home.getBoundingClientRect();
  return { left: r.left - o.left, top: r.top - o.top, width: r.width, height: r.height };
}
const px = b => ({ left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });

// Where a picture sits in a frame: filling it and cropped (as on a tile), or all of it, fitted in (as in the player).
function fit(frame, aspect, cover) {
  let width = frame.width, height = frame.width / aspect;
  if ((height < frame.height) === cover) { height = frame.height; width = height * aspect; }
  return { left: (frame.width - width) / 2, top: (frame.height - height) / 2, width, height };
}

// Where the first line of an element's words starts, on screen.
function wordsAt(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getClientRects()[0] || el.getBoundingClientRect();
}

// How wide an element's words are: its longest line.
function wordsWide(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect().width;
}

// Copies of titles, each set just like its title, with its words over the title's. A copy's only
// as wide as the words, which wrap the same way in that (so it doesn't stick out past the page as
// it flies). The titles are all measured, then the copies all put in and measured, so the page is
// laid out twice, not twice for each.
function facesOf(titles) {
  const looks = titles.map(title => {
    const style = getComputedStyle(title);
    return { title, width: wordsWide(title) + 1, want: wordsAt(title), style: FACE_STYLE.map(name => style[name]) };
  });
  const faces = looks.map(look => {
    const face = document.createElement('p');
    face.className = 'flyer flyer-face';
    face.setAttribute('aria-hidden', 'true');
    FACE_STYLE.forEach((name, i) => { face.style[name] = look.style[i]; });
    const words = document.createElement('span');
    words.textContent = look.title.textContent.trim();
    face.append(words);
    face.style.left = face.style.top = '0px';
    face.style.width = `${Math.ceil(look.width)}px`;
    home.append(face);
    return face;
  });
  faces.forEach((face, i) => {
    const want = looks[i].want, got = wordsAt(face.firstChild);
    face.at = { left: want.left - got.left, top: want.top - got.top };
  });
  for (const face of faces) {
    face.style.left = `${face.at.left}px`;
    face.style.top = `${face.at.top}px`;
  }
  return faces;
}

// Copies of whole pieces of a tile or write-up (a plate, a label), each set just like the piece and
// put over it. A copy's `at` is where its words start, from its own corner. Its ::after (a tile's
// arrow, or the rule under its label) is copied through --after-* (styles.css). All measured first,
// then all put in.
const GHOST_STYLE = [...FACE_STYLE, 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'backgroundColor', 'backgroundImage', 'backgroundPosition', 'backgroundSize', 'backgroundRepeat'];
function ghostsOf(els) {
  const looks = els.map(el => {
    const style = getComputedStyle(el), after = getComputedStyle(el, '::after');
    const r = el.getBoundingClientRect(), words = wordsAt(el);
    return {
      el, box: boxOf(el), at: { left: words.left - r.left, top: words.top - r.top },
      style: GHOST_STYLE.map(name => style[name]), after: [after.color, after.transform, after.opacity, after.display],
      unshown: [...el.querySelectorAll('*')].map(part => !part.getClientRects().length),   // like a small tile's topic, on a phone
    };
  });
  return looks.map(look => {
    const ghost = look.el.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.classList.remove('is-flown', 'is-landed');   // the piece's own hiding while its copy flies
    ghost.classList.add('flyer', 'flyer-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    GHOST_STYLE.forEach((name, i) => { ghost.style[name] = look.style[i]; });
    ['--after-color', '--after-transform', '--after-opacity', '--after-display'].forEach((name, i) => ghost.style.setProperty(name, look.after[i]));
    ghost.querySelectorAll('*').forEach((part, i) => { if (look.unshown[i]) part.hidden = true; });
    Object.assign(ghost.style, px(look.box));
    ghost.querySelector('.card-title')?.style.setProperty('visibility', 'hidden');   // the title flies on its own
    ghost.box = look.box;
    ghost.at = look.at;
    home.append(ghost);
    return ghost;
  });
}

const playingNow = video => !video.paused && !video.ended && video.readyState >= 3;

// A write-up's player or title shows again once its flight's landed. It doesn't develop in like
// the rest (styles.css), until the next time the write-up opens.
function landed(el) {
  if (!el.classList.contains('is-flown')) return;
  el.classList.remove('is-flown');
  el.classList.add('is-landed');
}

// Flies a card's picture and title from its tile into its write-up, or (`toTile`) back. Both ends
// have to be on the page, where they'll be once it's landed. Returns the flight: turn() sends it
// back the way it came, finish() lands it at once, and `landed` resolves once it's down.
function fly(card, toTile) {
  // Hidden first: with its transitions off while it's away (styles.css), the tile's colours are
  // measured as they'll be when it's shown again, so nothing changes as the copies hand back to it.
  card.el.classList.add('is-away');
  card.title.classList.add('is-flown');
  card.pageLabel.classList.add('is-flown');
  card.full.classList.add('is-flown');

  const tile = boxOf(card.demo), page = boxOf(card.full);
  const plated = card.about.getClientRects().length ? [card.head, card.about] : [card.head];   // the small tiles' blurbs aren't shown
  const ghosts = ghostsOf([...plated, card.label, card.pageLabel]);   // measured before anything moves
  const [tileLabel, pageLabel] = ghosts.slice(-2), plates = ghosts.slice(0, -2);
  const [tileFace, pageFace] = facesOf([card.cardTitle, card.title]);
  const player = card.full.querySelector('video');   // none, if it's an embed
  let pic;
  if (!toTile && card.carried) pic = card.video;      // the tile's clip, playing
  else if (toTile && player) pic = player;
  else { pic = new Image(); pic.src = card.still.currentSrc || card.still.src; pic.alt = ''; }
  const from = pic.parentNode ? { parent: pic.parentNode, next: pic.nextSibling } : null;   // where it goes back to
  const aspect = (pic.videoWidth && pic.videoWidth / pic.videoHeight)
    || (card.still.naturalWidth && card.still.naturalWidth / card.still.naturalHeight) || 16 / 9;

  // The player starts from the clip's second, so it can carry on where the clip leaves off.
  if (pic === card.video && player) {
    const at = card.video.currentTime;
    player.muted = true;
    if (player.readyState) player.currentTime = at;
    else player.addEventListener('loadedmetadata', () => { player.currentTime = at; }, { once: true });
    player.play()?.catch(() => {});
  }
  if (pic === player) player.controls = false;

  const demo = document.createElement('div');
  demo.className = 'flyer flyer-demo';
  demo.setAttribute('aria-hidden', 'true');
  const media = document.createElement('div');
  media.className = 'flyer-media';
  media.append(pic);
  demo.append(media);
  home.append(demo);
  const s = parseFloat(tileFace.style.fontSize) / parseFloat(pageFace.style.fontSize);
  const dx = pageFace.at.left - tileFace.at.left, dy = pageFace.at.top - tileFace.at.top;
  const ls = parseFloat(tileLabel.style.fontSize) / parseFloat(pageLabel.style.fontSize);
  const ldx = pageLabel.box.left + pageLabel.at.left - tileLabel.box.left - tileLabel.at.left;
  const ldy = pageLabel.box.top + pageLabel.at.top - tileLabel.box.top - tileLabel.at.top;
  // The labels grow from where their words start. The plates go along under the title without
  // growing, which would spread them over the write-up as a dark slab.
  for (const label of [tileLabel, pageLabel]) label.style.transformOrigin = `${label.at.left}px ${label.at.top}px`;
  const riders = [tileFace, pageFace, ...ghosts];

  // Closing plays the same flight backwards. The titles change over in the middle of it, so
  // they do it in the same place both ways.
  const timing = { duration: FLY_MS, easing: FLY_EASE, fill: 'both', direction: toTile ? 'reverse' : 'normal' };
  const fade = { ...timing, easing: 'linear', delay: FADE_AT, endDelay: FADE_AT, duration: FLY_MS - 2 * FADE_AT };
  const anims = [
    demo.animate([px(tile), px(page)], timing),
    media.animate([px(fit(tile, aspect, true)), px(fit(page, aspect, false))], timing),
    tileFace.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${1 / s})` }], timing),
    pageFace.animate([{ transform: `translate(${-dx}px, ${-dy}px) scale(${s})` }, { transform: 'none' }], timing),
    tileFace.animate(ditherFrames(true), fade),
    pageFace.animate(ditherFrames(false), fade),
    tileLabel.animate([{ transform: 'none' }, { transform: `translate(${ldx}px, ${ldy}px) scale(${1 / ls})` }], timing),
    pageLabel.animate([{ transform: `translate(${-ldx}px, ${-ldy}px) scale(${ls})` }, { transform: 'none' }], timing),
    tileLabel.animate(ditherFrames(true), fade),
    pageLabel.animate(ditherFrames(false), fade),
    ...plates.flatMap(plate => [
      plate.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px)` }], timing),
      plate.animate(ditherFrames(true), fade),
    ]),
  ];

  const f = { card, toTile, moving: true, done: false };
  f.landed = new Promise(done => { f.resolve = done; });
  let timer = 0, parked = null;

  // Down, and done with: the real picture and title take over, and the picture that flew goes
  // back where it came from.
  const settle = () => {
    if (f.done) return;
    f.done = true;
    f.moving = false;
    clearTimeout(timer);
    player?.removeEventListener('playing', settle);
    parked?.cancel();
    riders.forEach(rider => rider.remove());
    demo.remove();
    if (from) from.parent.insertBefore(pic, from.next);
    if (pic === player) {
      player.controls = true;
      if (f.toTile) { player.pause(); player.muted = player.defaultMuted; }
    }
    if (pic === card.video) {
      card.carried = false;
      if (!f.toTile) stopDemo(card);         // back on its tile, out of sight
    }
    card.el.classList.remove('is-away');
    landed(card.title);
    landed(card.pageLabel);
    landed(card.full);
    if (flight === f) flight = null;
    f.resolve();
    relight();
  };

  // Touching down. In the write-up, a clip that flew waits over the player until the player's
  // playing too (1.5s at most), then hands over. On the tile, a picture that isn't the tile's own
  // clip dissolves into the tile's still.
  const arrive = force => {
    if (!f.moving) return;
    f.moving = false;
    const dissolving = !force && f.toTile && pic !== card.video;
    if (!dissolving) riders.forEach(rider => rider.remove());   // else they stay over the picture until it's gone
    if (f.toTile) card.el.classList.remove('is-away');
    else { landed(card.title); landed(card.pageLabel); }
    if (force) settle();
    else if (!f.toTile && pic === card.video && player && !playingNow(player)) {
      player.addEventListener('playing', settle, { once: true });
      timer = setTimeout(settle, 1500);
    } else if (dissolving) {
      parked = demo.animate(ditherFrames(true), { duration: 200, fill: 'forwards' });
      parked.finished.then(settle, () => {});
    } else settle();
    relight();
  };

  f.turn = () => {
    f.toTile = !f.toTile;
    anims.forEach(a => a.reverse());
  };
  f.finish = () => {
    anims.forEach(a => a.finish());
    arrive(true);
    settle();
  };
  Promise.all(anims.map(a => a.finished)).then(() => arrive(false), () => {});
  return f;
}

// ---------- scatter ----------
// The other tiles get out of the way of the opened one: each slides off, straight away from it,
// and breaks up into the dither as it goes, a little after the one before, the nearest first. The
// opened tile stays put and breaks up too. Everything on it is off flying by then, so all that does
// is keep the empty tile out of sight until the tiles are put away, after it's landed. Coming back
// (`back`), they slide in and develop again. Returns the scatter: turn() sends the tiles back the
// way they came from where they've got to, stop() lets go of them (wherever they were going, they
// end up as they are with no scatter), and `done` resolves once they're all there.
//
// A tile breaks up (or develops) behind a front that sweeps across it, out from the nearest point
// on the opened tile's edge (or, for the opened tile, out from its middle). The front's a dithered
// band, all of the tile on one side of it and none on the other. Where that can't be drawn, the
// tiles break up all over at once instead.

const SCATTER_MS = 440;                    // the slide
const DITHER_MS = 300;                     // and the sweep, as they go
let scattered = null;                      // the last scatter, till it's let go of (it holds the tiles where they got to)

// The band's 16 levels, from 1/16 of the pixels to all of them. As masks, that's a ring for each
// level, where the band's that far through, and that level's pattern, cut out of what's under it.
// From the bottom up, ring 1, pattern 1, ring 2, pattern 2… so a pixel gets through the patterns
// of every ring it's beyond, and as each pattern holds all the pixels of the one before, that
// comes to the pattern of the furthest. The front's radius is --sweep, which the browser animates.
const SWEEP_LEVELS = 16;
const SWEEPS = CSS.supports('mask-composite', 'intersect') && (() => {
  try { CSS.registerProperty({ name: '--sweep', syntax: '<length>', inherits: false, initialValue: '0px' }); return true; }
  catch { return false; }
})();

// Masks an element to show what's beyond the front (or, `inside`, what's within it), the front
// being a circle of radius --sweep round (x, y), in its own px, with the band `width` px deep.
function sweepMask(el, x, y, width, inside) {
  const at = `circle at ${x}px ${y}px`;
  const image = [], size = [], composite = [];
  for (let k = SWEEP_LEVELS; k >= 1; k--) {  // top first
    const r = `max(0px, calc(var(--sweep) ${inside ? '-' : '+'} ${(width * (k - 1) / (SWEEP_LEVELS - 1)).toFixed(1)}px))`;
    image.push(inside ? `radial-gradient(${at}, #000 ${r}, transparent 0)` : `radial-gradient(${at}, transparent ${r}, #000 0)`);
    size.push('auto');
    composite.push('add');
    if (k === 1) break;
    image.push(dither[k - 1]);
    size.push(`${DITHER_TILE}px`);
    composite.push('intersect');
  }
  el.style.maskImage = image.join(', ');
  el.style.maskSize = size.join(', ');
  el.style.maskRepeat = 'repeat';
  el.style.maskPosition = '0 0';
  el.style.maskComposite = composite.join(', ');
}
function unmask(el) {
  for (const p of ['maskImage', 'maskSize', 'maskRepeat', 'maskPosition', 'maskComposite']) el.style[p] = '';
}

// Sweeps a tile `b` away (or back) from the point (x, y) on the page.
function sweep(el, b, x, y, back, timing) {
  const near = Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));
  const far = Math.hypot(Math.max(x - b.left, b.right - x), Math.max(y - b.top, b.bottom - y));
  const width = Math.min(160, Math.max(64, (far - near) * 0.45));
  sweepMask(el, x - b.left, y - b.top, width, back);
  // Going, the front starts with the band just short of the tile and ends past its far corner.
  // Coming back, it starts at the near edge and ends with the band past the far corner.
  const from = back ? near - 1 : near - width, to = back ? far + width : far + 1;
  return el.animate({ '--sweep': [`${from}px`, `${to}px`] }, { ...timing, easing: 'cubic-bezier(.35, 0, .65, 1)' });
}

function scatter(card, back) {
  // All measured first, then all set going: measuring a tile after the one before's been masked
  // would make the browser work out that mask's style there and then, for each tile.
  const boxes = cards.map(other => other.el.getBoundingClientRect());
  const a = boxes[cards.indexOf(card)];
  const push = Math.min(96, Math.max(48, innerWidth * 0.08));   // how far they slide
  const anims = [];
  for (const [i, other] of cards.entries()) {
    const own = other === card;
    const b = boxes[i];
    const gap = Math.hypot(Math.max(b.left - a.right, 0, a.left - b.right), Math.max(b.top - a.bottom, 0, a.top - b.bottom));
    const timing = { duration: own ? 200 : SCATTER_MS, delay: own ? 0 : Math.round(30 + Math.min(100, gap * 0.25)), fill: 'both' };
    // The sweep's quicker than the slide, so they're gone before the write-up's text comes up where they were.
    const fade = { ...timing, duration: own ? 260 : DITHER_MS };
    if (!SWEEPS) anims.push(other.el.animate(ditherFrames(!back), fade));
    else if (own) anims.push(sweep(other.el, b, b.left + b.width / 2, b.top + b.height / 2, back, fade));
    else {
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      anims.push(sweep(other.el, b, Math.min(a.right, Math.max(a.left, cx)), Math.min(a.bottom, Math.max(a.top, cy)), back, fade));
    }
    if (own) continue;
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const far = Math.hypot(dx, dy) || 1;
    const off = `${Math.round(dx / far * push)}px ${Math.round(dy / far * push)}px`;
    // Both ways, quick at first and slowing to a stop: shoved off, and settling back into place.
    anims.push(other.el.animate({ translate: back ? [off, '0px 0px'] : ['0px 0px', off] },
      { ...timing, easing: back ? 'cubic-bezier(.2, .7, .3, 1)' : 'cubic-bezier(.25, .5, .4, 1)' }));
  }
  const s = { card, back, running: true };
  const track = () => {
    s.done = Promise.all(anims.map(a => a.finished)).then(() => { s.running = false; }, () => {});
  };
  s.turn = () => {
    s.back = !s.back;
    anims.forEach(a => a.reverse());
    track();                                 // any that had finished are playing again
  };
  s.stop = () => {
    s.running = false;
    anims.forEach(a => a.cancel());
    if (SWEEPS) cards.forEach(other => unmask(other.el));
    if (scattered === s) scattered = null;
  };
  track();
  return s;
}

// Scrolls up to the write-up's top, if it's above the screen, or far enough down to see all of
// its player, if that's under the dock.
function uncover(card, fast) {
  const top = details.getBoundingClientRect().top;
  const bottom = card.full.getBoundingClientRect().bottom;
  const room = innerHeight - 96;
  const by = top < 24 ? top - 24 : bottom > room ? Math.min(top - 24, bottom - room) : 0;
  if (Math.abs(by) >= 1) window.scrollBy({ top: by, behavior: fast ? 'auto' : 'smooth' });
}

// A write-up opens in the tiles' place. The other tiles get out of the way while the write-up
// develops in and the tile's picture and title fly into it. (Another write-up, opened from the
// address while this one's open, swaps in instead, in openDetail.)
async function openInPlace(card, run, fast, focus, scroll) {
  const turning = !fast && flight?.moving && flight.card === card && flight.toTile;
  if (flight && !turning) flight.finish();
  if (!fast && !turning) card.carried = card.demo.classList.contains('is-playing');   // its clip flies, still playing
  reading = true;
  hovered = focused = null;                  // the tiles are going
  markOpen(card);
  details.classList.remove('is-closing');
  details.classList.add('is-open');
  placeOrigin();
  cards.forEach(other => { if (other !== card) hidePanel(other); });

  if (fast) {
    scattered?.stop();
    home.classList.remove('tiles-leaving', 'tiles-coming');
    home.classList.add('is-reading');
    cards.forEach(stopDemo);
    reveal(card, false);
  } else {
    home.classList.remove('is-reading', 'tiles-coming');
    home.classList.add('tiles-leaving');
    if (scattered?.running && scattered.card === card && scattered.back) scattered.turn();   // they were on their way back
    else { scattered?.stop(); scattered = scatter(card, false); }
    reveal(card, true, 170);                 // as the tiles clear
    if (turning) flight.turn();
    else flight = fly(card, false);
    cards.forEach(other => { if (!other.carried) stopDemo(other); });
  }
  relight();
  if (focus) card.title.focus({ preventScroll: true });
  if (scroll) uncover(card, fast);
  if (!fast) return tilesGone(run);
}

// Once the last tile's gone (or straight away, `now`), they're put away and let go of.
async function tilesGone(run, now) {
  const gone = scattered;
  if (!now) await gone?.done;
  if (run !== generation) return;            // something else was clicked meanwhile
  home.classList.add('is-reading');
  home.classList.remove('tiles-leaving');
  gone?.stop();
}

// The write-up closes back into the tiles. The page scrolls back to the card, unless it's in sight
// already (backTo), while the picture and title fly home and the tiles slide back in around them.
async function closeInPlace(card, run, fast, onPage, returnFocus) {
  if (fast || !onPage) {
    flight?.finish();
    scattered?.stop();
    home.classList.remove('is-reading', 'tiles-leaving', 'tiles-coming');
    heightNow();
    cards.forEach(hidePanel);
    details.classList.remove('is-open', 'is-closing');
    if (onPage) {
      if (returnFocus) card.button.focus({ preventScroll: true });
      const y = backTo(card, 0);
      if (y !== null) window.scrollTo(0, y);
    }
    relight();
    return;
  }

  const turning = flight?.moving && flight.card === card && !flight.toTile;
  if (flight && !turning) flight.finish();
  home.classList.remove('is-reading', 'tiles-leaving');
  home.classList.add('tiles-coming');
  if (scattered?.running && scattered.card === card && !scattered.back) scattered.turn();   // they hadn't all gone yet
  else { scattered?.stop(); scattered = scatter(card, true); }
  const back = scattered;
  if (returnFocus) card.button.focus({ preventScroll: true });
  // The page gets shorter by as much as the write-up's taller than the tiles.
  const y = backTo(card, Math.max(0, details.getBoundingClientRect().height - projectList.getBoundingClientRect().height));
  const arrived = y === null ? Promise.resolve() : scrollToY(y, false);
  if (turning) flight.turn();
  else flight = fly(card, true);
  const down = flight.landed;
  details.classList.add('is-closing');
  leave(card);
  relight();
  await wait(170);
  if (run !== generation) return;            // it was opened again meanwhile
  document.body.style.minHeight = `${root.scrollHeight}px`;
  heightNow();
  cards.forEach(hidePanel);
  details.classList.remove('is-open', 'is-closing');
  await Promise.all([arrived, down, back.done]);
  if (run !== generation) return;
  releaseHeight();
  home.classList.remove('tiles-coming');
  back.stop();
}

// instant: no animation (find-in-page and a project's address use this, and reduced motion always does).
// focus: move the keyboard focus to the write-up's title, so a screen reader reads it out.
// scroll: bring the write-up into view.
async function openDetail(card, { instant = false, focus = true, scroll = true } = {}) {
  if (!homeShown()) return;            // the cards are switched away from
  setHash('#' + card.panel.id);
  const shown = shownCard();
  const closing = details.classList.contains('is-closing');
  if (openCard === card && shown === card && !closing) {
    if (focus) card.title.focus({ preventScroll: true });
    return;
  }
  const run = ++generation;
  const fast = instant || motionPref.matches;
  releaseHeight();
  if (!reading) return openInPlace(card, run, fast, focus, scroll);

  // Another write-up, while one's open (from the address, or find-in-page), swaps in: the old one
  // dissolves, the panel grows or shrinks to fit, and the new one develops in.
  flight?.finish();
  if (home.classList.contains('tiles-leaving')) tilesGone(run, fast);   // they hadn't all gone yet
  markOpen(card);
  details.classList.remove('is-closing');
  details.classList.add('is-open');
  placeOrigin();
  if (!fast && shown && shown !== card) {    // the old write-up dissolves first
    leave(shown);
    await wait(120);
    if (run !== generation) return;          // something else was clicked meanwhile
  }
  const from = heightNow();
  cards.forEach(other => { if (other !== card) hidePanel(other); });
  reveal(card, !fast);
  if (focus) card.title.focus({ preventScroll: true });
  if (!fast) grow(from, frame.getBoundingClientRect().height, 220);
  if (scroll) uncover(card, fast);
}

// returnFocus: put the keyboard focus back on the card, for when it was in the write-up.
async function closeDetail({ instant = false, returnFocus = false } = {}) {
  const card = openCard;
  if (!card) return;
  const run = ++generation;
  const fast = instant || motionPref.matches;
  reading = false;
  markOpen(null);
  if (location.hash === '#' + card.panel.id) setHash('');
  const onPage = homeShown();                // not when the contact view's taken over
  return closeInPlace(card, run, fast, onPage, returnFocus);
}

// A card opens its write-up, or closes it if it's already open. It's a real button, so Space
// and Enter work too. On a touch screen, the play button over its demo plays the demo instead,
// and stops any other that's playing.
projectList.addEventListener('click', e => {
  const play = e.target.closest('.demo-play');
  if (play) {
    const card = cards.find(card => card.play === play);
    if (card.playing) stopDemo(card);
    else {
      cards.forEach(other => { if (other !== card) stopDemo(other); });
      playDemo(card);
    }
    relight();
    return;
  }
  const card = cards.find(card => card.button === e.target.closest('.card-open'));
  if (!card) return;
  if (openCard === card) closeDetail();
  else openDetail(card);
});

details.addEventListener('click', e => {
  if (e.target.closest('.detail-close')) closeDetail({ returnFocus: true });
});

// Esc closes it while the focus is in the write-up or on the cards (or nowhere in particular),
// but not from somewhere else, like the dock.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !openCard || e.defaultPrevented || e.isComposing) return;
  const active = document.activeElement;
  const inside = !active || active === document.body || details.contains(active);
  if (!inside && !projectList.contains(active)) return;
  e.preventDefault();
  closeDetail({ returnFocus: inside });
});

// ---------- copy buttons ----------
// A discord name can't be a link, so clicking it copies it, and the note beside it says so. The
// brief's copy button does the same with its text (named in data-copy-from). Where the page
// can't use the clipboard, the text is selected instead, ready to copy.

for (const button of document.querySelectorAll('.copy')) {
  const note = document.getElementById(button.getAttribute('aria-describedby')) || button.nextElementSibling;
  const idle = note.textContent;
  const source = button.dataset.copyFrom ? document.getElementById(button.dataset.copyFrom) : null;
  let reset;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(source ? source.textContent : button.dataset.copy);
      note.textContent = 'copied';
      note.classList.add('is-done');
    } catch {
      getSelection().selectAllChildren(source || button);
      note.textContent = 'selected, copy it';
    }
    clearTimeout(reset);
    reset = setTimeout(() => { note.textContent = idle; note.classList.remove('is-done'); }, 2000);
  });
}

// ---------- following the address ----------
// The dock's links, "commission something like this", and Back and Forward all change the
// address. Home or contact switches the view. A project's address opens that project. Going to
// the contact view closes the write-up at once, and from a "commission" link, the focus goes to
// the contact block.

// The link that changed the address, if one did. The focus can't say: a link to a part of the
// page that can't take focus (like #contact) takes the focus off the link before `hashchange`.
let followed = null;
document.addEventListener('click', e => {
  const opensElsewhere = e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey;   // a new tab or window
  followed = opensElsewhere ? null : e.target.closest?.('a[href^="#"]') || null;
}, true);

function route() {
  const fromHome = !!followed && home.contains(followed);   // a "commission" link, in a write-up
  followed = null;
  const id = location.hash.slice(1);
  show(id);
  if (!homeShown()) {                        // the contact view
    hovered = focused = null;
    closeDetail({ instant: true });
    relight();
    if (fromHome) contactTitle.focus();
    return;
  }
  // A project's address, or the address of something inside its write-up (find-in-page may
  // already have unhidden that write-up).
  const target = id ? document.getElementById(id) : null;
  const linked = cardById(id) || (target && cards.find(card => card.panel.contains(target))) || null;
  if (linked) openDetail(linked);
  else if (openCard) closeDetail();          // home, or no address: close
}
window.addEventListener('hashchange', route);

// ---------- start ----------

relight();
// Opened at a project's address: open it straight away, without moving the focus.
const linked = cardById(location.hash.slice(1));
if (linked) openDetail(linked, { instant: true, focus: false });
if (!reduceMotion) { ticking = true; requestAnimationFrame(tick); }
