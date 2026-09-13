(function(chrome) {
// Persist only grading evidence from Canvas, separately from speculative AI cache.
globalThis.QuizLearning = (() => {
  const KEY = "canvasGradedAnswersV1";
  let writes = Promise.resolve();
  const normalize = text => text.normalize("NFC").replace(/\s+/g, " ").trim();
  const setKey = texts => JSON.stringify(texts.map(normalize).sort());
  async function key(scope, question) {
    const value = JSON.stringify([scope, normalize(question.questionText), question.questionType || "multiple_choice_question", question.options.map(normalize).sort()]);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
  }
  async function read() { return (await chrome.storage.local.get(KEY))[KEY] || {}; }
  function serial(operation) {
    const result = writes.then(operation);
    writes = result.catch(() => {});
    return result;
  }
  async function record(scope, observations) {
    return serial(async () => {
      const entries = await read();
      let count = 0;
      for (const observation of observations) {
        const { question, selected_indices: indices, earned, possible } = observation;
        if (!Number.isFinite(earned) || !Number.isFinite(possible) || possible <= 0 || earned < 0 || earned > possible ||
            !Array.isArray(indices) || !indices.length || new Set(indices).size !== indices.length ||
            !indices.every(i => Number.isInteger(i) && i >= 0 && i < question.options.length) ||
            (question.questionType !== "multiple_answers_question" && indices.length !== 1)) continue;
        const normalizedOptions = question.options.map(normalize);
        // Duplicate option text cannot be mapped safely after a shuffle.
        if (new Set(normalizedOptions).size !== normalizedOptions.length) continue;
        const id = await key(scope, question);
        const entry = entries[id] || { correct: null, rejected: [], conflict: false };
        const selected = indices.map(i => normalizedOptions[i]).sort();
        const selection = setKey(selected);
        if (earned === possible) {
          if ((entry.correct && setKey(entry.correct) !== selection) || entry.rejected.some(set => setKey(set) === selection)) entry.conflict = true;
          entry.correct = selected;
        } else {
          // Partial credit rejects only this complete combination, never each member.
          if (entry.correct && setKey(entry.correct) === selection) entry.conflict = true;
          if (!entry.rejected.some(set => setKey(set) === selection)) entry.rejected.push(selected);
        }
        entry.updatedAt = Date.now();
        entries[id] = entry;
        count++;
      }
      await chrome.storage.local.set({ [KEY]: Object.fromEntries(Object.entries(entries).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 2000)) });
      return { count };
    });
  }
  async function lookup(scope, question) {
    const entry = (await read())[await key(scope, question)];
    if (!entry) return {};
    if (entry.conflict) throw new Error("Canvas đã chấm khác nhau cho cùng đáp án. Hãy kiểm tra hoặc xóa bộ nhớ đã chấm trước khi tiếp tục.");
    const options = question.options.map(normalize);
    if (new Set(options).size !== options.length) return {};
    const map = texts => texts.map(text => options.indexOf(normalize(text)));
    const excluded = entry.rejected.map(map).filter(indices => indices.every(i => i >= 0));
    const indices = entry.correct && map(entry.correct);
    let answer = indices && indices.every(i => i >= 0) ? {
      id: question.id, answerable: true, selected_indices: indices,
      answer_texts: indices.map(i => question.options[i]),
      explanation: "Canvas đã chấm trọn điểm cho lựa chọn này ở lần làm trước.",
      source: "Canvas xác nhận đúng", cached: false, verified: true
    } : null;
    if (!answer && [undefined, "multiple_choice_question", "true_false_question"].includes(question.questionType)) {
      const rejected = new Set(excluded.filter(set => set.length === 1).map(set => set[0]));
      const remaining = options.flatMap((_, index) => rejected.has(index) ? [] : [index]);
      if (rejected.size > 0 && remaining.length === 1) {
        answer = {
          id: question.id, answerable: true, selected_indices: remaining,
          answer_texts: remaining.map(index => question.options[index]),
          explanation: "Canvas đã chấm sai " + rejected.size + "/" + options.length + " lựa chọn. Chọn lựa chọn duy nhất còn lại theo phương pháp loại trừ; chưa được Canvas xác nhận đúng.",
          source: "Loại trừ từ kết quả Canvas", cached: false, verified: false, inferred: true
        };
      }
    }
    return { answer, excluded };
  }
  async function clear() { return serial(async () => { await chrome.storage.local.remove(KEY); return { cleared: true }; }); }
  return { record, lookup, clear };
})();

})(CanvasCompat.create(false));
