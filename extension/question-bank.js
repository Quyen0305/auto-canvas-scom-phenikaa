// A permanent archive, separate from AI caches and the solver's retry state.
globalThis.QuestionBank = (() => {
  const PREFIX = 'suite:question:', ERROR = 'suite:archiveError';
  let queue = Promise.resolve();
  const clean = value => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  const serial = task => { const next = queue.then(task); queue = next.catch(() => {}); return next; };
  async function hash(value) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function context(sender, input = {}) {
    if (!Number.isInteger(sender.tab?.id)) throw Error('Không xác định được trang học.');
    let url = new URL(sender.url || sender.tab.url);
    if (sender.tab.url && new URL(sender.tab.url).hostname === 'scorm.eduone.io.vn') url = new URL(sender.tab.url);
    if (!['https:', 'http:', 'file:'].includes(url.protocol)) url = new URL(sender.tab.url);
    const scorm = url.hostname === 'scorm.eduone.io.vn';
    const quiz = url.pathname.match(/^(.*\/courses\/([^/]+))\/quizzes\/([^/]+)/);
    if (!scorm && !quiz && url.protocol !== 'file:') throw Error('Trang không hỗ trợ lưu câu hỏi.');
    const courseId = scorm ? url.origin + url.pathname.split('/').slice(0, 4).join('/') : quiz ? url.origin + quiz[1] : url.pathname;
    const exerciseId = scorm ? clean(input.exerciseId || input.exerciseTitle || 'Bài học') : quiz ? quiz[3] : clean(input.exerciseTitle || 'Bài tập');
    return {source: scorm ? 'SCORM' : 'Canvas', courseId, exerciseId,
      scope: JSON.stringify([courseId, exerciseId]),
      courseTitle: clean(input.courseTitle).slice(0, 500) || 'Học phần ' + (quiz ? quiz[2] : courseId.split('/').filter(Boolean).at(-1) || 'chưa có tên'),
      exerciseTitle: clean(input.exerciseTitle).slice(0, 500) || (quiz ? 'Bài tập ' + quiz[3] : 'Bài học'),
      // Never persist login query strings, fragments, or the sender's full tab object.
      url: url.protocol === 'file:' ? '' : url.origin + url.pathname,
      attempt: clean(input.attempt).slice(0, 120) || String(sender.documentId || sender.tab.id + ':' + (sender.frameId || 0))};
  }
  function question(input) {
    const text = clean(input?.questionText ?? input?.text);
    const options = input?.options?.map(clean);
    if (!text || text.length > 32767 || !Array.isArray(options) || options.length < 2 || options.length > 100 || options.some(x => !x || x.length > 32767)) throw Error('Nội dung câu hỏi không hợp lệ để lưu.');
    return {text, options, multiple: input.multiple === true || input.questionType === 'multiple_answers_question'};
  }
  function selection(q, indices) {
    if (!Array.isArray(indices) || !indices.length || indices.some(i => !Number.isInteger(i) || i < 0 || i >= q.options.length) || new Set(indices).size !== indices.length || (!q.multiple && indices.length !== 1)) return [];
    return indices.map(i => q.options[i]).sort();
  }
  async function record(sender, input) {
    const ctx = context(sender, input.context), items = input.items;
    if (!Array.isArray(items) || items.length > 500) throw Error('Danh sách câu hỏi không hợp lệ.');
    return serial(async () => {
      let count = 0;
      for (const item of items) {
        const q = question(item.question);
        const id = PREFIX + await hash(JSON.stringify([ctx.scope, q.text, q.multiple, [...q.options].sort()]));
        const old = (await chrome.storage.local.get(id))[id];
        const at = Date.now();
        const entry = old || {version: 1, ...ctx, question: q, events: [], firstSeen: at};
        // A later visit may expose breadcrumb titles that were absent on /take.
        if (input.context?.courseTitle) entry.courseTitle = ctx.courseTitle;
        if (input.context?.exerciseTitle) entry.exerciseTitle = ctx.exerciseTitle;
        const answers = selection(q, item.selected_indices);
        const kind = ['seen', 'selected', 'submitted', 'ai', 'graded'].includes(item.kind) ? item.kind : 'seen';
        const correct = kind === 'graded' && answers.length && typeof item.correct === 'boolean' ? item.correct : null;
        const event = {attempt: ctx.attempt, kind, answers, correct, options: [...q.options],
          indices: answers.length ? [...item.selected_indices] : [], reason: clean(item.reason).slice(0, 12000), at};
        const eventKey = JSON.stringify([ctx.attempt, clean(item.eventId).slice(0, 150), kind, answers, correct]);
        const existing = entry.events.find(e => e.key === eventKey);
        if (!existing) entry.events.push({...event, key: eventKey});
        else if (event.reason) existing.reason = event.reason;
        entry.lastSeen = at;
        await chrome.storage.local.set({[id]: entry});
        count++;
      }
      return {count};
    });
  }
  async function captureCanvas(request, sender, response) {
    const actions = ['SOLVE_QUESTION', 'SOLVE_QUESTIONS', 'GET_CACHED_ANSWERS', 'SOLVE_CHROME_AI', 'RECORD_QUIZ_RESULTS'];
    if (!actions.includes(request.action)) return;
    const data = request.data || {}, ctx = data.archiveContext || {};
    let items;
    if (request.action === 'RECORD_QUIZ_RESULTS') {
      if (!response?.success) return;
      items = (data.observations || []).filter(o => Number.isFinite(o.earned) && Number.isFinite(o.possible) && o.possible > 0 && o.earned >= 0 && o.earned <= o.possible)
        .map(o => ({question: o.question, selected_indices: o.selected_indices, kind: 'graded', correct: o.earned === o.possible, reason: `Canvas chấm ${o.earned}/${o.possible} điểm.`}));
    } else {
      const questions = data.questions || (data.question ? [data.question] : data.questionText ? [data] : []);
      const result = response?.success ? response.data : null;
      const answers = result?.answers || (result ? [result] : []);
      items = questions.map(q => {
        const answer = answers.find(a => a && a.id === q.id) || (questions.length === 1 && answers.length === 1 ? answers[0] : null);
        return {question: q, kind: answer ? answer.verified === true ? 'graded' : 'ai' : 'seen', selected_indices: answer?.selected_indices,
          correct: answer?.verified === true ? true : null, reason: answer?.explanation};
      });
    }
    if (items.length) await record(sender, {context: ctx, items});
  }
  async function failure(error) {
    console.warn('Không lưu được kho câu hỏi:', error.message);
    try { await chrome.storage.local.set({[ERROR]: {message: String(error.message).slice(0, 500), at: Date.now()}}); } catch {}
  }
  async function list() {
    await queue;
    const all = await chrome.storage.local.get(null);
    return {entries: Object.entries(all).filter(([key]) => key.startsWith(PREFIX)).map(([, value]) => value), warning: all[ERROR]?.message || ''};
  }
  function result(entry) {
    const passed = entry.events.filter(e => e.kind === 'graded' && e.correct === true);
    const sets = [...new Set(passed.map(e => JSON.stringify(e.answers)))];
    const answers = sets.length === 1 ? JSON.parse(sets[0]) : [];
    const ambiguous = new Set(entry.question.options).size !== entry.question.options.length;
    const conflict = sets.length > 1 || answers.length > 0 && entry.events.some(e => e.correct === false && JSON.stringify(e.answers) === sets[0]);
    const verified = answers.length > 0 && !conflict && !ambiguous;
    return {verified, answers: verified ? answers : [], status: conflict ? 'Kết quả chấm mâu thuẫn' : ambiguous ? 'Lựa chọn trùng nội dung, cần kiểm tra' : verified ? 'Đã được bài chấm đúng' : 'Chưa xác nhận đáp án đúng'};
  }
  return {record, captureCanvas, failure, list, result, clean};
})();
