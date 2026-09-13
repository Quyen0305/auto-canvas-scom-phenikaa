const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const source = fs.readFileSync('extension/playback.js', 'utf8');
function setup(blockWorker = false) {
  const dom = new JSDOM('<input><video></video>', {runScripts: 'outside-only', pretendToBeVisual: true});
  const w = dom.window;
  let hidden = false, time = 0, nextID = 1, worker, status;
  const native = new Map(), timers = new Map();
  Object.defineProperty(w.document, 'hidden', {configurable: true, get: () => hidden});
  Object.defineProperty(w.document, 'visibilityState', {configurable: true, get: () => hidden ? 'hidden' : 'visible'});
  w.document.hasFocus = () => !hidden;
  w.performance.now = () => time;
  w.requestAnimationFrame = cb => { const id = nextID++; native.set(id, cb); return id; };
  w.cancelAnimationFrame = id => native.delete(id);
  w.setInterval = cb => { const id = nextID++; timers.set(id, cb); return id; };
  w.clearInterval = id => timers.delete(id);
  w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {};
  w.Worker = class { constructor() { if (blockWorker) throw Error('CSP'); worker = this; } terminate() { this.terminated = true; } };
  w.addEventListener('lesson-assistant:playback-state', e => status = JSON.parse(e.detail));
  const control = value => w.dispatchEvent(new w.CustomEvent('lesson-assistant:playback-control', {detail: value}));
  w.eval(source);
  return {w, native, timers, control, get status() { return status; }, get worker() { return worker; },
    hide(value = true) { hidden = value; w.document.dispatchEvent(new w.Event('visibilitychange', {bubbles: true})); },
    advance(ms = 50) { time += ms; if (worker && !worker.terminated) worker.onmessage(); for (const cb of timers.values()) cb(); },
    close() { control('off'); w.close(); }};
}

test('visibility mask only applies during a run, suppresses window blur but preserves input blur', () => {
  const h = setup(); let visibility = 0, blur = 0, fieldBlur = 0;
  h.w.document.addEventListener('visibilitychange', () => visibility++);
  h.w.addEventListener('blur', () => blur++);
  const input = h.w.document.querySelector('input'); input.addEventListener('blur', () => fieldBlur++);
  h.hide(); assert.equal(h.w.document.hidden, true); assert.equal(visibility, 1);
  h.control('on'); h.hide(); h.w.dispatchEvent(new h.w.Event('blur')); input.dispatchEvent(new h.w.Event('blur'));
  assert.equal(h.w.document.hidden, false); assert.equal(h.w.document.visibilityState, 'visible');
  assert.equal(h.w.document.hasFocus(), true); assert.equal(visibility, 1); assert.equal(blur, 0); assert.equal(fieldBlur, 1);
  h.control('off'); assert.equal(h.w.document.hidden, true); assert.equal(visibility, 2); assert.equal(blur, 1);
  assert.equal(h.worker.terminated, true); h.close();
});

test('hidden RAF advances at actual elapsed time, cancels native callback and never runs twice', () => {
  const h = setup(); const times = [];
  h.control('on'); h.hide();
  const id = h.w.requestAnimationFrame(t => times.push(t)); const nativeCallback = h.native.get(id);
  h.advance(50); assert.deepEqual(times, [50]); assert.equal(h.native.has(id), false);
  nativeCallback(60); h.advance(50); assert.deepEqual(times, [50]); h.close();
});

test('visible RAF keeps native scheduling; occluded windows get a fallback after 250ms', () => {
  const h = setup(); let calls = 0;
  h.control('on'); const id = h.w.requestAnimationFrame(() => calls++);
  h.advance(50); assert.equal(calls, 0);
  h.native.get(id)(50); h.advance(300); assert.equal(calls, 1);
  h.w.requestAnimationFrame(() => calls++); h.advance(250); assert.equal(calls, 2); h.close();
});

test('RAF cancellation, callback reentrancy and stopping mid-batch preserve once-per-frame semantics', () => {
  const h = setup(); let canceled = 0, calls = 0, afterStop = 0;
  h.control('on'); h.hide();
  const id = h.w.requestAnimationFrame(() => canceled++); h.w.cancelAnimationFrame(id);
  h.w.requestAnimationFrame(() => { calls++; h.w.requestAnimationFrame(() => { calls++; h.control('off'); }); });
  h.advance(); assert.equal(calls, 1); assert.equal(canceled, 0);
  h.w.requestAnimationFrame(() => afterStop++); h.advance();
  assert.equal(calls, 2); assert.equal(afterStop, 0); h.close();
});

test('does not resume manually paused or completed media, seek, or replace play/pause', () => {
  const h = setup(); const v = h.w.document.querySelector('video');
  const play = v.play, pause = v.pause;
  h.control('on'); h.hide(); h.advance(1000);
  assert.equal(v.play, play); assert.equal(v.pause, pause); assert.equal(v.paused, true); assert.equal(v.currentTime, 0);
  h.close();
});

test('missing content heartbeat restores visibility before callbacks after a long stall', () => {
  const h = setup(); let calls = 0;
  h.control('on'); h.hide(); h.w.requestAnimationFrame(() => calls++); h.advance(16000);
  assert.equal(calls, 0); assert.equal(h.status.active, false); assert.equal(h.w.document.hidden, true); h.close();
});

test('live content pulses renew lease, but STOP immediately terminates clock', () => {
  const h = setup();
  h.w.addEventListener('lesson-assistant:playback-pulse', () => h.control('on'));
  h.control('on'); h.hide(); for (let i = 0; i < 25; i++) h.advance(1000);
  assert.equal(h.status.active, true); h.control('off'); assert.equal(h.worker.terminated, true); h.close();
});

test('blocked worker falls back with explicit diagnostic and releases fallback timer on STOP', () => {
  const h = setup(true); h.control('on');
  assert.equal(h.status.clock, 'timer'); assert.match(h.status.problem, /chặn/);
  let count = 0; h.hide(); h.w.requestAnimationFrame(() => count++); h.advance(100);
  assert.equal(count, 1); h.control('off'); assert.equal(h.timers.size, 0); h.close();
});

test('reinjection is idempotent and pagehide stops background mode', () => {
  const h = setup(); const fn = h.w.requestAnimationFrame; h.w.eval(source);
  assert.equal(h.w.requestAnimationFrame, fn); h.control('on');
  h.w.dispatchEvent(new h.w.Event('pagehide')); assert.equal(h.status.active, false); h.close();
});

async function attachContent(h, backgroundPlayback = true) {
  let listener;
  const w = h.w;
  w.document.body.innerHTML = '<style>*{opacity:1}</style><div class="slide">Video</div><progress max="100" value="20"></progress>';
  w.HTMLElement.prototype.getBoundingClientRect = () => ({width: 100, height: 30});
  w.Date.now = () => w.performance.now();
  w.chrome = {runtime: {id: 'test-extension', onMessage: {addListener(fn) { listener = fn; }},
    async sendMessage(m) { return m.type === 'HELLO' ? {running: false} : {ok: true}; }}};
  w.eval(fs.readFileSync('extension/core.js', 'utf8'));
  w.eval(fs.readFileSync('extension/content.js', 'utf8'));
  await Promise.resolve();
  const send = message => listener(message, {}, () => {});
  send({type: 'START', run: {session: 'test', config: {...w.LessonCore.defaults, backgroundPlayback}}});
  await Promise.resolve();
  return send;
}

test('content/main bridge starts only for enabled config and STOP releases it', async () => {
  const h = setup(); const send = await attachContent(h, false);
  assert.equal(h.status.active, false);
  send({type: 'START', run: {session: 'test', config: h.w.LessonCore.defaults}});
  assert.equal(h.status.active, true); h.hide();
  for (let i = 0; i < 20; i++) { h.advance(1000); await Promise.resolve(); }
  assert.equal(h.status.active, true);
  assert.equal(h.w.__lessonAssistant.diagnose().backgroundPlayback.clock, 'worker');
  send({type: 'STOP'}); assert.equal(h.status.active, false); h.close();
});

test('extension reload invalidation stops the main-world clock on the next pulse', async () => {
  const h = setup(); await attachContent(h); h.hide();
  delete h.w.chrome.runtime.id; h.advance(400);
  assert.equal(h.status.active, false); assert.equal(h.w.document.hidden, true); h.close();
});

test('completion waits for full timeline, then disables background playback', async () => {
  const h = setup(); await attachContent(h); h.hide();
  h.w.document.querySelector('.slide').textContent = 'Hoàn thành bài học';
  h.advance(2000); await Promise.resolve(); assert.equal(h.status.active, true);
  h.w.document.querySelector('progress').value = 100;
  h.advance(2000); await Promise.resolve();
  h.advance(2000); await Promise.resolve();
  assert.equal(h.status.active, false); h.close();
});
