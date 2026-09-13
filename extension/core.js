/* Shared pure functions; also loaded by the Node test suite. */
(function (scope) {
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
  const defaults = {
    provider: 'gemini', model: 'gemini-2.5-flash', maxAttempts: 3, settleMs: 1800, backgroundPlayback: true,
    selectors: {root: '', progress: '', fill: '', next: '', submit: '', continue: '', retry: '', question: '', choices: '', correct: '', incorrect: '', complete: ''}
  };
  function validateAnswer(value, count, multiple) {
    if (!value || !Array.isArray(value.answers) || !value.answers.length ||
        value.answers.some(x => !Number.isInteger(x) || x < 1 || x > count) ||
        new Set(value.answers).size !== value.answers.length || (!multiple && value.answers.length !== 1)) {
      throw new Error('AI trả về đáp án không hợp lệ; chưa gửi đáp án.');
    }
    return value.answers.map(x => x - 1).sort((a, b) => a - b);
  }
  function validateQuestion(q) {
    if (!q || typeof q.text !== 'string' || !q.text.trim() || q.text.length > 20000 || !Array.isArray(q.options) ||
        q.options.length < 2 || q.options.length > 30 || q.options.some(x => typeof x !== 'string' || !x.trim() || x.length > 4000) ||
        typeof q.multiple !== 'boolean' || !Array.isArray(q.history) || q.history.length > 5 || q.history.some(h =>
          !h || !Array.isArray(h.answers) || h.answers.some(n => !Number.isInteger(n) || n < 1 || n > q.options.length) ||
          typeof h.feedback !== 'string' || h.feedback.length > 4000)) throw new Error('Không đọc được đầy đủ câu hỏi và đáp án.');
  }
  function providerName(config) { return config?.provider === 'builtin' ? 'Chrome AI' : 'Gemini'; }
  function ratio(now, min, max) {
    if ([now, min, max].some(x => x == null || x === '')) return null;
    const [n, lo, hi] = [now, min, max].map(Number);
    return [n, lo, hi].every(Number.isFinite) && hi > lo ? Math.max(0, Math.min(1, (n - lo) / (hi - lo))) : null;
  }
  function rangeProgress(now, min, max, step, reportedComplete = false) {
    const value = ratio(now, min, max);
    let done = value === 1;
    const [n, lo, hi, increment] = [now, min, max, step].map(Number);
    if (!done && reportedComplete && value != null && Number.isFinite(increment) && increment > 0) {
      // Storyline: max=28757, step=100, value=28700, aria-valuetext="100%".
      // HTML range sanitization rounds the value to an allowed step; max may
      // be unreachable. Require BOTH the last step and the player's end signal.
      const lastStep = lo + Math.floor((hi - lo) / increment) * increment;
      const epsilon = Math.max(1, Math.abs(hi), Math.abs(increment)) * Number.EPSILON * 8;
      done = lastStep > lo && hi - lastStep > epsilon && n >= lastStep - epsilon && n <= hi;
    }
    return {value: done && reportedComplete ? 1 : value, done};
  }
  function questionKey(text, options, multiple) { return JSON.stringify([normalize(text), options.map(normalize), !!multiple]); }
  const answerIdentity = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  function historyKey(text, options, multiple) {
    const values = options.map(answerIdentity);
    // Duplicate labels cannot be safely remapped by text.
    return JSON.stringify([answerIdentity(text), new Set(values).size === values.length ? [...values].sort() : values, !!multiple]);
  }
  function remapHistory(history, options) {
    const values = options.map(answerIdentity);
    return history.flatMap(entry => {
      if (!entry.answerTexts?.length) return [];
      const answers = entry.answerTexts.map(value => values.indexOf(value) + 1).sort((a,b) => a-b);
      if (answers.some(n => n < 1) || entry.answerTexts.some(value => values.filter(v => v === value).length !== 1)) {
        throw new Error('Không đối chiếu được đáp án đã thử với các lựa chọn hiện tại; đã dừng để tránh gửi lặp.');
      }
      return [{...entry, answers}];
    });
  }
  function remainingSingleAnswer(count, multiple, history) {
    if (multiple || !Number.isInteger(count) || count < 2) return null;
    const wrong = new Set(history.filter(h => h.confirmedWrong === true && h.answers?.length === 1)
      .map(h => h.answers[0]).filter(n => Number.isInteger(n) && n >= 1 && n <= count));
    const remaining = Array.from({length: count}, (_, i) => i).filter(i => !wrong.has(i + 1));
    return remaining.length === 1 ? remaining[0] : null;
  }
  function completion(text) { return /\b(hoan thanh bai hoc|da hoan thanh (bai hoc|khoa hoc)|bai hoc da hoan thanh|ket thuc bai hoc|lesson complete|course complete|you have completed)\b/.test(normalize(text)); }
  const api = {normalize, defaults, validateQuestion, providerName, validateAnswer, ratio, rangeProgress, questionKey, answerIdentity, historyKey, remapHistory, remainingSingleAnswer, completion};
  scope.LessonCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
