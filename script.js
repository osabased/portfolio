const motionPref = matchMedia('(prefers-reduced-motion: reduce)');
let reduceMotion = motionPref.matches;
const root = document.documentElement;

// Bayer-ordered dither masks are drawn to canvas rather than written as SVG: each SVG data URI costs a
// document build on first use, which delayed the first click. styles.css has SVG frames for before this runs.
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const DITHER_TILE = 8;
const dither = [];

function drawDither() {
  const scale = devicePixelRatio || 1;
  const size = Math.max(4, Math.round(DITHER_TILE * scale));
  const edge = k => Math.round(k * size / 4);
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
  for (let n = 1; n < 16; n++) root.style.setProperty(`--dither-${n}`, dither[n]);
  // Zooming or changing screens changes the pixel ratio, so the masks are drawn again.
  matchMedia(`(resolution: ${scale}dppx)`).addEventListener('change', drawDither, { once: true });
}
drawDither();

// Demos play on tap instead of hover on touch screens and with reduced motion. index.html sets html.tap first.
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
let tap = root.classList.contains('tap');
function checkTap() {
  tap = reduceMotion || !finePointer.matches;
  root.classList.toggle('tap', tap);
}
checkTap();

// Safari on iOS leaves :active off unless there's a touch listener on the element or above it.
document.addEventListener('touchstart', () => {}, { passive: true });

const views = [...document.querySelectorAll('.view')];
const navLinks = [...document.querySelectorAll('.dock a')];
const dock = document.querySelector('.dock');
const aliases = { work: 'home', about: 'contact' };
const siteName = document.title;
let viewTitle = siteName;

// The big name is the page's title: the view's name, or the open write-up's.
const nameEl = document.querySelector('.name');
const wrap = document.querySelector('.wrap');
const homeName = nameEl.textContent;
let viewName = homeName;
let nameRun = null;
let nameAway = false;   // dissolved for a switch, until the next page's name develops in
nameEl.tabIndex = -1;

const viewFor = id => views.find(v => v.id === (aliases[id] || id)) || views[0];

function point(view) {
  const index = views.indexOf(view);
  viewTitle = view.id === 'home' ? siteName : `${view.id} · ${siteName}`;
  viewName = view.id === 'home' ? homeName : view.id;
  navLinks.forEach((a, i) => {
    if (i === index) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  dock.style.setProperty('--i', index);
}

function show(id) {
  const view = viewFor(id);
  point(view);
  views.forEach(v => {
    v.classList.toggle('is-active', v === view);
    v.classList.remove('is-leaving');
  });
  window.scrollTo(0, 0);
}

function setName(text) {
  if (nameEl.textContent === text) return false;
  nameEl.textContent = text;
  nameEl.dataset.text = text;
  return true;
}

// 'out' dissolves the name for a switch, 'in' develops it in, and 'glow' develops just the glow
// behind a title that has flown in. null stops whichever is running.
function fadeName(how, delay = 0) {
  nameRun?.cancel();
  nameRun = null;
  nameAway = how === 'out' && !reduceMotion;
  if (!how || reduceMotion) return;
  const timing = how === 'out' ? { duration: VIEW_OUT_MS, fill: 'forwards' } : { duration: 360, delay, fill: 'backwards' };
  if (how === 'glow') timing.pseudoElement = '::before';
  nameRun = nameEl.animate(how === 'out' ? ditherFrames(true) : ditherFrames(false, 1), timing);
}

// A copy dissolves where the name was, so the name itself can take the next title for a flight to measure.
function dropName(glowOnly) {
  if (reduceMotion || nameAway || nameEl.classList.contains('is-flown')) return;
  document.querySelectorAll('.name-copy').forEach(copy => copy.remove());
  const copy = nameEl.cloneNode(true);
  copy.className = glowOnly ? 'name name-copy is-glow' : 'name name-copy';
  copy.removeAttribute('tabindex');
  copy.setAttribute('aria-hidden', 'true');
  // offsetWidth rounds, and a fraction of a pixel short would wrap the copy's last word.
  Object.assign(copy.style, { left: `${nameEl.offsetLeft}px`, top: `${nameEl.offsetTop}px`, width: getComputedStyle(nameEl).width });
  nameEl.after(copy);
  copy.animate(ditherFrames(true), { duration: VIEW_OUT_MS, fill: 'forwards' }).onfinish = () => copy.remove();
}

function nameLanded() {
  if (!nameEl.classList.contains('is-flown')) return;
  nameEl.classList.remove('is-flown');
  if (!nameAway) fadeName('glow');
}

// A title on more lines (or fewer) moves the page under the name, so the page eases there instead
// of jumping. `from` is where the page started.
function easeWrap(from) {
  const by = from - wrap.offsetTop;
  if (by && !reduceMotion) wrap.animate({ translate: [`0 ${by}px`, '0 0'] }, { duration: FLY_MS, easing: FLY_EASE, composite: 'add' });
}

show(location.hash.slice(1) || 'home');
setName(viewName);

const projectList = document.querySelector('.projects');
const home = document.getElementById('home');

// Without script each title is a link to its write-up; here it becomes a button, and each demo gets a play button.
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
    start: parseFloat(video.dataset.start) || 0,
    lit: false, open: false, playing: false,
    carried: false,   // whether its clip is off flying into a write-up, so it's left playing
    heat: 0, target: 0,
  };
});
let hovered = null;
let focused = null;
let openCard = null;
let reading = false;
const homeShown = () => home.classList.contains('is-active');

function playDemo(card) {
  if (card.playing || card.demo.classList.contains('no-clip')) return;
  const { video } = card;
  card.playing = true;
  clearTimeout(card.rewind);
  card.play.setAttribute('aria-pressed', 'true');
  card.demo.classList.add('is-loading');
  // preload="none": the clip's length is unknown until its metadata loads.
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
  [...video.querySelectorAll('source')].pop()?.addEventListener('error', () => {
    demo.classList.add('no-clip');
    stopDemo(card);
    relight();
  });
}

const demoSight = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const card = cards.find(card => card.demo === entry.target);
    if (tap && card.playing && !card.carried && entry.intersectionRatio < 0.5) { stopDemo(card); relight(); }
  }
}, { threshold: [0, 0.5] });
cards.forEach(card => demoSight.observe(card.demo));

function relight() {
  for (const card of cards) {
    card.lit = !reading && (card === hovered || card === focused);
    if (!tap && !card.carried) {
      if (card.lit) playDemo(card);
      else stopDemo(card);
    }
    card.el.classList.toggle('is-lit', card.lit || card.playing);
    card.el.classList.toggle('is-open', card.open);
    // A card stays hot while its demo's away, and cools once it's back on the tile.
    const away = card.el.classList.contains('is-away');
    card.target = !reading && (card.lit || card.open || card.playing || away) ? 1 : 0;
    if (reduceMotion) card.heat = card.target;
  }
  invalidate();
}

const cardFor = node => cards.find(card => card.el.contains(node)) || null;

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

const canvas = document.getElementById('clouds');
const ctx = canvas.getContext('2d');
const PITCH = 7;
const DOT = 4;
const NODE = 3;                           // the cloud is measured every 3rd dot and blended in between
const SHADES = [0, 7, 13, 20, 27, 33, 40, 47];   // dot alpha out of 255. Clouds use the first six (~13% at most); heat unlocks the last two
const FRAME_MS = 100;
const START = Math.random() * 1000;

const COOL = [239, 233, 225];
const HOT = [255, 166, 88];
const HEAT_REACH = 120;
const HEAT_LIFT = 0.45;

const fade = t => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;

function hash(i, j, k = 0) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1440662683)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const u = fade(x - i), v = fade(y - j), w = fade(z - k);
  return mix(
    mix(mix(hash(i, j, k), hash(i + 1, j, k), u), mix(hash(i, j + 1, k), hash(i + 1, j + 1, k), u), v),
    mix(mix(hash(i, j, k + 1), hash(i + 1, j, k + 1), u), mix(hash(i, j + 1, k + 1), hash(i + 1, j + 1, k + 1), u), v),
    w
  );
}

function cloud(x, y, t) {
  x = x / 260 + t * 0.03;
  y = y / 260 - t * 0.012;
  const bendX = noise(x * 0.5, y * 0.5, t * 0.01) - 0.5;
  const bendY = noise(x * 0.5 + 31, y * 0.5 - 17, t * 0.01 + 7) - 0.5;
  x += bendX * 1.4;
  y += bendY * 1.4;
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
let grain;
let colNode, colFrac, rowNode, rowFrac;   // which measured points each column and row lies between, and how far along

function resize() {
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

function measure(t) {
  for (let b = 0, n = 0; b < nodeRows; b++) {
    for (let a = 0; a < nodeCols; a++, n++) field[n] = cloud(a * NODE * PITCH, b * NODE * PITCH, t);
  }
}

function heatSources() {
  const sources = [];
  for (const card of cards) {
    if (!card.heat) continue;
    const r = card.el.getBoundingClientRect();
    if (r.width) sources.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, heat: card.heat });
  }
  return sources;
}

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

// Eased by elapsed time rather than per frame, so it takes as long on a throttled screen.
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

// The clouds step at FRAME_MS; the dots repaint every frame only while a card's glow is changing.
let last = 0;
let dirty = false;
let ticking = false;
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
const followCards = () => { if (cards.some(card => card.heat)) invalidate(); };
window.addEventListener('scroll', followCards, { passive: true });

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

// Kept so the haze can be restored when reduced motion is switched off.
const hazeWaves = [...document.querySelectorAll('#heat-haze animate')].map(wave => ({ wave, parent: wave.parentNode }));
if (reduceMotion) hazeWaves.forEach(({ wave }) => wave.remove());

// Closed write-ups use hidden="until-found", so find-in-page reaches them and opens the match.
// Every open or close bumps `generation`: a step resuming after a wait with a stale value stops,
// so the last click wins.
const details = document.getElementById('details');
const frame = details.querySelector('.details-frame');
const contactTitle = document.getElementById('contact-title');
const DEV_PARTS = ':scope > .detail-head, .detail-grid > :not(.detail-figure), .detail-figure > *, :scope > h3, :scope > .highlights, :scope > .detail-foot';
let generation = 0;
const wait = ms => new Promise(done => setTimeout(done, ms));
const cardById = id => cards.find(card => card.panel.id === id) || null;
const shownCard = () => cards.find(card => !card.panel.hasAttribute('hidden')) || null;

for (const card of cards) {
  card.panel.querySelector('.detail-title').classList.add('vh');   // the big name shows it
  card.pageLabel = card.panel.querySelector('.detail-label');
  card.full = card.panel.querySelector('.demo-full');
  card.panel.querySelectorAll(DEV_PARTS).forEach(el => el.classList.add('dev'));
  card.panel.setAttribute('hidden', 'until-found');
  card.panel.addEventListener('beforematch', () => openDetail(card, { instant: true, focus: false, scroll: false }));
}
details.classList.add('is-ready');

// Lay each write-up out once in the background so the first open doesn't stall on layout.
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

function setHash(hash) {
  try { history.replaceState(history.state, '', hash || location.pathname + location.search); } catch {}
}

// A click adds a history entry marked with its id, so Back closes the write-up. A followed address is already in history.
function setProjectHash(id, push) {
  if (!push || location.hash === '#' + id) return setHash('#' + id);
  try { history.pushState({ project: id }, '', '#' + id); } catch { setHash('#' + id); }
}

function heightNow() {
  const height = frame.getBoundingClientRect().height;
  frame.getAnimations().forEach(a => { if (a.id === 'resize') a.cancel(); });
  return height;
}

function grow(from, to, ms) {
  if (Math.abs(from - to) < 1) return Promise.resolve(true);
  const resize = frame.animate({ height: [`${from}px`, `${to}px`] },
    { id: 'resize', duration: ms, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' });
  return resize.finished.then(() => { resize.cancel(); return true; }, () => false);
}

// The body is held at its old height while the page scrolls back, so removing the write-up doesn't cut the scroll short.
function releaseHeight() {
  document.body.style.minHeight = '';
}

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

function hidePanel(card) {
  const panel = card.panel;
  if (!panel.hasAttribute('hidden')) {
    panel.querySelectorAll('video').forEach(video => { video.pause(); video.muted = video.defaultMuted; });   // a flight may have muted it
    panel.querySelectorAll('iframe').forEach(embed => embed.setAttribute('src', embed.getAttribute('src')));   // reloading an embed stops it
  }
  panel.classList.remove('is-developing', 'is-leaving');
  panel.setAttribute('hidden', 'until-found');
}

function leave(card) {
  card.panel.classList.remove('is-developing');
  card.panel.classList.add('is-leaving');
}

function markOpen(card) {
  openCard = card;
  for (const other of cards) {
    other.open = other === card;
    other.button.setAttribute('aria-expanded', String(other.open));
  }
  updateTitle();
  relight();
}

function updateTitle() {
  document.title = openCard ? `${openCard.cardTitle.textContent} · ${siteName}` : viewTitle;
}

function placeOrigin() {
  if (!openCard) return;
  const box = details.getBoundingClientRect();
  const anchor = openCard.el.getBoundingClientRect();
  const mid = anchor.left + anchor.width / 2;
  details.style.setProperty('--origin-x', `${Math.round(Math.min(box.width - 16, Math.max(16, mid - box.left)))}px`);
}

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
  panel.querySelectorAll('.is-landed').forEach(el => el.classList.remove('is-landed'));
  if (running) void panel.offsetWidth;   // so the animation starts over
  panel.classList.add('is-developing');
  clearTimeout(panel.devTimer);
  panel.devTimer = setTimeout(() => panel.classList.remove('is-developing'), 1200);
}

function reveal(card, animate, after = 0) {
  const panel = card.panel;
  panel.removeAttribute('hidden');
  panel.classList.remove('is-leaving');
  if (animate) develop(panel, after);
  else panel.classList.remove('is-developing');
}

// `gone` is how much shorter the page will be once the write-up closes, which limits how far down it can scroll.
function backTo(card, gone) {
  const lowest = Math.max(0, root.scrollHeight - gone - innerHeight);
  const box = card.el.getBoundingClientRect();
  const room = innerHeight - 96;
  if (box.top >= 0 && box.bottom <= room && window.scrollY <= lowest) return null;
  const y = box.height > room
    ? box.top + window.scrollY - 24
    : box.top + window.scrollY - (room - box.height) / 2;
  return Math.round(Math.min(lowest, Math.max(0, y)));
}

// A flyer is a stand-in over the page while the real picture, title and labels at either end are hidden.
// A flight turned round mid-way flies back from where it got to.
const FLY_MS = 520;
const FLY_EASE = 'cubic-bezier(.45, 0, .15, 1)';
const FADE_AT = 170;
const MASK = CSS.supports('mask-image', 'none') ? 'maskImage' : 'webkitMaskImage';
const MASK_SIZE = MASK === 'maskImage' ? 'maskSize' : 'webkitMaskSize';
const FACE_STYLE = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textTransform', 'color', 'textShadow'];
let flight = null;

function ditherFrames(out, step = 2) {
  const shades = Array.from({ length: 16 / step }, (_, i) => dither[i * step]);
  const frames = shades.concat('none').map(mask => ({ [MASK]: mask, easing: 'steps(1, end)' }));
  return out ? frames.reverse() : frames;
}

// A title flying to or from the big name grows a few times over, so its dither is drawn smaller as it
// grows to keep the dots the size they are everywhere else.
function zoomFrames(from, to) {
  return [0, 0.25, 0.5, 0.75, 1].map(p => {
    const at = key => from[key] + (to[key] - from[key]) * p;
    return { transform: `translate(${at('x')}px, ${at('y')}px) scale(${at('scale')})`, [MASK_SIZE]: `${DITHER_TILE / at('scale')}px` };
  });
}

function boxOf(el) {
  const r = el.getBoundingClientRect(), o = home.getBoundingClientRect();
  return { left: r.left - o.left, top: r.top - o.top, width: r.width, height: r.height };
}
const px = b => ({ left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });

function fit(frame, aspect, cover) {
  let width = frame.width, height = frame.width / aspect;
  if ((height < frame.height) === cover) { height = frame.height; width = height * aspect; }
  return { left: (frame.width - width) / 2, top: (frame.height - height) / 2, width, height };
}

function wordsAt(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getClientRects()[0] || el.getBoundingClientRect();
}

function wordsWide(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect().width;
}

// The titles are all measured, then the copies all inserted and measured, so layout runs twice rather than twice per title.
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

// A ghost's ::after (a tile's arrow, the rule under a label) is copied through --after-* properties (styles.css).
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
    ghost.querySelector('.card-title')?.style.setProperty('visibility', 'hidden');
    ghost.box = look.box;
    ghost.at = look.at;
    home.append(ghost);
    return ghost;
  });
}

const playingNow = video => !video.paused && !video.ended && video.readyState >= 3;

function landed(el) {
  if (!el.classList.contains('is-flown')) return;
  el.classList.remove('is-flown');
  el.classList.add('is-landed');
}

function fly(card, toTile) {
  // Hidden first, with transitions off while away (styles.css), so the tile's colours are measured as they'll be on return.
  card.el.classList.add('is-away');
  nameEl.classList.add('is-flown');
  card.pageLabel.classList.add('is-flown');
  card.full.classList.add('is-flown');

  const tile = boxOf(card.demo), page = boxOf(card.full);
  const plated = card.about.getClientRects().length ? [card.head, card.about] : [card.head];
  const ghosts = ghostsOf([...plated, card.label, card.pageLabel]);
  const [tileLabel, pageLabel] = ghosts.slice(-2), plates = ghosts.slice(0, -2);
  const [tileFace, pageFace] = facesOf([card.cardTitle, nameEl]);
  const player = card.full.querySelector('video');   // none, if it's an embed
  let pic;
  if (!toTile && card.carried) pic = card.video;
  else if (toTile && player) pic = player;
  else { pic = new Image(); pic.src = card.still.currentSrc || card.still.src; pic.alt = ''; }
  const from = pic.parentNode ? { parent: pic.parentNode, next: pic.nextSibling } : null;
  const aspect = (pic.videoWidth && pic.videoWidth / pic.videoHeight)
    || (card.still.naturalWidth && card.still.naturalWidth / card.still.naturalHeight) || 16 / 9;

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
  // The plates travel without scaling, which would spread them over the write-up as a dark slab.
  for (const label of [tileLabel, pageLabel]) label.style.transformOrigin = `${label.at.left}px ${label.at.top}px`;
  const riders = [tileFace, pageFace, ...ghosts];

  const timing = { duration: FLY_MS, easing: FLY_EASE, fill: 'both', direction: toTile ? 'reverse' : 'normal' };
  const fade = { ...timing, easing: 'linear', delay: FADE_AT, endDelay: FADE_AT, duration: FLY_MS - 2 * FADE_AT };
  const anims = [
    demo.animate([px(tile), px(page)], timing),
    media.animate([px(fit(tile, aspect, true)), px(fit(page, aspect, false))], timing),
    tileFace.animate(zoomFrames({ x: 0, y: 0, scale: 1 }, { x: dx, y: dy, scale: 1 / s }), timing),
    pageFace.animate(zoomFrames({ x: -dx, y: -dy, scale: s }, { x: 0, y: 0, scale: 1 }), timing),
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
    nameLanded();
    landed(card.pageLabel);
    landed(card.full);
    if (flight === f) flight = null;
    f.resolve();
    relight();
  };

  // In the write-up, a clip that flew waits for the player to be playing (1.5s at most) before handing over.
  const arrive = force => {
    if (!f.moving) return;
    f.moving = false;
    const dissolving = !force && f.toTile && pic !== card.video;
    if (!dissolving) riders.forEach(rider => rider.remove());   // else they stay over the picture until it's gone
    if (f.toTile) card.el.classList.remove('is-away');
    else { nameLanded(); landed(card.pageLabel); }
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

// The other tiles slide away from the opened one and break up behind a dithered front sweeping out from it;
// where the mask can't be drawn they break up all at once.
const SCATTER_MS = 440;
const DITHER_MS = 300;
let scattered = null;

// The band's 16 levels are stacked masks: a ring per level (radius --sweep, animated by the browser)
// intersected with that level's dither pattern.
const SWEEP_LEVELS = 16;
const SWEEPS = CSS.supports('mask-composite', 'intersect') && (() => {
  try { CSS.registerProperty({ name: '--sweep', syntax: '<length>', inherits: false, initialValue: '0px' }); return true; }
  catch { return false; }
})();

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
  // A tile still developing in after a return home would keep its develop mask over the sweep's.
  for (const other of cards) other.el.getAnimations().forEach(run => { if (run.animationName === 'develop-fine') run.finish(); });
  const a = boxes[cards.indexOf(card)];
  const push = Math.min(96, Math.max(48, innerWidth * 0.08));
  const anims = [];
  for (const [i, other] of cards.entries()) {
    const own = other === card;
    const b = boxes[i];
    const gap = Math.hypot(Math.max(b.left - a.right, 0, a.left - b.right), Math.max(b.top - a.bottom, 0, a.top - b.bottom));
    const timing = { duration: own ? 200 : SCATTER_MS, delay: own ? 0 : Math.round(30 + Math.min(100, gap * 0.25)), fill: 'both' };

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
    track();
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

// Up to the name, since that's the write-up's title.
function uncover(fast) {
  if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: fast ? 'auto' : 'smooth' });
}

async function openInPlace(card, run, fast, focus, scroll) {
  const turning = !fast && flight?.moving && flight.card === card && flight.toTile;
  if (flight && !turning) flight.finish();
  if (!fast && !turning) card.carried = card.demo.classList.contains('is-playing');
  reading = true;
  hovered = focused = null;
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
    setName(card.cardTitle.textContent);
  } else {
    home.classList.remove('is-reading', 'tiles-coming');
    home.classList.add('tiles-leaving');
    if (scattered?.running && scattered.card === card && scattered.back) scattered.turn();
    else { scattered?.stop(); scattered = scatter(card, false); }
    const top = wrap.offsetTop;
    dropName(false);
    fadeName(null);
    setName(card.cardTitle.textContent);
    nameEl.classList.add('is-flown');
    reveal(card, true, 170);
    if (turning) flight.turn();
    else flight = fly(card, false);
    easeWrap(top);
    cards.forEach(other => { if (!other.carried) stopDemo(other); });
  }
  relight();
  if (focus) nameEl.focus({ preventScroll: true });
  if (scroll) uncover(fast);
  if (!fast) return tilesGone(run);
}

async function tilesGone(run, now) {
  const gone = scattered;
  if (!now) await gone?.done;
  if (run !== generation) return;
  home.classList.add('is-reading');
  home.classList.remove('tiles-leaving');
  gone?.stop();
}

async function closeInPlace(card, run, fast, onPage, returnFocus) {
  if (fast || !onPage) {
    flight?.finish();
    scattered?.stop();
    home.classList.remove('is-reading', 'tiles-leaving', 'tiles-coming');
    heightNow();
    cards.forEach(hidePanel);
    details.classList.remove('is-open', 'is-closing');
    setName(viewName);
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
  if (scattered?.running && scattered.card === card && !scattered.back) scattered.turn();
  else { scattered?.stop(); scattered = scatter(card, true); }
  const back = scattered;
  if (returnFocus) card.button.focus({ preventScroll: true });
  dropName(true);
  if (turning) flight.turn();
  else flight = fly(card, true);
  const top = wrap.offsetTop;
  setName(viewName);
  nameEl.classList.remove('is-flown');
  fadeName('in', 170);
  // The page gets shorter by as much as the write-up's taller than the tiles.
  const y = backTo(card, Math.max(0, details.getBoundingClientRect().height - projectList.getBoundingClientRect().height));
  const arrived = y === null ? Promise.resolve() : scrollToY(y, false);
  easeWrap(top);
  const down = flight.landed;
  details.classList.add('is-closing');
  leave(card);
  relight();
  await wait(170);
  if (run !== generation) return;
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
// push: add a history entry for it (a click on the card, not a followed address).
async function openDetail(card, { instant = false, focus = true, scroll = true, push = false } = {}) {
  if (!homeShown()) return;
  setProjectHash(card.panel.id, push);
  const shown = shownCard();
  const closing = details.classList.contains('is-closing');
  if (openCard === card && shown === card && !closing) {
    if (focus) nameEl.focus({ preventScroll: true });
    return;
  }
  const run = ++generation;
  const fast = instant || motionPref.matches;
  releaseHeight();
  if (!reading) return openInPlace(card, run, fast, focus, scroll);

  flight?.finish();
  if (home.classList.contains('tiles-leaving')) tilesGone(run, fast);
  markOpen(card);
  details.classList.remove('is-closing');
  details.classList.add('is-open');
  placeOrigin();
  if (!fast && shown && shown !== card) {
    leave(shown);
    fadeName('out');
    await wait(120);
    if (run !== generation) return;
  }
  const from = heightNow();
  cards.forEach(other => { if (other !== card) hidePanel(other); });
  reveal(card, !fast);
  if (setName(card.cardTitle.textContent) || nameAway) fadeName(fast ? null : 'in');
  if (focus) nameEl.focus({ preventScroll: true });
  if (!fast) grow(from, frame.getBoundingClientRect().height, 220);
  if (scroll) uncover(fast);
}

// returnFocus: put the keyboard focus back on the card, for when it was in the write-up.
async function closeDetail({ instant = false, returnFocus = false } = {}) {
  const card = openCard;
  if (!card) return;
  // Its entry was added by opening it, so close it by going back, and route() does the closing.
  if (location.hash === '#' + card.panel.id && history.state?.project === card.panel.id) {
    closeOnBack = { instant, returnFocus };
    history.back();
    return;
  }
  const run = ++generation;
  const fast = instant || motionPref.matches;
  reading = false;
  markOpen(null);
  if (location.hash === '#' + card.panel.id) setHash('');
  const onPage = homeShown();
  return closeInPlace(card, run, fast, onPage, returnFocus);
}

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
  else openDetail(card, { push: true });
});

details.addEventListener('click', e => {
  if (e.target.closest('.detail-close')) closeDetail({ returnFocus: true });
});

// Esc closes it while the focus is in the write-up or on the cards (or nowhere in particular),
// but not from somewhere else, like the dock.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !openCard || e.defaultPrevented || e.isComposing) return;
  const active = document.activeElement;
  const inside = !active || active === document.body || active === nameEl || details.contains(active);
  if (!inside && !projectList.contains(active)) return;
  e.preventDefault();
  closeDetail({ returnFocus: inside });
});

for (const button of document.querySelectorAll('.copy')) {
  const note = document.getElementById(button.getAttribute('aria-describedby')) || button.nextElementSibling;
  const idle = note.textContent;
  const source = button.dataset.copyFrom ? document.getElementById(button.dataset.copyFrom) : null;
  const text = source || button;
  text.addEventListener('animationend', e => {
    if (e.target === text && e.animationName === 'glow') text.classList.remove('is-copied');
  });
  let reset;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(source ? source.textContent : button.dataset.copy);
      note.textContent = 'copied';
      note.classList.add('is-done');
      const glow = text.getAnimations().find(a => a.animationName === 'glow');
      if (glow) glow.currentTime = 0;
      else if (!reduceMotion) text.classList.add('is-copied');
    } catch {
      getSelection().selectAllChildren(text);
      note.textContent = 'selected, copy it';
    }
    clearTimeout(reset);
    reset = setTimeout(() => { note.textContent = idle; note.classList.remove('is-done'); }, 2000);
  });
}

// The link that changed the address, if one did. The focus can't say: a link to a part of the
// page that can't take focus (like #contact) takes the focus off the link before `hashchange`.
let followed = null;
// How the write-up that closeDetail() went back to close should close.
let closeOnBack = {};
document.addEventListener('click', e => {
  const opensElsewhere = e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey;
  followed = opensElsewhere ? null : e.target.closest?.('a[href^="#"]') || null;
}, true);

// The view being left dissolves before the next one is shown. The dock moves at once, and the last
// switch wins: one made back to the view still dissolving just keeps it.
const VIEW_OUT_MS = 120;
let switching = 0;

async function route() {
  const fromHome = !!followed && home.contains(followed);
  followed = null;
  const closing = closeOnBack;
  closeOnBack = {};
  const id = location.hash.slice(1);
  const run = ++switching;
  const shown = views.find(v => v.classList.contains('is-active'));
  const view = viewFor(id);
  if (view !== shown && !motionPref.matches) {
    point(view);
    shown.classList.add('is-leaving');
    fadeName('out');
    await wait(VIEW_OUT_MS);
    if (run !== switching) return;
  }
  show(id);
  updateTitle();
  if (!homeShown()) {
    hovered = focused = null;
    closeDetail({ instant: true });
    setName(viewName);
    relight();
    if (fromHome) contactTitle.focus();
  } else {
    const target = id ? document.getElementById(id) : null;
    const linked = cardById(id) || (target && cards.find(card => card.panel.contains(target))) || null;
    if (linked) openDetail(linked);
    else if (openCard) closeDetail(closing);
    else setName(viewName);
  }
  if (nameAway) fadeName('in');
}
window.addEventListener('hashchange', route);
// route() sets the scroll itself. Left to the browser, Back restores the entry's old scroll before
// `hashchange`, so the view jumps while it's still dissolving.
history.scrollRestoration = 'manual';

relight();
updateTitle();
const linked = cardById(location.hash.slice(1));
if (linked) openDetail(linked, { instant: true, focus: false });
if (!reduceMotion) { ticking = true; requestAnimationFrame(tick); }
