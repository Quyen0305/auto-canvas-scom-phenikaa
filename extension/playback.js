// MAIN world, document_start: the player must see these hooks before it caches
// visibility getters or requestAnimationFrame. No extension APIs or secrets here.
(() => {
  if (window.__lessonPlaybackInstalled) return;
  window.__lessonPlaybackInstalled = true;
  const CONTROL = 'lesson-assistant:playback-control';
  const PULSE = 'lesson-assistant:playback-pulse';
  const STATE = 'lesson-assistant:playback-state';
  const raf = window.requestAnimationFrame.bind(window);
  const caf = window.cancelAnimationFrame.bind(window);
  const now = performance.now.bind(performance);
  const frames = new Map();
  let active = false, worker = null, timer = null, workerURL = null;
  let lease = 0, lastPulse = 0, clockMode = 'off', problem = '';
  function descriptor(object, name) {
    for (let p = object; p; p = Object.getPrototypeOf(p)) {
      const d = Object.getOwnPropertyDescriptor(p, name);
      if (d) return d;
    }
  }
  const hiddenGetter = descriptor(document, 'hidden')?.get;
  const realHidden = () => hiddenGetter ? hiddenGetter.call(document) : false;
  const realFocus = document.hasFocus.bind(document);
  // Inactive hooks delegate to the original browser values. Do not change
  // video.play/pause, media time, playbackRate, quiz pauses, or SCORM state.
  for (const [key, value] of Object.entries({hidden: false, visibilityState: 'visible', webkitHidden: false, webkitVisibilityState: 'visible'})) {
    const d = descriptor(document, key);
    if (!d?.get) continue;
    try { Object.defineProperty(document, key, {configurable: true, get: () => active ? value : d.get.call(document)}); }
    catch { problem = 'Không ghi đè được trạng thái hiển thị của trang.'; }
  }
  document.hasFocus = () => active || realFocus();
  const hookProblem = problem;
  function suppress(event) {
    if (active && (event.type !== 'blur' || event.target === window || event.target === document)) event.stopImmediatePropagation();
  }
  for (const type of ['visibilitychange', 'webkitvisibilitychange', 'blur']) window.addEventListener(type, suppress, true);

  // Keep native RAF IDs and cancellation semantics. A pending callback is invoked
  // at most once. The fallback uses actual elapsed time, never a fabricated clock.
  window.requestAnimationFrame = function(callback) {
    if (typeof callback !== 'function') return raf(callback);
    const id = raf(time => {
      if (!frames.has(id)) return;
      frames.delete(id); callback(time);
    });
    frames.set(id, {callback, at: now()});
    return id;
  };
  window.cancelAnimationFrame = function(id) { frames.delete(Number(id)); caf(id); };
  function report() {
    window.dispatchEvent(new CustomEvent(STATE, {detail: JSON.stringify({active, clock: clockMode, hidden: realHidden(), problem})}));
  }
  function pulse() {
    if (!active) return;
    const time = now();
    // Renewed by the isolated content script. If it disappears, restore behavior
    // before invoking any player callbacks, including after a frozen-tab wakeup.
    if (time - lease > 15000) { disable(); return; }
    if (time - lastPulse >= 350) {
      lastPulse = time;
      window.dispatchEvent(new Event(PULSE));
      if (!active) return;
    }
    const hidden = realHidden();
    const batch = [...frames];
    for (const [id, entry] of batch) {
      if (!active) break;
      if (!frames.has(id) || (!hidden && time - entry.at < 250)) continue;
      frames.delete(id); caf(id);
      try { entry.callback(time); } catch (error) { window.reportError?.(error); }
    }
  }
  function fallbackClock() {
    worker?.terminate(); worker = null;
    if (workerURL) URL.revokeObjectURL(workerURL);
    workerURL = null;
    if (timer == null) timer = setInterval(pulse, 100);
    clockMode = 'timer';
    problem = 'Trang chặn bộ định nhịp nền; khi ẩn tab Chrome có thể làm chậm thanh thời gian.';
    report();
  }
  function enable() {
    lease = now();
    if (active) return;
    problem = hookProblem;
    active = true; lastPulse = lease;
    try {
      // All worker source is bundled here. A worker clock reduces dependence on
      // throttled window timers, but cannot override browser freeze or OS sleep.
      workerURL = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 50);'], {type: 'text/javascript'}));
      worker = new Worker(workerURL);
      worker.onmessage = pulse;
      worker.onerror = () => { if (active) fallbackClock(); };
      clockMode = 'worker';
    } catch { fallbackClock(); }
    report();
  }
  function disable() {
    const wasActive = active;
    active = false;
    worker?.terminate(); worker = null;
    clearInterval(timer); timer = null;
    if (workerURL) URL.revokeObjectURL(workerURL);
    workerURL = null; clockMode = 'off';
    // Native RAF requests remain queued for the next visible frame.
    if (wasActive) {
      document.dispatchEvent(new Event('visibilitychange', {bubbles: true}));
      if (!realFocus()) window.dispatchEvent(new Event('blur'));
    }
    report();
  }
  window.addEventListener(CONTROL, event => {
    if (event.detail === 'on') enable();
    else if (event.detail === 'off') disable();
  });
  window.addEventListener('pagehide', disable);
})();
