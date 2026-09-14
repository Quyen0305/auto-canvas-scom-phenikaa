(() => {
  if (globalThis.__lessonAssistant) return;
  const C = globalThis.LessonCore;
  const S = {running: false, playbackOnly: false, session: '', config: C.defaults, timer: null, busy: false, generation: 0,
    key: '', stable: '', stableAt: 0, endAt: 0, action: null, quiz: null, reviewReturn: null, videoReturn: null, histories: new Map(), lastStatus: ''};
  let playbackState = {active: false, clock: 'unavailable'};
  let lastPlaybackStatus = '';
  function playback(on) {
    window.dispatchEvent(new CustomEvent('lesson-assistant:playback-control', {detail: on ? 'on' : 'off'}));
  }
  window.addEventListener('lesson-assistant:playback-state', event => {
    try {
      const state = JSON.parse(event.detail);
      playbackState = {active: state.active === true, clock: String(state.clock).slice(0, 30), problem: String(state.problem || '').slice(0, 300)};
      if (S.running && S.lastStatus) setStatus(S.lastStatus);
    } catch {}
  });
  window.addEventListener('lesson-assistant:playback-pulse', () => {
    if (!contextAlive()) { stopLocal(); return; }
    playback(S.running && S.config.backgroundPlayback !== false);
    if (S.running) tick();
  });
  function contextAlive() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }
  async function sendMessage(message) {
    // Chrome can throw synchronously before returning a Promise after reload.
    // An async boundary makes both synchronous throws and rejections catchable.
    try { return await chrome.runtime.sendMessage(message); }
    catch (error) {
      if (!contextAlive() || /extension context invalidated/i.test(error.message || '')) stopLocal();
      throw error;
    }
  }
  async function archive(quiz, kind, feedbackText = '', correct = null) {
    if (!quiz?.archiveQuestion || !globalThis.SuiteCapture) return;
    try {
      await SuiteCapture.record(quiz.archiveContext, [{question: quiz.archiveQuestion,
        kind, selected_indices: quiz.answers, correct, reason: feedbackText || quiz.reason,
        eventId: quiz.archiveAttempt || ''}]);
    } catch (error) { console.warn('Không lưu được câu hỏi SCORM:', error.message); }
  }
  const query = (selector, root = document) => selector ? [...root.querySelectorAll(selector)] : [];
  function visible(el) {
    if (!el?.isConnected || el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    for (let p = el; p && p.nodeType === 1; p = p.parentElement) {
      const css = getComputedStyle(p);
      // Storyline renders accessible controls at opacity:0 intentionally. Their
      // hidden/aria-hidden/visibility states still determine whether they are active.
      const transparentControl = p.matches('.acc-shadow-el, input[data-ref="progressBar"]');
      if (css.display === 'none' || css.visibility === 'hidden' || (css.opacity === '0' && !transparentControl)) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function enabled(el) {
    return visible(el) && !el.disabled && !el.closest('[disabled], [aria-disabled="true"], .disabled, .cs-disabled') &&
      (getComputedStyle(el).pointerEvents !== 'none' || el.matches('.acc-shadow-el'));
  }
  function visibleVideo(el) {
    if (!el?.isConnected || el.closest('[hidden], [inert], #video-pen, #lib, .offscreen')) return false;
    for (let p = el; p && p.nodeType === 1; p = p.parentElement) {
      // Storyline renders its real video inside an aria-hidden visual object;
      // a separate acc-shadow control represents it to screen readers. Ignore
      // that specific accessibility marker, never CSS hiding or hidden slides.
      if (p.getAttribute('aria-hidden') === 'true' && !p.matches('.slide-object-video.shown')) return false;
      const css = getComputedStyle(p);
      if (css.display === 'none' || css.visibility === 'hidden' || css.opacity === '0') return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function text(el) {
    if (!el) return '';
    const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
    const labels = el.labels ? [...el.labels].map(x => x.innerText || x.textContent).join(' ') : '';
    return (labelled || labels || el.getAttribute('aria-label') || el.innerText || el.textContent || el.getAttribute('title') || el.value || '').replace(/\s+/g, ' ').trim();
  }
  function visibleText(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const out = []; let node;
    while ((node = walker.nextNode())) {
      const p = node.parentElement;
      if (node.textContent.trim() && p && !p.closest('script, style, nav, [role="navigation"], #menu, .sidebar') && visible(p)) out.push(node.textContent.trim());
    }
    return out.join(' ').replace(/\s+/g, ' ').slice(0, 20000);
  }
  function rootElement() {
    const custom = S.config.selectors.root;
    if (custom) return query(custom).find(visible);
    const slides = query('.primary-slide, [data-slide-id], .slide-container, #slide, .slide').filter(visible);
    return slides.find(el => !slides.some(other => other !== el && el.contains(other))) || query('#preso').find(visible) ||
      (query('[role="radiogroup"], [data-lesson], .question, [data-question]').some(visible) ? document.body : null);
  }
  const labels = {
    next: /^(tiep theo|tiep|next)(?:\s*\([^)]*\))?$/,
    submit: /^(gui dap an|gui cau tra loi|nop dap an|tra loi|submit)(\b|$)/,
    continue: /^(tiep tuc(?: hoc| bai hoc)?|continue(?: learning)?)[.!\s]*$/,
    retry: /^(hoc lai|thu lai|lam lai|tra loi lai|try again|retry)(\b|$)/
  };
  function button(kind, allowDisabled = false, root = document) {
    const usable = allowDisabled ? visible : enabled;
    const custom = S.config.selectors[kind];
    if (custom) return query(custom, root).find(usable);
    const ids = {next: '#next, #next-button', submit: '#submit, #submit-button', continue: '', retry: ''};
    return query(ids[kind], root).find(usable) || query('button, [role="button"], input[type="submit"], .slide-object-button', root)
      .find(el => usable(el) && labels[kind].test(C.normalize(text(el))));
  }
  function click(el) {
    if (!contextAlive()) throw new Error('Extension đã được tải lại. Hãy tải lại tab bài học.');
    if (!enabled(el)) throw new Error('Nút đã ẩn hoặc bị khóa; chưa thao tác.');
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
  }
  function currentSlide() {
    const items = query('.cs-listitem[data-slide-title][data-ref]');
    const label = C.normalize(document.getElementById('slide-label')?.textContent).replace(/^slide:\s*/, '');
    const selectedItems = items.filter(el => el.classList.contains('cs-selected') || el.getAttribute('aria-current') === 'true' || el.closest('[aria-selected="true"]'));
    const candidates = selectedItems.length ? selectedItems : items.filter(el => C.normalize(el.getAttribute('data-slide-title')) === label);
    if (candidates.length !== 1) return null;
    const el = candidates[0], title = el.getAttribute('data-slide-title'), ref = el.getAttribute('data-ref');
    const normalized = C.normalize(title);
    if (label && label !== normalized) return null;
    return {ref, title};
  }
  function currentReview() {
    const slide = currentSlide();
    return slide && /^cau hoi on tap(?:\b|$)/.test(C.normalize(slide.title)) ? slide : null;
  }
  function reviewItem(target) {
    const matches = query('.cs-listitem[data-slide-title][data-ref]').filter(el =>
      el.getAttribute('data-ref') === target.ref && el.getAttribute('data-slide-title') === target.title);
    return matches.length === 1 ? matches[0] : null;
  }
  function reviewUnlocked(el) {
    if (!enabled(el) || el.matches('.cs-locked, .cs-disabled, [aria-disabled="true"]')) return false;
    // Storyline puts aria-hidden on decorative icons. Inspect their CSS state:
    // .cs-restricted alone does NOT mean locked (visited slides have it too).
    return !query('.lockedIcon, .lockedViewedIcon', el).some(icon => {
      for (let p = icon; p && p !== el; p = p.parentElement) {
        const css = getComputedStyle(p);
        if (css.display === 'none' || css.visibility === 'hidden' || css.opacity === '0') return false;
      }
      return icon.getBoundingClientRect().width > 0;
    });
  }
  function returnToReview(snap, now) {
    const route = S.reviewReturn;
    if (!route) return false;
    if (now - route.at > 15000) {
      halt(`Không mở lại được ${route.target.title}. Mục có thể bị khóa, ẩn hoặc chưa đặt lại; hãy kiểm tra mục lục.`); return true;
    }
    const wrong = feedback('incorrect'), correct = feedback('correct');
    if (now - route.at < S.config.settleMs) return true;
    const current = currentReview();
    if (!wrong && !correct && snap.q && !snap.q.error && current?.ref === route.target.ref) {
      S.reviewReturn = null; S.quiz = null; S.action = null;
      setStatus(`Đã trở lại ${route.target.title}; chuẩn bị trả lời lại.`); return false;
    }
    if (route.phase === 'opening') { setStatus(`Đã chọn ${route.target.title}; đợi câu hỏi hiện lại.`); return true; }
    if (wrong || correct) { setStatus('Đã bấm Học lại; đợi lớp phản hồi đóng.'); return true; }
    const item = reviewItem(route.target);
    if (!item || !visible(item)) {
      const toggle = document.getElementById('hamburger');
      if (!route.openedSidebar && toggle?.getAttribute('aria-expanded') === 'false' && enabled(toggle)) {
        route.openedSidebar = true; click(toggle);
      }
      setStatus(`Đợi mục ${route.target.title} xuất hiện trong mục lục.`); return true;
    }
    if (!reviewUnlocked(item)) { setStatus(`Mục ${route.target.title} đang khóa; chưa thể mở lại trực tiếp.`); return true; }
    route.phase = 'opening';
    click(item); setStatus(`Đã chọn lại ${route.target.title}, không chờ video trước đó.`); return true;
  }
  function retryButton(root) {
    // Call only after explicit incorrect feedback. Some courses use the same
    // retry trigger but label it TIẾP TỤC HỌC instead of HỌC LẠI.
    return button('retry', false, root) || button('retry') || button('continue', false, root) || button('continue');
  }
  function retryVideoTarget() {
    if (currentReview()) return null;
    const current = currentSlide();
    if (!current || C.completion(current.title) || /^(tu dien thuat ngu|cau hoi thuong gap)\b/.test(C.normalize(current.title))) return null;
    // The wrong-result layer can have no video element. Save the exact active
    // menu entry BEFORE dismissing it, then require real video media on return.
    return current;
  }
  function returnToVideo(snap, now) {
    const route = S.videoReturn;
    if (!route) return false;
    if (feedback('incorrect') && now - route.at > 15000) { halt('Đã bấm nút xem lại nhưng màn hình phản hồi chưa đóng. Hãy xuất chẩn đoán.'); return true; }
    if (now - route.at > 20000) { halt('Không xác nhận được video cần xem lại hoặc thao tác tua 98%. Hãy kiểm tra bài học.'); return true; }
    if (now - route.at < S.config.settleMs || feedback('incorrect') || feedback('correct')) return true;
    const current = currentSlide();
    if (current?.ref !== route.target.ref) {
      if (route.phase === 'opening') return true;
      const item = reviewItem(route.target);
      if (!item || !visible(item)) {
        const toggle = document.getElementById('hamburger');
        if (!route.openedSidebar && toggle?.getAttribute('aria-expanded') === 'false' && enabled(toggle)) {
          route.openedSidebar = true; click(toggle);
        }
        setStatus('Đợi mục video của câu hỏi xuất hiện trong mục lục.'); return true;
      }
      if (!item || !reviewUnlocked(item)) { setStatus('Đợi mục video của câu hỏi được mở khóa để xem lại.'); return true; }
      route.phase = 'opening'; route.openedAt = now;
      click(item); setStatus(`Đang quay lại ${route.target.title}.`); return true;
    }
    if (route.openedAt && now - route.openedAt < S.config.settleMs) return true;
    if (snap.q && !snap.q.error) { S.videoReturn = null; return false; }
    const media = query('video', snap.root).filter(visibleVideo).filter(v => Number.isFinite(v.duration) && v.duration > 0);
    if (!media.length || !snap.p.present || snap.p.value == null) { setStatus('Đợi đúng video và thanh thời gian sẵn sàng trước khi tua.'); return true; }
    if (route.phase === 'seeked') {
      // The player's media must also move: a changed slider value alone is not
      // evidence that Storyline accepted the seek.
      if (media.every(v => v.currentTime / v.duration >= 0.96) && snap.p.value >= 0.96) {
        S.videoReturn = null; S.quiz = null; S.action = null;
        setStatus('Đã tua video xem lại khoảng 98%; đợi phần cuối và câu hỏi hiện đủ.'); return false;
      }
      setStatus('Đã yêu cầu tua 98%; đợi trình phát xác nhận.'); return true;
    }
    if (snap.p.value >= 0.98) { S.videoReturn = null; return false; }
    const bars = query('input[data-ref="progressBar"], input[type="range"][aria-label="tiến trình slide"]').filter(visible);
    if (bars.length !== 1) { setStatus('Chưa xác định được thanh thời gian Storyline để tua video xem lại.'); return true; }
    const bar = bars[0], min = Number(bar.min || 0), max = Number(bar.max);
    if (!Number.isFinite(max) || max <= min) return true;
    route.phase = 'seeked';
    // Storyline's own change handler calls currTimeline.progress(value/max).
    // Do not change disabled flags, completion state, or the media clock directly.
    bar.value = String(min + (max-min)*0.98);
    bar.dispatchEvent(new Event('change', {bubbles:true}));
    setStatus('Đã yêu cầu tua video xem lại khoảng 98%.'); return true;
  }
  function progress() {
    const custom = S.config.selectors;
    const selector = custom.progress || 'input[data-ref="progressBar"], input[type="range"][aria-label="tiến trình slide"], .seekbar [role="slider"], #seekbar [role="slider"], .seekbar, #seekbar, [data-lesson-progress], progress, [role="progressbar"], [role="slider"][aria-label*="seek" i], [role="slider"][aria-label*="tiến" i], [role="slider"][aria-label*="thời gian" i]';
    const candidates = query(selector).filter(visible);
    const bars = candidates.filter(el => !candidates.some(other => other !== el && el.contains(other)));
    const reading = value => ({value, done: value != null && value >= 0.999});
    const readings = bars.map(el => {
      if (el.matches('input[type="range"]')) {
        const reported = el.getAttribute('aria-valuetext') || '';
        const full = /^100(?:[.,]0+)?\s*[%％]$/.test(reported.trim());
        return {...C.rangeProgress(el.value, el.min || 0, el.max || 100, el.step || 1, full),
          source: 'range', current: el.value, min: el.min || '0', max: el.max || '100', step: el.step || '1', reported};
      }
      if (el.tagName === 'PROGRESS') return reading(C.ratio(el.getAttribute('value'), 0, el.max));
      const aria = C.ratio(el.getAttribute('aria-valuenow'), el.getAttribute('aria-valuemin') ?? 0, el.getAttribute('aria-valuemax'));
      if (aria != null) return reading(aria);
      if (custom.fill) {
        const fill = query(custom.fill, el).find(visible);
        if (fill) return reading(C.ratio(fill.getBoundingClientRect().width, 0, el.getBoundingClientRect().width));
      }
      return reading(null);
    });
    // Prefer the actual slide timeline. Unknown bars must never be treated as full.
    if (bars.length) return {present: true, done: readings.every(r => r.done), value: readings.find(r => r.value != null)?.value ?? null, readings};
    const root = rootElement();
    const videos = root ? query('video', root).filter(visibleVideo) : [];
    if (videos.length) return {present: true, done: videos.every(v => v.ended || (Number.isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - 0.08)), value: videos[0].duration > 0 ? videos[0].currentTime / videos[0].duration : null};
    return {present: false, done: false, value: null};
  }
  function feedback(kind) {
    const selector = S.config.selectors[kind];
    if (selector) return query(selector).filter(visible).map(text).join(' ') || (query(selector).some(visible) ? kind : '');
    const patterns = kind === 'incorrect' ? /^(sai|chua dung|khong dung|khong chinh xac|chua chinh xac|rat tiec[,! ]+(em|ban) da tra loi sai|(?:em|ban) da tra loi (sai|chua dung|khong dung|chua chinh xac)|incorrect|not correct|that'?s incorrect)\b/ : /^(dung|chinh xac|(?:chuc mung[,! ]+)?(?:em|ban) da tra loi (dung|chinh xac)|cau tra loi (cua ban )?(la )?(dung|chinh xac)|correct|that'?s right|congratulations)\b/;
    return query('[role="dialog"], [role="alert"], .feedback, .feedback-layer, .slide-layer, .slide-object, h1, h2, h3, p, [data-feedback]')
      .filter(visible).map(text).find(t => t.length <= 1800 && patterns.test(C.normalize(t))) || '';
  }
  function readQuestion(root) {
    const custom = S.config.selectors;
    const raw = query(custom.choices || 'input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]', root).filter(visible);
    const choices = raw.filter(el => !raw.some(other => other !== el && el.contains(other)));
    if (!choices.length) return null;
    const groups = new Set(choices.map(el => el.closest('[role="radiogroup"], [role="group"], fieldset') || el.getAttribute('name') || root));
    if (groups.size > 1) return {error: 'Có nhiều nhóm câu hỏi trên cùng slide. Cần cấu hình vùng câu hỏi riêng.'};
    const options = choices.map(text);
    const questionNode = query(custom.question || '[data-question], .question-text, .question, legend, [role="heading"]', root).find(visible);
    const accessibleText = query('.acc-text', root).filter(visible).map(text).filter(value =>
      value.length > 10 && !/^(rectangle|oval|line|text box)\s*\d*$/i.test(value) && !options.some(option => C.answerIdentity(option) === C.answerIdentity(value)));
    const questionText = questionNode ? visibleText(questionNode) || text(questionNode) : accessibleText.length ? [...new Set(accessibleText)].join(' ') : visibleText(root);
    const multiple = choices.some(el => el.matches('[type="checkbox"], [role="checkbox"]'));
    if (choices.length < 2 || options.some(t => !t) || !questionText) return {error: 'Câu hỏi chưa hiện đầy đủ hoặc đáp án là hình ảnh. Cần xuất chẩn đoán để bổ sung nhận diện.'};
    return {text: questionText, options, choices, multiple, key: C.questionKey(questionText, options, multiple)};
  }
  const selected = el => el.matches('input') ? !!el.checked : el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true';
  function setStatus(value) {
    const playbackStatus = JSON.stringify(playbackState);
    if (value === S.lastStatus && playbackStatus === lastPlaybackStatus) return;
    lastPlaybackStatus = playbackStatus;
    S.lastStatus = value;
    sendMessage({type: 'STATUS', session: S.session, text: value, playback: playbackState}).catch(() => {});
  }
  function halt(reason) {
    const session = S.session;
    stopLocal();
    sendMessage({type: 'PAUSE', session, text: reason}).catch(() => {});
  }
  function stopLocal(keepPlayback = false) {
    S.running = false; S.playbackOnly = false; S.generation++; clearInterval(S.timer); S.timer = null;
    S.reviewReturn = null;
    S.videoReturn = null;
    if (!keepPlayback) playback(false);
  }
  function resetSlide(key) {
    S.key = key; S.stable = ''; S.stableAt = Date.now(); S.endAt = 0; S.action = null;
    if (!['submitted', 'result', 'retry'].includes(S.quiz?.phase)) S.quiz = null;
  }
  function snapshot() {
    const root = rootElement();
    const p = progress();
    const q = root && readQuestion(root);
    const body = root ? visibleText(root) : '';
    // Text excludes live progress/counters. Root identity is additionally checked in tick().
    const signature = root ? (root.getAttribute('data-slide-id') || root.id || '') + '|' + body : '';
    const complete = root && !q && (S.config.selectors.complete ? query(S.config.selectors.complete, root).some(visible) || root.matches(S.config.selectors.complete) : C.completion(body));
    return {root, p, q, signature, complete};
  }
  async function tick() {
    if (!S.running || S.busy) return;
    if (!contextAlive()) { stopLocal(); return; }
    playback(S.config.backgroundPlayback !== false);
    if (S.playbackOnly) { setStatus('Đã bật chạy nền. Đang chờ AI sẵn sàng…'); return; }
    S.busy = true;
    const generation = S.generation;
    try {
      const now = Date.now();
      const snap = snapshot();
      if (!snap.root) { setStatus('Chưa thấy slide. Nếu bài đã mở, hãy xuất chẩn đoán để chỉnh bộ nhận diện.'); return; }
      const rootId = snap.root.getAttribute('data-slide-id') || snap.root.id || 'slide';
      // A changed DOM root or explicit slide id is a definite navigation.
      if (S.root !== snap.root || S.key !== rootId) { S.root = snap.root; resetSlide(rootId); }
      if (returnToReview(snap, now)) return;
      if (returnToVideo(snap, now)) return;
      const fp = snap.q && !snap.q.error ? snap.q.key : snap.signature;
      if (S.stable !== fp) { S.stable = fp; S.stableAt = now; }
      if (snap.p.done) { if (!S.endAt) S.endAt = now; } else S.endAt = 0;
      const settled = now - S.stableAt >= S.config.settleMs;
      const ended = snap.p.done && now - S.endAt >= S.config.settleMs;
      if (snap.complete) {
        if (ended && settled) {
          const session = S.session;
          stopLocal();
          await sendMessage({type: 'COMPLETE', session});
        } else setStatus('Slide hoàn thành: đợi thanh thời gian chạy hết rồi dừng.');
        return;
      }
      if (S.action?.kind === 'next') {
        if (!snap.p.done || snap.signature !== S.action.signature) S.action = null;
        else { if (now - S.action.at > 12000) halt('Đã bấm Tiếp theo nhưng slide chưa đổi. Hãy kiểm tra bài rồi Bắt đầu lại.'); return; }
      }
      const wrong = feedback('incorrect');
      const correct = wrong ? '' : feedback('correct');
      if (['submitted', 'result'].includes(S.quiz?.phase) && (wrong || correct) && !S.quiz.archivedGrade) {
        const gradedQuiz = S.quiz;
        await archive(gradedQuiz, 'graded', wrong || correct, !!correct);
        gradedQuiz.archivedGrade = true;
        if (!S.running || generation !== S.generation) return;
      }
      if (S.action?.kind === 'retry') {
        const action = S.action;
        if (wrong && snap.root === action.root && (visible(action.button) || snap.signature === action.signature)) {
          if (now - action.at > 15000) halt('Đã bấm Học lại nhưng màn hình phản hồi chưa đóng. Hãy xuất chẩn đoán.');
          else setStatus('Đã bấm Học lại; đợi màn hình phản hồi đóng.');
          return;
        }
        S.action = null;
      }
      // Also recover when the user starts the extension on an already-wrong
      // result, including video questions without a review menu entry. There
      // is no previous answer to invent when this run did not submit one.
      if (wrong && !S.quiz) {
        const target = currentReview(), retry = retryButton(snap.root);
        if (!retry) { setStatus('Đáp án sai; đợi nút Học lại / Thử lại / Tiếp tục học hiện và được mở khóa.'); return; }
        if (target) S.reviewReturn = {target, at: now, phase: 'retry'};
        else {
          const videoTarget = retryVideoTarget();
          if (videoTarget) S.videoReturn = {target: videoTarget, at: now, phase: 'retry'};
        }
        S.action = {kind: 'retry', at: now, root: snap.root, button: retry, signature: snap.signature};
        click(retry);
        setStatus(target ? `Đã bấm nút xem lại; sẽ mở lại ${target.title}.` : 'Đã bấm nút xem lại; chờ bài học mở lại nội dung.'); return;
      }
      // Storyline may replace the quiz with an explanation video and a
      // TIẾP TỤC HỌC control, without keeping any correct/incorrect message.
      // Track the click separately from the quiz so this also works when the
      // extension is started on that explanation or on a review result layer.
      if (S.action?.kind === 'continue') {
        const action = S.action;
        if (snap.root === action.root && (visible(action.button) || snap.signature === action.signature)) {
          if (now - action.at > 12000) halt('Đã bấm Tiếp tục học nhưng màn hình chưa chuyển. Hãy xuất chẩn đoán.');
          return;
        }
        S.action = null;
      }
      const continueButton = button('continue', true, snap.root) || button('continue', true);
      const resultLayer = continueButton?.closest('[role="dialog"], [role="alert"], .feedback, .feedback-layer, .slide-layer');
      const explanation = !snap.q && continueButton && snap.root.contains(continueButton) &&
        (snap.p.present || /^(tiep tuc hoc|tiep tuc bai hoc|continue learning)[.!\s]*$/.test(C.normalize(text(continueButton))));
      const submittedLayer = ['submitted', 'result'].includes(S.quiz?.phase) && resultLayer;
      if (!wrong && continueButton && (correct || explanation || submittedLayer)) {
        // A result layer over the quiz can be dismissed immediately after a
        // confirmed correct response. An explanation video must actually finish.
        const ready = correct && !!snap.q || (!snap.p.present || ended) && (correct || settled);
        if (!ready) { setStatus('Đang xem phần giải thích; đợi thanh thời gian kết thúc rồi bấm Tiếp tục học.'); return; }
        if (!enabled(continueButton)) { setStatus('Đợi nút Tiếp tục học được mở khóa.'); return; }
        S.action = {kind: 'continue', at: now, root: snap.root, button: continueButton, signature: snap.signature};
        if (S.quiz) { S.quiz.phase = 'passed'; S.quiz.at = now; }
        click(continueButton); setStatus('Đã bấm Tiếp tục học.'); return;
      }
      if (['submitted', 'result'].includes(S.quiz?.phase)) {
        if (correct) {
          setStatus('Đáp án đúng; đợi nút Tiếp tục học.');
          return;
        }
        if (wrong) {
          const last = S.quiz.history[S.quiz.history.length - 1];
          last.feedback = wrong;
          last.confirmedWrong = true;
          S.histories.set(S.quiz.historyKey, S.quiz.history);
          const remaining = C.remainingSingleAnswer(S.quiz.count, S.quiz.multiple, S.quiz.history);
          if (S.quiz.history.length >= S.config.maxAttempts && remaining === null) { halt('Đã đạt giới hạn số lần trả lời câu này; chưa xác định được một đáp án còn lại.'); return; }
          const retry = retryButton(snap.root);
          if (!retry) { setStatus('Đáp án sai; đợi nút Học lại / Thử lại / Tiếp tục học được mở khóa.'); return; }
          const target = S.quiz.review;
          if (target) S.reviewReturn = {target, at: now, phase: 'retry'};
          else if (S.quiz.videoTarget) S.videoReturn = {target: S.quiz.videoTarget, at: now, phase: 'retry'};
          click(retry); S.quiz.phase = 'retry'; S.quiz.at = now; setStatus('Đã bấm nút xem lại; chờ quay về nội dung của câu hỏi.'); return;
        }
        // Some explanation videos reveal their Continue button only at the end.
        // Leave the 30-second timeout on a timed result slide, but retain the
        // submitted answer: wrong feedback may animate in later on this slide.
        if (!snap.q && snap.p.present) S.quiz.phase = 'result';
        else if (snap.q && !snap.q.error && snap.q.key !== S.quiz.key) S.quiz = null;
        else if (now - S.quiz.at > 30000) { halt('Chưa nhận diện được phản hồi đúng/sai sau khi gửi. Xuất chẩn đoán để kiểm tra.'); return; }
        else { setStatus('Đã gửi đáp án; đang đợi phản hồi đúng/sai.'); return; }
      }
      if (S.quiz?.phase === 'retry') {
        if (!wrong && !correct && !snap.q && snap.p.present) {
          S.quiz = null; // HỌC LẠI can return to an earlier video. Keep its history.
        } else if (wrong || correct || !snap.q || now - S.quiz.at < S.config.settleMs) {
          if (now - S.quiz.at > 15000) halt('Lớp phản hồi chưa đóng sau khi bấm Thử lại.');
          return;
        }
        if (S.quiz) S.quiz.phase = 'ready';
      }
      if (S.quiz?.phase === 'passed') {
        if (correct) { if (now - S.quiz.at > 12000) halt('Đã bấm Tiếp tục nhưng phản hồi chưa đóng.'); return; }
        if (snap.q && snap.q.key === S.quiz.key) { setStatus('Câu hỏi đã trả lời đúng; đợi chuyển slide.'); }
        else S.quiz = null;
      }
      if (snap.q && S.quiz?.phase !== 'passed') {
        if (!settled) { setStatus('Đã thấy câu hỏi; đợi nội dung và các lựa chọn ổn định.'); return; }
        if (snap.p.present && !ended) {
          setStatus(snap.p.done ? 'Timeline đã hết; đợi giao diện ổn định trước khi trả lời.' : snap.p.value == null ?
            'Đã thấy câu hỏi nhưng chưa đọc được timeline. Hãy xuất chẩn đoán.' :
            `Đã thấy câu hỏi; đang đợi timeline kết thúc (${(snap.p.value * 100).toFixed(1)}%).`);
          return;
        }
        if (snap.q.error) { setStatus(snap.q.error); return; }
        if (!button('submit', true)) { setStatus('Đã thấy câu hỏi; đợi nút Gửi đáp án.'); return; }
        if (!S.quiz || S.quiz.key !== snap.q.key) {
          const historyKey = JSON.stringify([currentSlide()?.ref || '', C.historyKey(snap.q.text, snap.q.options, snap.q.multiple)]);
          const history = C.remapHistory(S.histories.get(historyKey) || [], snap.q.options);
          S.quiz = {key: snap.q.key, historyKey, count: snap.q.options.length, multiple: snap.q.multiple, history, phase: 'ready', review: currentReview(), videoTarget: retryVideoTarget()};
          S.quiz.archiveQuestion = {text: snap.q.text, options: [...snap.q.options], multiple: snap.q.multiple};
          S.quiz.archiveContext = globalThis.SuiteCapture?.context('SCORM');
          if (S.quiz.archiveContext) S.quiz.archiveContext.attempt = S.session;
          await archive(S.quiz, 'seen');
          if (!S.running || generation !== S.generation) return;
        }
        const quiz = S.quiz;
        if (quiz.phase === 'ready') {
          if (quiz.history.length && new Set(snap.q.options.map(C.answerIdentity)).size !== snap.q.options.length) {
            throw new Error('Các lựa chọn có nội dung trùng nhau; không đủ dữ liệu để loại đáp án đã sai.');
          }
          const remaining = C.remainingSingleAnswer(snap.q.options.length, snap.q.multiple, quiz.history);
          let response;
          if (remaining !== null) {
            response = {answers: [remaining], reason: 'Các lựa chọn khác đã được bài học xác nhận sai. Chọn đáp án duy nhất còn lại.'};
          } else {
            if (quiz.history.length >= S.config.maxAttempts) throw new Error('Đã đạt giới hạn số lần trả lời câu này.');
            setStatus(`${C.providerName(S.config)} đang đọc câu hỏi và chọn đáp án…`);
            response = await sendMessage({type: 'SOLVE', session: S.session, question: {
              text: snap.q.text, options: snap.q.options, multiple: snap.q.multiple, history: quiz.history
            }});
          }
          if (!S.running || generation !== S.generation) return;
          if (response.error) throw new Error(response.error);
          const fresh = snapshot();
          if (fresh.root !== snap.root || fresh.q?.key !== snap.q.key || (fresh.p.present && !fresh.p.done)) { S.quiz = null; setStatus('Câu hỏi hoặc tiến trình đã đổi; bỏ kết quả cũ của AI.'); return; }
          let chosen = C.validateAnswer({answers: response.answers?.map(x => x + 1)}, fresh.q.options.length, fresh.q.multiple);
          if (quiz.history.some(h => h.confirmedWrong && JSON.stringify(h.answers) === JSON.stringify(chosen.map(x => x + 1)))) {
            if (fresh.q.multiple) throw new Error('AI chọn lại tổ hợp đã sai; chưa có tổ hợp mới để gửi.');
            const wrong = new Set(quiz.history.filter(h=>h.confirmedWrong && h.answers.length===1).map(h=>h.answers[0]-1));
            const alternative = fresh.q.options.findIndex((_,index)=>!wrong.has(index));
            if (alternative < 0) throw new Error('Tất cả lựa chọn đã bị bài học chấm sai. Cần kiểm tra lại câu hỏi.');
            chosen = [alternative];
            response.reason = 'AI lặp đáp án đã sai. Thử một lựa chọn chưa bị bài học loại; chưa coi đây là đáp án đúng.';
          }
          // Toggle only mismatched controls, then verify on a later tick before submission.
          fresh.q.choices.forEach((el, index) => {
            const want = chosen.includes(index);
            if ((fresh.q.multiple && selected(el) !== want) || (!fresh.q.multiple && want && !selected(el))) click(el);
          });
          quiz.answers = chosen; quiz.reason = response.reason; quiz.phase = 'selected'; quiz.at = Date.now();
          await archive(quiz, 'ai');
          setStatus(`${remaining !== null ? 'Tự chọn đáp án còn lại' : C.providerName(S.config) + ' chọn'} ${chosen.map(x => x + 1).join(', ')}. ${response.reason || ''}`); return;
        }
        if (quiz.phase === 'selected') {
          if (now - quiz.at < 700) return;
          if (!snap.q.choices.every((el, i) => selected(el) === quiz.answers.includes(i))) throw new Error('Chưa xác nhận được trạng thái chọn đáp án; chưa bấm Gửi.');
          const submit = button('submit');
          if (!submit) return;
          quiz.archiveAttempt = globalThis.crypto?.randomUUID?.() || String(now);
          quiz.archivedGrade = false;
          await archive(quiz, 'submitted');
          if (!S.running || generation !== S.generation || !submit.isConnected) return;
          quiz.phase = 'submitted'; quiz.at = now;
          quiz.history.push({answers: quiz.answers.map(x => x + 1), answerTexts: quiz.answers.map(x => C.answerIdentity(quiz.archiveQuestion.options[x])), feedback: ''});
          S.histories.set(quiz.historyKey, quiz.history);
          click(submit); setStatus('Đã gửi đáp án; đợi kết quả.'); return;
        }
        return;
      }
      if (wrong || correct) { setStatus('Đang có phản hồi câu hỏi; chờ xử lý trước khi chuyển video.'); return; }
      if (!snap.p.present) { setStatus('Chưa đọc được thanh thời gian. Không đủ dữ liệu để chuyển slide.'); return; }
      if (!ended || !settled) { setStatus(snap.p.value == null ? 'Thanh thời gian chưa đọc được giá trị; cần cấu hình nhận diện.' : `Đang xem · ${Math.floor(snap.p.value * 100)}%`); return; }
      const next = button('next');
      if (next) { S.action = {kind: 'next', at: now, signature: snap.signature}; click(next); setStatus('Đã hết thời gian. Đã bấm Tiếp theo.'); }
      else setStatus('Đã hết thời gian; đợi câu hỏi hoặc nút Tiếp theo xuất hiện.');
    } catch (error) {
      if (S.running && generation === S.generation) halt(error.message);
    } finally { S.busy = false; }
  }
  function start(run, playbackOnly = false) {
    stopLocal(S.running && S.playbackOnly && S.session === run.session);
    S.session = run.session; S.config = run.config; S.running = true; S.playbackOnly = playbackOnly; S.lastStatus = ''; S.root = null; S.quiz = null; S.histories.clear();
    playback(S.config.backgroundPlayback !== false);
    resetSlide(''); S.timer = setInterval(tick, 350); tick();
  }
  function diagnose() {
    const snap = snapshot();
    const describe = el => ({tag: el.tagName, id: el.id, class: el.getAttribute('class'), role: el.getAttribute('role'), label: text(el).slice(0, 1500),
      min: el.matches('input[type="range"]') ? el.min || '0' : el.getAttribute('aria-valuemin'),
      max: el.matches('input[type="range"]') ? el.max || '100' : el.getAttribute('aria-valuemax'),
      now: el.matches('input[type="range"]') ? el.value : el.getAttribute('aria-valuenow'),
      step: el.matches('input[type="range"]') ? el.step || '1' : null,
      valueText: el.getAttribute('aria-valuetext'), checked: selected(el), enabled: enabled(el)});
    return {origin: location.origin, title: document.title, root: snap.root ? describe(snap.root) : null,
      text: snap.root ? visibleText(snap.root) : '', progress: snap.p, backgroundPlayback: playbackState,
      review: currentReview(), reviewReturn: S.reviewReturn ? {target: S.reviewReturn.target, phase: S.reviewReturn.phase} : null,
      videoReturn: S.videoReturn ? {target:S.videoReturn.target,phase:S.videoReturn.phase} : null,
      controls: query('button, [role="button"], [role="radio"], [role="checkbox"], input, [role="slider"], [role="progressbar"], .seekbar, #seekbar').filter(visible).map(describe),
      question: snap.q ? {text: snap.q.text, options: snap.q.options, error: snap.q.error} : null};
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type === 'PREPARE_PLAYBACK') start(message.run, true);
    if (message.type === 'START') start(message.run);
    if (message.type === 'STOP') stopLocal();
    if (message.type === 'DIAGNOSE') {
      try { reply(diagnose()); } catch (error) { reply({error: error.message}); }
    } else reply({ok: true});
  });
  globalThis.__lessonAssistant = {snapshot, diagnose, tick};
  const helloGeneration = S.generation;
  sendMessage({type: 'HELLO'}).then(run => {
    if (S.generation === helloGeneration && (run?.running || run?.playbackOnly) && contextAlive()) start(run, !run.running);
  }).catch(() => {});
})();
