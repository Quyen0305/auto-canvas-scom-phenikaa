// Observe question data only. This collector never selects, submits, or navigates.
(() => {
  if (globalThis.SuiteCapture) return;
  const clean = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  const pageId = globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random();
  function context(source = 'Canvas', providedDoc, providedUrl) {
    let doc = providedDoc || document;
    try { if (source === 'SCORM') doc = window.top.document; } catch {}
    const url = new URL(providedUrl || location.href);
    const courseLink = [...doc.querySelectorAll('#breadcrumbs a[href], .ic-app-nav-toggle-and-crumbs a[href]')].find(a => /\/courses\/[^/]+\/?$/.test(new URL(a.href, url).pathname));
    const course = courseLink?.textContent || doc.querySelector('[data-course-name]')?.getAttribute('data-course-name') || doc.querySelector('#course-title, .course-title')?.textContent;
    const current = document.querySelector('.cs-listitem.cs-selected[data-slide-title], .cs-listitem[aria-current="true"][data-slide-title]');
    const exerciseTitle = source === 'SCORM' ? current?.getAttribute('data-slide-title') || document.querySelector('#slide-label')?.textContent :
      doc.querySelector('#quiz_title, .quiz-title, h1.title')?.textContent || doc.querySelector('#breadcrumbs li:last-child')?.textContent;
    const title = clean(doc.title);
    return {courseTitle: clean(course) || (source === 'SCORM' && !/^(SCORM|Storyline)$/i.test(title) ? title : ''),
      exerciseTitle: clean(exerciseTitle), exerciseId: source === 'SCORM' ? current?.getAttribute('data-ref') || clean(exerciseTitle) : undefined,
      attempt: url.searchParams.get('version') || url.searchParams.get('attempt') || url.pathname.match(/\/submissions\/(\d+)$/)?.[1] || doc.querySelector('#submit_quiz_form input[name="attempt"]')?.value || pageId};
  }
  async function record(ctx, items) {
    const reply = await chrome.runtime.sendMessage({action: 'BANK_RECORD', data: {context: ctx, items}});
    if (!reply?.success) throw Error(reply?.error || 'Không lưu được kho câu hỏi.');
    return reply.data;
  }
  function text(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script,style,.canvas-ai-badge,[hidden]').forEach(n => n.remove());
    clone.querySelectorAll('br').forEach(n => n.replaceWith(' '));
    clone.querySelectorAll('p,div,li,pre,tr').forEach(n => n.append(' '));
    return clean(clone.textContent);
  }
  function readCanvas(doc) {
    const review = !!doc.querySelector('#questions.assessment_results');
    const items = [];
    for (const el of doc.querySelectorAll('.display_question.question, #questions .question')) {
      if (el.closest('[hidden], [aria-hidden="true"]')) continue;
      const options = [], inputs = [], rows = [], seen = new Set();
      for (const row of el.querySelectorAll('.answers .answer, .answer_row')) {
        const input = row.querySelector('input[type=radio],input[type=checkbox]');
        if (!input || seen.has(input)) continue;
        seen.add(input); inputs.push(input); rows.push(row);
        options.push(text(row.querySelector('.answer_label, .answer_text') || row));
      }
      const questionText = text(el.querySelector('.question_text, .textarea_question_text'));
      if (!questionText || options.length < 2 || options.some(x => !x)) continue;
      const multiple = el.classList.contains('multiple_answers_question') || text(el.querySelector('.question_type')) === 'multiple_answers_question';
      const question = {questionText, options, multiple};
      const selected_indices = inputs.flatMap((n, i) => n.checked ? [i] : []);
      const points = el.querySelector('.user_points')?.textContent.match(/^\s*(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/);
      const earned = points ? Number(points[1].replace(',', '.')) : NaN, possible = points ? Number(points[2].replace(',', '.')) : NaN;
      const graded = review && selected_indices.length && possible > 0 && earned >= 0 && earned <= possible;
      items.push({question, selected_indices, kind: graded ? 'graded' : selected_indices.length ? 'selected' : 'seen',
        correct: graded ? earned === possible : null, reason: graded ? `Canvas chấm ${earned}/${possible} điểm.` : ''});
      // Canvas reveals its key with correct_answer markers only on a graded review.
      const revealed = rows.flatMap((row, i) => row.matches('.correct_answer') || row.querySelector('.correct_answer') ? [i] : []);
      if (review && revealed.length && (multiple || revealed.length === 1)) items.push({question, selected_indices: revealed, kind: 'graded', correct: true, eventId: 'revealed', reason: 'Đáp án đúng hiển thị trên trang kết quả Canvas.'});
    }
    return items;
  }
  globalThis.SuiteCapture = {context, record, readCanvas};
  if (location.hostname === 'scorm.eduone.io.vn' || !/\/quizzes\//.test(location.pathname)) return;
  const historyVisited = new Set(); let historyRunning = false, historyDone = Promise.resolve();
  function historyLinks(doc, base) {
    const here = new URL(location.href), prefix = here.pathname.match(/^.*\/quizzes\/[^/]+/)?.[0];
    return [...doc.querySelectorAll('a[href]')].flatMap(link => {
      try {
        const u = new URL(link.getAttribute('href'), base), suffix = u.pathname.slice(prefix.length);
        if (u.origin !== here.origin || !u.pathname.startsWith(prefix) || u.username || u.password ||
          !(/^\/history\/?$/.test(suffix) || /^\/submissions\/\d+\/?$/.test(suffix))) return [];
        if ([...u.searchParams.keys()].some(k => !['version', 'attempt'].includes(k))) return [];
        u.hash = ''; return [u.href];
      } catch { return []; }
    });
  }
  async function collectHistory() {
    if (historyRunning) return historyDone;
    if (!document.querySelector('#questions.assessment_results')) return;
    historyRunning = true;
    let done; historyDone = new Promise(resolve => { done = resolve; });
    const pending = historyLinks(document, location.href);
    try {
      while (pending.length && !stopped) {
        const url = pending.shift(); if (historyVisited.has(url)) continue;
        historyVisited.add(url);
        const response = await fetch(url, {credentials:'same-origin', signal:AbortSignal.timeout(20000)});
        if (!response.ok || new URL(response.url).origin !== location.origin) throw Error('Không đọc được một lượt làm cũ của Canvas.');
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        if (!doc.querySelector('#questions.assessment_results')) throw Error('Canvas không còn hiển thị kết quả của một lượt làm cũ.');
        const items = readCanvas(doc), ctx = context('Canvas', doc, response.url);
        for (let i = 0; i < items.length; i += 100) await record(ctx, items.slice(i, i + 100));
        pending.push(...historyLinks(doc, response.url).filter(x => !historyVisited.has(x)));
      }
    } catch (error) {
      try { await chrome.runtime.sendMessage({action:'BANK_WARNING',data:{message:error.message}}); } catch {}
    } finally { historyRunning = false; done(); }
  }
  let last = '', timer, stopped = false, scanTask = null, scanError = null;
  async function scan() {
    if (stopped) return;
    if (scanTask) return scanTask;
    let done; scanTask = new Promise(resolve => { done = resolve; });
    try {
      const items = readCanvas(document), ctx = context(), key = JSON.stringify([ctx, items]);
      if (items.length && key !== last) {
        for (let i = 0; i < items.length; i += 100) await record(ctx, items.slice(i, i + 100));
        last = key; scanError = null;
      }
      void collectHistory();
    } catch (error) { scanError = error; if (/context invalidated/i.test(error.message)) stopped = true; }
    finally { scanTask = null; done(); }
  }
  const schedule = () => { clearTimeout(timer); if (!stopped) timer = setTimeout(scan, 500); };
  new MutationObserver(schedule).observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'checked']});
  document.addEventListener('change', () => { void scan(); }, true);
  document.addEventListener('click', schedule, true);
  chrome.runtime.onMessage?.addListener((message, sender, reply) => {
    if (message.action !== 'BANK_FLUSH' || sender.id && sender.id !== chrome.runtime.id) return;
    scan().then(() => collectHistory()).then(() => scan()).then(() => {
      if (scanError) throw scanError;
      reply({success:true});
    }).catch(error => reply({success:false,error:error.message}));
    return true;
  });
  schedule();
})();
