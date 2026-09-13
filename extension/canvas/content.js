(function(chrome) {
// Canvas Auto Quiz Solver Content Script

(function () {
  globalThis.__canvasAiCleanup?.();
  let isAutoRunning = false;
  let activeSolve = null;
  let completedRun = null;
  let contextLost = false;
  let destroyed = false;
  let resumeTimer;
  let targetMode = false;
  let cleanupDrag = () => {};
  globalThis.__canvasAiCleanup = () => {
    destroyed = true;
    isAutoRunning = false;
    activeSolve?.abort();
    clearTimeout(resumeTimer);
    document.removeEventListener("DOMContentLoaded", initWidget);
    cleanupDrag();
    document.getElementById("canvas-ai-solver-widget")?.remove();
  };
  // Keep these batch limits in sync with background.js.
  const MAX_BATCH_QUESTIONS = 10;
  const MAX_BATCH_CHARS = 24000;

  // Initialize Extension UI when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWidget);
  } else {
    initWidget();
  }

  function initWidget() {
    if (destroyed) return;
    // An extension reload leaves the old DOM widget behind with dead listeners.
    document.getElementById("canvas-ai-solver-widget")?.remove();

    // Check if this page is a Canvas Quiz page
    const quizForm = document.querySelector("#submit_quiz_form, #questions, .quiz_sortable, #take_quiz_link");
    if (!quizForm) return;

    createFloatingWidget();
  }

  function createFloatingWidget() {
    const widget = document.createElement("div");
    widget.id = "canvas-ai-solver-widget";
    widget.innerHTML = `
      <div class="canvas-ai-header" id="canvas-ai-drag-handle">
        <div class="canvas-ai-title">⚡ Canvas Quiz Solver AI</div>
        <div class="canvas-ai-controls">
          <button class="canvas-ai-btn-icon" id="canvas-ai-toggle-btn" title="Thu nhỏ/Mở rộng">_</button>
        </div>
      </div>
      <div class="canvas-ai-body">
        <div class="canvas-ai-actions">
          <button id="canvas-ai-solve-current" class="canvas-ai-btn canvas-ai-btn-primary">⚡ Giải câu này</button>
          <button id="canvas-ai-auto-all" class="canvas-ai-btn canvas-ai-btn-success">🚀 Tự động làm</button>
        </div>
        <button id="canvas-ai-target" class="canvas-ai-btn canvas-ai-btn-success">🎯 Làm đến 10 điểm</button>
        <small class="canvas-ai-target-help">Tự nộp bài và làm lại đến 10 điểm. Dùng nút Dừng để hủy.</small>
        <button id="canvas-ai-stop" class="canvas-ai-btn canvas-ai-btn-danger" style="display: none;">⏹️ Dừng</button>
        
        <div id="canvas-ai-status-msg" class="canvas-ai-status">Sẵn sàng. Bấm "Giải câu này" hoặc "Tự động làm".</div>
        <div id="canvas-ai-results" class="canvas-ai-explanation-box" aria-live="polite"></div>
      </div>
    `;

    document.body.appendChild(widget);

    // Make widget draggable
    makeDraggable(widget, widget.querySelector("#canvas-ai-drag-handle"));

    // Event listeners
    document.getElementById("canvas-ai-toggle-btn").addEventListener("click", () => {
      widget.classList.toggle("minimized");
    });

    document.getElementById("canvas-ai-solve-current").addEventListener("click", () => {
      solveCurrentQuestion();
    });

    document.getElementById("canvas-ai-auto-all").addEventListener("click", () => {
      startAutoSolve();
    });

    document.getElementById("canvas-ai-stop").addEventListener("click", () => {
      stopAutoSolve();
    });
    document.getElementById("canvas-ai-target").addEventListener("click", startTargetScore);

    // Check if auto-running state was set prior to page reload (for 1 question at a time)
    getStoredConfig().then(() => sendBackground("GET_AUTO_STATE", {})).then(async response => {
      if (destroyed) return;
      if (isReviewPage()) await saveReview();
      if (destroyed) return;
      if (response.success && response.data.enabled) {
        targetMode = response.data.mode === "target";
        resumeTimer = setTimeout(() => {
          if (!destroyed && !contextLost) {
            if (targetMode) continueTarget(response.data);
            else startAutoSolve();
          }
        }, 1200);
      }
    }).catch(reportError);
  }

  function updateStatus(msg, type = "") {
    if (destroyed) return;
    const statusEl = document.getElementById("canvas-ai-status-msg");
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = "canvas-ai-status " + type;
  }

  // Parse questions from Canvas DOM
  function cleanQuestionText(element) {
    if (!element) return "";
    const clone = element.cloneNode(true);
    clone.querySelectorAll(".canvas-ai-badge, script, style, [hidden]").forEach(node => node.remove());
    clone.querySelectorAll("br").forEach(node => node.replaceWith("\n"));
    clone.querySelectorAll("p, div, li, pre, tr").forEach(node => node.append("\n"));
    return clone.textContent.trim();
  }

  function getQuestionsOnPage() {
    const questionEls = document.querySelectorAll(".display_question.question, #questions .question");
    const questions = [];

    questionEls.forEach((qEl) => {
      if (qEl.offsetParent === null || qEl.hidden || qEl.getAttribute("aria-hidden") === "true") return;

      const qId = qEl.id || qEl.getAttribute("name");
      
      // Question text
      const qTextEl = qEl.querySelector(".question_text") || qEl.querySelector(".textarea_question_text");
      const questionText = cleanQuestionText(qTextEl);

      // Question type
      const typeEl = qEl.querySelector(".question_type");
      let questionType = typeEl ? typeEl.textContent.trim() : "multiple_choice_question";
      if (qEl.classList.contains("multiple_answers_question")) {
        questionType = "multiple_answers_question";
      }

      // Options
      const answerEls = qEl.querySelectorAll(".answers .answer, .answer_row");
      const options = [];
      const seenInputs = new Set();
      answerEls.forEach((aEl) => {
        // Canvas nests .answer_row inside .answer, so the selector matches both.
        // A real radio/checkbox is one choice, regardless of how many wrappers match.
        const inputEl = aEl.querySelector("input[type='radio'], input[type='checkbox']");
        if (!inputEl || seenInputs.has(inputEl)) return;
        seenInputs.add(inputEl);
        const labelEl = aEl.querySelector(".answer_label") || aEl.querySelector(".answer_text") || aEl;
        
        const text = cleanQuestionText(labelEl);
        options.push({
          text: text,
          inputEl: inputEl,
          containerEl: aEl
        });
      });

      if (questionText && options.length > 0) {
        questions.push({
          id: qId,
          element: qEl,
          text: questionText,
          type: questionType,
          options: options
        });
      }
    });

    return questions;
  }

  function throwIfCancelled(signal) {
    if (signal.aborted || destroyed) throw new DOMException("Đã dừng.", "AbortError");
  }

  function waitForRetry(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException("Đã dừng.", "AbortError"));
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", cancel);
        resolve();
      }, ms);
      function cancel() {
        clearTimeout(timer);
        reject(new DOMException("Đã dừng.", "AbortError"));
      }
      signal.addEventListener("abort", cancel, { once: true });
    });
  }

  function extensionError(error) {
    if (/extension context invalidated/i.test(error.message || "") || !chrome.runtime?.id) {
      return Object.assign(new Error("Extension vừa được tải lại hoặc cập nhật. Mở popup và bấm Kết nối lại trang Canvas. Nếu chưa được, hãy lưu tiến độ bài rồi tải lại trang (F5)."), { code: "EXTENSION_CONTEXT_INVALIDATED" });
    }
    return error;
  }

  function requireExtension() {
    if (!chrome.runtime?.id || contextLost) throw extensionError(new Error("Extension context invalidated."));
  }

  function reportError(error) {
    if (destroyed) return;
    const normalized = extensionError(error);
    if (normalized.code === "EXTENSION_CONTEXT_INVALIDATED") {
      contextLost = true;
      isAutoRunning = false;
      activeSolve?.abort();
      clearTimeout(resumeTimer);
      setSolveButtonsDisabled(true);
      const stop = document.getElementById("canvas-ai-stop");
      if (stop) stop.style.display = "none";
    }
    if (normalized.name !== "AbortError") updateStatus(normalized.message || String(normalized), "error");
  }

  function extensionStorage(method, value) {
    return new Promise((resolve, reject) => {
      try {
        requireExtension();
        chrome.storage.local[method](value, result => {
          const error = chrome.runtime.lastError;
          if (error) reject(extensionError(new Error(error.message)));
          else resolve(result);
        });
      } catch (error) { reject(extensionError(error)); }
    });
  }

  function sendBackground(action, data, signal) {
    return new Promise((resolve, reject) => {
      const cancel = () => reject(new DOMException("Đã dừng.", "AbortError"));
      try {
        requireExtension();
        signal?.throwIfAborted();
        signal?.addEventListener("abort", cancel, { once: true });
        chrome.runtime.sendMessage({ action, data }, result => {
          signal?.removeEventListener("abort", cancel);
          const error = chrome.runtime.lastError;
          if (error) return reject(extensionError(new Error(error.message)));
          if (!result) return reject(new Error("Không nhận được phản hồi từ background. Hãy kết nối lại trang Canvas từ popup."));
          resolve(result);
        });
      } catch (error) {
        signal?.removeEventListener("abort", cancel);
        reject(extensionError(error));
      }
    });
  }

  function serializeQuestion(question) {
    return {
      id: question.requestId, questionText: question.text, questionType: question.type,
      options: question.options.map(option => option.text)
    };
  }

  function groupQuestions(questions) {
    const groups = [];
    let group = [];
    for (const question of questions) {
      if (group.length && (group.length >= MAX_BATCH_QUESTIONS ||
          JSON.stringify([...group, question].map(serializeQuestion)).length > MAX_BATCH_CHARS)) {
        groups.push(group);
        group = [];
      }
      group.push(question);
    }
    if (group.length) groups.push(group);
    return groups;
  }

  async function callGeminiApi(config, questions, signal, deadline = Date.now() + 15 * 60 * 1000) {
    let failures = 0;
    while (failures < 5) {
      throwIfCancelled(signal);
      if (Date.now() >= deadline) throw new Error("Đã chờ Gemini quá lâu. Vui lòng kiểm tra hạn mức trong Google AI Studio.");
      const response = await sendBackground("SOLVE_QUESTIONS", {
        apiKey: config.apiKey, model: config.aiModel, attempt: failures,
        questions: questions.map(serializeQuestion)
      });
      throwIfCancelled(signal);
      if (response.success) return response.data;
      if (response.code === "INVALID_RESPONSE" && questions.length > 1) {
        updateStatus("Gemini trả lời nhóm chưa đầy đủ. Đang tách từng câu để giải lại...", "running");
        const answers = [];
        for (const question of questions) {
          throwIfCancelled(signal);
          const result = await callGeminiApi(config, [question], signal, deadline);
          answers.push(...result.answers);
        }
        return { answers };
      }
      // Preserve fallback for a missing model, but never switch models to evade 429.
      if (response.code === "HTTP_404" && config.aiModel !== "gemini-2.5-flash") {
        config.aiModel = "gemini-2.5-flash";
        continue;
      }
      if (response.code !== "COOLDOWN") failures++;
      if (!response.retryable || failures >= 5) {
        throw new Error(response.error + (failures >= 5 ? " Đã thử tối đa 5 lần; tự động đã dừng." : ""));
      }
      const waitUntil = Date.now() + Math.max(1000, response.retryAfterMs || 1000);
      if (waitUntil >= deadline) throw new Error(response.error + " Thời gian chờ quá dài; vui lòng thử lại sau.");
      while (Date.now() < waitUntil) {
        throwIfCancelled(signal);
        const seconds = Math.ceil((waitUntil - Date.now()) / 1000);
        const label = response.code === "COOLDOWN" ? "Đang chờ lượt gọi Gemini" : "Gemini tạm giới hạn hoặc gặp lỗi";
        updateStatus(label + ": chờ " + seconds + "s để thử lại...", "running");
        await waitForRetry(Math.min(1000, waitUntil - Date.now()), signal);
      }
    }
  }

  let localRequestSequence = 0;
  async function callChromeBuiltInAi(question, signal) {
    throwIfCancelled(signal);
    const requestId = Date.now() + ":" + (++localRequestSequence);
    const cancel = () => {
      // The owner tab/document is checked again in the background.
      void sendBackground("CANCEL_CHROME_AI", { requestId }).catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const response = await sendBackground("SOLVE_CHROME_AI", {
        requestId, question: serializeQuestion(question)
      }, signal);
      throwIfCancelled(signal);
      if (!response.success) throw Object.assign(new Error(response.error), { code: response.code });
      return response.data;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }

  function setSolveButtonsDisabled(disabled) {
    if (destroyed) return;
    for (const id of ["canvas-ai-solve-current", "canvas-ai-auto-all", "canvas-ai-target"]) {
      const button = document.getElementById(id);
      if (button) button.disabled = disabled || contextLost;
    }
  }

  function questionSnapshot(question) {
    return JSON.stringify([question.id, question.text, question.type, question.options.map(option => option.text)]);
  }

  function verifyPageAnswers(records, requireChecked = false) {
    const current = getQuestionsOnPage();
    for (const { question, answer } of records) {
      const live = current.find(item => question.element ? item.element === question.element : question.id && item.id === question.id);
      if (!live || questionSnapshot(live) !== questionSnapshot(question) || question.element?.isConnected === false ||
          live.options.some((option, index) => option.inputEl !== question.options[index].inputEl)) {
        throw new Error("Câu hỏi hoặc thứ tự đáp án đã thay đổi trong lúc AI xử lý. Đã dừng; hãy giải lại câu hiện tại.");
      }
      if (requireChecked && live.options.some((option, index) => !option.inputEl || option.inputEl.disabled ||
          option.inputEl.checked !== answer.selected_indices.includes(index))) {
        throw new Error("Chưa xác nhận được đáp án đã tích đúng trên trang. Đã dừng, không bấm Tiếp theo.");
      }
    }
  }

  function showAnswerResult(question, answer) {
    const panel = document.getElementById("canvas-ai-results");
    if (!panel) return;
    panel.style.display = "block";
    const card = document.createElement("section");
    const title = document.createElement("strong");
    title.textContent = answer.inferred ? "Loại trừ • Canvas" : (answer.cached ? "Cache • " : "AI • ") + answer.source;
    const questionEl = document.createElement("p");
    questionEl.textContent = question.text;
    const chosen = document.createElement("p");
    chosen.textContent = "Đề xuất: " + answer.selected_indices.map(index =>
      (index < 26 ? String.fromCharCode(65 + index) : String(index + 1)) + ". " + question.options[index].text).join("; ");
    const explanation = document.createElement("p");
    explanation.textContent = answer.explanation;
    card.append(title, questionEl, chosen, explanation);
    panel.appendChild(card);
  }

  async function solveCurrentQuestion() {
    if (activeSolve) return false;
    completedRun = null;
    const controller = new AbortController();
    activeSolve = controller;
    setSolveButtonsDisabled(true);
    document.getElementById("canvas-ai-stop").style.display = "block";
    try {
      requireExtension();
      if (isReviewPage()) throw new Error("Đây là trang đã chấm. Bấm Làm đến 10 điểm để bắt đầu lượt mới.");
      const resultsPanel = document.getElementById("canvas-ai-results");
      if (resultsPanel) { resultsPanel.textContent = ""; resultsPanel.style.display = "none"; }
      const questions = getQuestionsOnPage().map((q, index) => ({
        ...q, options: q.options.map(option => ({ ...option })), requestId: "q" + index
      }));
      if (!questions.length) throw new Error("Không tìm thấy câu hỏi nào!");
      const config = await getStoredConfig();
      if (targetMode) { config.autoClickAnswer = true; config.autoNextQuestion = true; }
      let pending = questions;
      let cachedCount = 0;
      let solvedCount = 0;
      const applied = [];
      const applyAnswers = (group, answers) => {
        throwIfCancelled(controller.signal);
        const byId = new Map();
        if (!Array.isArray(answers)) throw new Error("Thiếu đáp án từ background.");
        for (const answer of answers) {
          if (!answer || byId.has(answer.id)) throw new Error("Mã câu hỏi trong phản hồi bị trùng.");
          byId.set(answer.id, answer);
        }
        if (byId.size !== group.length) throw new Error("Số đáp án không khớp nhóm câu hỏi.");
        // Validate the whole group before touching any answer control.
        for (const q of group) {
          const answer = byId.get(q.requestId);
          const indices = answer?.selected_indices;
          if (!Array.isArray(indices) || !indices.length || new Set(indices).size !== indices.length ||
              !indices.every(index => Number.isInteger(index) && index >= 0 && index < q.options.length) ||
              (q.type !== "multiple_answers_question" && indices.length !== 1)) {
            throw new Error("AI trả về chỉ số đáp án không hợp lệ.");
          }
          if (answer.answerable !== true || typeof answer.explanation !== "string" || answer.explanation.trim().length < 10 ||
              typeof answer.source !== "string" || !answer.source || !Array.isArray(answer.answer_texts) ||
              answer.answer_texts.length !== indices.length || answer.answer_texts.some((text, index) =>
                typeof text !== "string" || text.trim() !== q.options[indices[index]].text.trim())) {
            throw new Error("AI chưa trả về đáp án kèm nội dung và giải thích hợp lệ. Đã dừng, không tự chọn hoặc chuyển câu.");
          }
        }
        verifyPageAnswers(group.map(question => ({ question, answer: byId.get(question.requestId) })));
        for (const q of group) {
          const answer = byId.get(q.requestId);
          showAnswerResult(q, answer);
          if (config.autoClickAnswer && q.options.some(option => !option.inputEl || option.inputEl.disabled)) {
            throw new Error("Không thể tích đáp án trên câu hỏi này. Đã giữ lại lời giải và dừng tự động.");
          }
          q.options.forEach((opt, index) => {
            const selected = answer.selected_indices.includes(index);
            if (config.autoClickAnswer && opt.inputEl && opt.inputEl.checked !== selected) {
              if (selected || opt.inputEl.type === "checkbox") opt.inputEl.click();
            }
            opt.containerEl?.classList.toggle("canvas-ai-selected-answer", selected);
            opt.containerEl?.querySelector(".canvas-ai-badge")?.remove();
            if (selected && opt.containerEl) {
              const badge = document.createElement("span");
              badge.className = "canvas-ai-badge";
              badge.textContent = "⚡ AI Chọn";
              (opt.containerEl.querySelector(".answer_label") || opt.containerEl).appendChild(badge);
            }
          });
          solvedCount++;
          if (answer.cached) cachedCount++;
          applied.push({ question: q, answer });
        }
        if (config.autoClickAnswer) verifyPageAnswers(applied, true);
      };

      // Selecting local AI never silently spends the user's Gemini API quota.
      if (config.aiEngine === "chrome_ai") {
        pending = [];
        for (const q of questions) {
          throwIfCancelled(controller.signal);
          updateStatus("⏳ Đang giải bằng Chrome Built-in AI trên máy...", "running");
          const answer = await callChromeBuiltInAi(q, controller.signal);
          applyAnswers([q], [answer]);
        }
      }

      if (pending.length) {
        throwIfCancelled(controller.signal);
        updateStatus("⏳ Đang kiểm tra đáp án đã lưu...", "running");
        const lookup = await sendBackground("GET_CACHED_ANSWERS", {
          model: config.aiModel, questions: pending.map(serializeQuestion)
        });
        throwIfCancelled(controller.signal);
        if (!lookup.success) throw new Error(lookup.error);
        const cached = lookup.data.answers;
        if (!Array.isArray(cached)) throw new Error("Phản hồi cache không hợp lệ.");
        const cachedIds = new Set(cached.map(answer => answer.id));
        applyAnswers(pending.filter(q => cachedIds.has(q.requestId)), cached);
        pending = pending.filter(q => !cachedIds.has(q.requestId));
        const groups = groupQuestions(pending);
        for (let index = 0; index < groups.length; index++) {
          throwIfCancelled(controller.signal);
          updateStatus("⏳ Đang giải nhóm " + (index + 1) + "/" + groups.length +
            " (" + groups[index].length + " câu); " + cachedCount + " câu từ cache...", "running");
          const result = await callGeminiApi(config, groups[index], controller.signal);
          applyAnswers(groups[index], result.answers);
        }
      }
      if (config.autoClickAnswer) await saveCanvasProgress(applied, controller.signal);
      updateStatus("✅ Đã " + (config.autoClickAnswer ? "tích chọn" : "đánh dấu") + " đáp án cho " +
        solvedCount + " câu (" + cachedCount + " câu từ cache).", "success");
      completedRun = { applied, autoClickAnswer: config.autoClickAnswer };
      return true;
    } catch (error) {
      reportError(error);
      return false;
    } finally {
      activeSolve = null;
      setSolveButtonsDisabled(isAutoRunning);
      if (!destroyed && !isAutoRunning) document.getElementById("canvas-ai-stop").style.display = "none";
    }
  }

  async function startAutoSolve() {
    if (isAutoRunning || activeSolve || destroyed) return;
    isAutoRunning = true;
    document.getElementById("canvas-ai-auto-all").style.display = "none";
    document.getElementById("canvas-ai-stop").style.display = "block";
    setSolveButtonsDisabled(true);
    try {
      await sendBackground("SET_AUTO_STATE", { enabled: true, mode: targetMode ? "target" : "normal", phase: "solving",
        ...(targetMode ? { attemptKey: currentAttemptKey() } : {}) });
      if (!isAutoRunning || destroyed) return;
      const solved = await solveCurrentQuestion();
      if (!isAutoRunning) return;
      if (!solved) {
        stopAutoSolve(false); // Preserve the actual error; never restart a failed retry loop.
        return;
      }
      const config = await getStoredConfig();
      if (targetMode) { config.autoClickAnswer = true; config.autoNextQuestion = true; }
      if (!isAutoRunning) return;
      if (config.autoNextQuestion && config.autoClickAnswer && completedRun?.autoClickAnswer) {
        verifyPageAnswers(completedRun.applied, true);
        if (targetMode) {
          await checkedBackground("SET_AUTO_STATE", { enabled: true, verifiedIds: completedRun.applied.map(record => record.question.id) });
          await submitTargetAttempt();
          return;
        }
        const nextBtn = document.querySelector("button.next-question, button[aria-label='Câu Hỏi Tiếp Theo']");
        if (nextBtn && !nextBtn.disabled) {
          const controller = new AbortController();
          activeSolve = controller;
          const delay = Math.max(1, Number(config.autoDelay) || 3);
          const until = Date.now() + delay * 1000;
          while (Date.now() < until) {
            throwIfCancelled(controller.signal);
            updateStatus("✅ Đã giải xong! Chờ " + Math.ceil((until - Date.now()) / 1000) + "s rồi chuyển câu...", "running");
            await waitForRetry(Math.min(1000, until - Date.now()), controller.signal);
          }
          throwIfCancelled(controller.signal);
          verifyPageAnswers(completedRun.applied, true);
          if (isAutoRunning) {
            const previous = getQuestionsOnPage().map(questionSnapshot).join("|");
            nextBtn.click();
            if (targetMode) watchTargetNavigation(previous);
          }
          return;
        }
        if (targetMode) { await submitTargetAttempt(); return; }
        updateStatus("🎉 Đã giải xong các câu hỏi trên trang!", "success");
      }
      if (!config.autoNextQuestion || !config.autoClickAnswer) {
        updateStatus("Đã hiển thị kết quả AI bên dưới. Bạn kiểm tra đáp án và tự bấm Tiếp theo.", "success");
      }
      stopAutoSolve(false);
    } catch (error) {
      reportError(error);
      stopAutoSolve(false);
    } finally {
      activeSolve = null;
      setSolveButtonsDisabled(isAutoRunning);
    }
  }

  async function saveCanvasProgress(records, signal) {
    throwIfCancelled(signal);
    verifyPageAnswers(records, true);
    const form = document.querySelector("#submit_quiz_form");
    const backupLink = form?.querySelector?.(".backup_quiz_submission_url[href]");
    const indicator = document.querySelector("#last_saved_indicator");
    if (!backupLink) {
      if (indicator?.tagName || form?.classList?.contains("one_question_at_a_time")) {
        throw new Error("Không tìm thấy đường dẫn lưu nháp Canvas. Đã giữ nguyên trang; chưa chuyển câu.");
      }
      return; // Other quiz layouts without Canvas Classic's autosave contract.
    }
    const url = new URL(backupLink.href, location.href);
    const quizPath = location.pathname.match(/^(.+\/quizzes\/[^/]+)/)?.[1];
    if (!quizPath || url.origin !== location.origin || url.pathname !== quizPath + "/submissions/backup") {
      throw new Error("Đường dẫn lưu nháp không thuộc bài hiện tại. Chưa chuyển câu.");
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 20000);
    try {
      // Let a pre-existing Canvas request finish before posting the current snapshot.
      // Never accept its old success text as proof that our new choice was saved.
      while (/^(?:saving\b|đang lưu)/i.test(indicator?.textContent.trim() || "")) {
        await waitForRetry(200, controller.signal);
      }
      throwIfCancelled(controller.signal);
      verifyPageAnswers(records, true);
      const body = canvasBackupBody(form);
      updateStatus("Đang lưu đáp án lên Canvas trước khi chuyển câu...", "running");
      const response = await fetch(url.href, {
        method: "PUT", credentials: "same-origin", redirect: "error",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "Accept": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body, signal: controller.signal
      });
      if (!response.ok) throw new Error("Canvas không lưu được đáp án (HTTP " + response.status + ").");
      const result = await response.json();
      if (result?.backup !== true) throw new Error("Canvas chưa xác nhận lưu nháp thành công; bài có thể đã hết giờ hoặc đã nộp.");
      throwIfCancelled(controller.signal);
      verifyPageAnswers(records, true);
      if (canvasBackupBody(form) !== body) throw new Error("Đáp án trên trang đã thay đổi trong lúc lưu. Hãy giải lại trước khi chuyển câu.");
      // Do not fabricate Canvas check marks or overwrite its own save indicator.
    } catch (error) {
      throwIfCancelled(signal);
      if (controller.signal.aborted) throw new Error("Canvas chưa lưu xong sau 20 giây. Đã giữ nguyên trang; chưa chuyển câu.");
      throw new Error("Chưa lưu tiến trình: " + error.message + " Đã giữ nguyên trang.");
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }

  function canvasBackupBody(form) {
    const body = new URLSearchParams();
    const fields = [...form.elements].filter(el => el.name && !el.disabled &&
      !["submit", "button", "reset", "image"].includes(el.type));
    for (const field of fields) {
      if (["radio", "checkbox"].includes(field.type) && !field.checked) continue;
      if (field.type === "file") {
        if (field.files?.length) throw new Error("Có tệp chưa được Canvas xử lý; hãy lưu bằng giao diện Canvas.");
        continue;
      }
      const multi = field.name.endsWith("[]");
      if (field.type === "hidden" && !multi && fields.some(other => other !== field && other.name === field.name &&
          other.type !== "hidden" && (!["radio", "checkbox"].includes(other.type) || other.checked))) continue;
      if (!multi && body.has(field.name) && field.type !== "checkbox") continue;
      if (!multi) body.delete(field.name);
      const values = field.tagName === "SELECT" && field.multiple ? [...field.selectedOptions].map(option => option.value) : [field.value];
      for (const value of values) body.append(field.name, value);
    }
    for (const question of form.querySelectorAll(".question_holder .question, .display_question.question")) {
      if (question.id) body.set(question.id + "_marked", question.classList.contains("marked") ? "1" : "");
    }
    // This endpoint saves progress only. It must not submit the quiz or redirect.
    for (const name of ["_method", "action", "leaving", "next_question_path"]) body.delete(name);
    return body.toString();
  }

  function stopAutoSolve(showMessage = true) {
    if (destroyed) return;
    isAutoRunning = false;
    targetMode = false;
    activeSolve?.abort();
    clearTimeout(resumeTimer);
    if (!contextLost && !destroyed) void sendBackground("SET_AUTO_STATE", { enabled: false }).catch(reportError);
    const autoBtn = document.getElementById("canvas-ai-auto-all");
    const stopBtn = document.getElementById("canvas-ai-stop");
    if (autoBtn) autoBtn.style.display = "block";
    if (stopBtn) stopBtn.style.display = "none";
    setSolveButtonsDisabled(Boolean(activeSolve));
    if (showMessage && !contextLost) updateStatus("Đã dừng. Kết quả đang gửi sẽ được bỏ qua.");
  }

  function isReviewPage() {
    return Boolean(document.querySelector("#questions.assessment_results")?.classList?.contains("assessment_results"));
  }

  async function checkedBackground(action, data) {
    const response = await sendBackground(action, data);
    if (!response.success) throw new Error(response.error || "Không lưu được trạng thái.");
    return response.data;
  }

  function readReview() {
    if (!isReviewPage()) throw new Error("Chưa thấy trang kết quả đã chấm.");
    const scoreEl = document.querySelector(".quiz_score .score_value");
    const number = value => Number(String(value).trim().replace(",", "."));
    const scoreText = scoreEl?.textContent.trim();
    const score = scoreText && /^\d+(?:[.,]\d+)?$/.test(scoreText) ? number(scoreText) : NaN;
    const possibleText = scoreEl?.parentElement.textContent.match(/(?:trên|out of|\/)\s*(\d+(?:[.,]\d+)?)/i)?.[1];
    const possible = possibleText ? number(possibleText) : NaN;
    const questions = getQuestionsOnPage();
    const observations = [];
    for (const q of questions) {
      const points = q.element.querySelector(".user_points")?.textContent.match(/^\s*(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/);
      const indices = q.options.flatMap((option, index) => option.inputEl.checked ? [index] : []);
      if (points && indices.length) observations.push({
        question: { id: q.id, questionText: q.text, questionType: q.type, options: q.options.map(option => option.text) },
        selected_indices: indices, earned: number(points[1]), possible: number(points[2])
      });
    }
    return { score, possible, observations, questionCount: questions.length };
  }

  async function saveReview() {
    const review = readReview();
    if (review.observations.length) {
      const result = await checkedBackground("RECORD_QUIZ_RESULTS", { observations: review.observations });
      review.learnedCount = result.count;
      updateStatus("Đã đọc kết quả " + review.score + " điểm; lưu phản hồi chấm cho " + result.count + " câu.", "success");
    }
    return review;
  }

  async function startTargetScore() {
    if (activeSolve || isAutoRunning || destroyed) return;
    targetMode = true;
    isAutoRunning = true;
    setSolveButtonsDisabled(true);
    document.getElementById("canvas-ai-stop").style.display = "block";
    try {
      const attemptKey = currentAttemptKey();
      const previous = await checkedBackground("GET_AUTO_STATE", {});
      if (!targetMode || destroyed) return;
      await checkedBackground("SET_AUTO_STATE", { enabled: true, mode: "target", phase: "start", attemptKey,
        reset: !attemptKey || previous.attemptKey !== attemptKey });
      if (targetMode && !destroyed) await continueTarget({ phase: "start" });
    } catch (error) { reportError(error); stopAutoSolve(false); }
  }

  async function targetDelay(message) {
    const controller = new AbortController();
    activeSolve = controller;
    const config = await getStoredConfig();
    const until = Date.now() + Math.max(1, Number(config.autoDelay) || 3) * 1000;
    try {
      while (Date.now() < until) {
        throwIfCancelled(controller.signal);
        if (!targetMode) throw new DOMException("Đã dừng.", "AbortError");
        updateStatus(message + " (" + Math.ceil((until - Date.now()) / 1000) + "s)", "running");
        await waitForRetry(Math.min(1000, until - Date.now()), controller.signal);
      }
      throwIfCancelled(controller.signal);
    } finally { if (activeSolve === controller) activeSolve = null; }
  }

  async function continueTarget(state) {
    if (!targetMode || destroyed) return;
    isAutoRunning = true;
    document.getElementById("canvas-ai-stop").style.display = "block";
    setSolveButtonsDisabled(true);
    try {
      if (isReviewPage()) {
        const review = await saveReview();
        if (!targetMode || destroyed) return;
        if (!Number.isFinite(review.score) || !Number.isFinite(review.possible)) throw new Error("Không đọc được điểm lần làm này. Đã dừng.");
        if (review.score >= 10) {
          await checkedBackground("SET_AUTO_STATE", { enabled: false });
          stopAutoSolve(false);
          updateStatus("🎉 Đã đạt " + review.score + "/" + review.possible + " điểm. Đã dừng làm lại.", "success");
          return;
        }
        if (review.possible < 10) throw new Error("Điểm tối đa của bài nhỏ hơn 10; không thể đạt mục tiêu này.");
        if (!review.learnedCount || review.learnedCount !== review.questionCount) throw new Error("Canvas chưa cung cấp đủ điểm và lựa chọn đã nộp cho từng câu. Đã dừng để tránh lặp lại bài mà không học được kết quả.");
        if (state.phase === "retaking") throw new Error("Đã yêu cầu làm lại nhưng vẫn ở kết quả cũ. Kiểm tra điều kiện bắt đầu bài trước khi chạy tiếp.");
      } else if (document.querySelector("#submit_quiz_form")) {
        if (state.phase === "awaiting_result") throw new Error("Đã bấm nộp nhưng chưa có kết quả. Kiểm tra thông báo của Canvas trước khi tiếp tục.");
        isAutoRunning = false;
        await startAutoSolve();
        return;
      }
      const retake = document.querySelector("#take_quiz_link");
      if (!retake || retake.getAttribute("aria-disabled") === "true" || retake.classList.contains("disabled") || retake.offsetParent === null) {
        throw new Error("Không còn nút Làm lại khả dụng. Có thể đã hết lượt hoặc bài đã khóa.");
      }
      const destination = new URL(retake.href, location.href);
      if (destination.origin !== location.origin || !destination.pathname.startsWith(location.pathname.replace(/\/(?:history|submissions).*$/, "").replace(/\/$/, "") + "/take")) {
        throw new Error("Không xác định được đường dẫn làm lại của bài này.");
      }
      await targetDelay("Đang chuẩn bị làm lại để đạt 10 điểm");
      if (!targetMode || destroyed) return;
      await checkedBackground("SET_AUTO_STATE", { enabled: true, mode: "target", phase: "retaking", reset: true });
      if (!targetMode || destroyed) return;
      retake.click();
      watchTargetNavigation(null);
    } catch (error) { reportError(error); stopAutoSolve(false); }
  }

  async function submitTargetAttempt() {
    const state = await checkedBackground("GET_AUTO_STATE", {});
    if (!targetMode || !state.enabled) return;
    const rows = [...document.querySelectorAll("#question_list .list_question")];
    const listed = rows.map(el => el.id.replace(/^list_/, ""));
    const expected = listed.length ? listed : getQuestionsOnPage().map(q => q.id);
    if (!expected.length) throw new Error("Không đọc được danh sách câu hỏi để kiểm tra trước khi nộp.");
    // The Canvas sidebar describes answers actually present in this attempt,
    // including answers supplied manually or before the extension was restarted.
    let missing = rows.length ? rows.filter(row => !sidebarAnswered(row)).map(row => row.id.replace(/^list_/, ""))
      : expected.filter(id => !state.verifiedIds?.includes(id));
    if (rows.length && missing.some(id => completedRun?.applied.some(record => record.question.id === id))) {
      // Canvas updates the check mark asynchronously after input/change handlers.
      const controller = new AbortController();
      activeSolve = controller;
      try {
        const deadline = Date.now() + 5000;
        while (missing.some(id => completedRun?.applied.some(record => record.question.id === id)) && Date.now() < deadline) {
          updateStatus("Đang chờ Canvas cập nhật dấu tích đã trả lời...", "running");
          await waitForRetry(200, controller.signal);
          throwIfCancelled(controller.signal);
          missing = [...document.querySelectorAll("#question_list .list_question")].filter(row => !sidebarAnswered(row)).map(row => row.id.replace(/^list_/, ""));
        }
        if (missing.some(id => completedRun?.applied.some(record => record.question.id === id))) {
          throw new Error("Canvas chưa cập nhật dấu tích cho câu vừa trả lời. Chưa nộp bài; hãy kiểm tra trạng thái lưu trên trang.");
        }
      } finally { if (activeSolve === controller) activeSolve = null; }
    }
    if (missing.length) {
      const row = rows.find(el => el.id === "list_" + missing[0]);
      const link = row?.querySelector("a[href]");
      if (!link || link.getAttribute("aria-disabled") === "true" || link.classList.contains("disabled")) {
        throw new Error("Chưa giải và xác nhận đủ " + missing.length + " câu. Canvas không cho mở câu còn thiếu; chưa nộp bài.");
      }
      const destination = new URL(link.href, location.href);
      const quizPath = location.pathname.match(/^(.+\/quizzes\/[^/]+)/)?.[1];
      const questionId = missing[0].replace(/^question_/, "");
      if (!quizPath || destination.origin !== location.origin || destination.pathname !== quizPath + "/take/questions/" + questionId) {
        throw new Error("Đường dẫn câu còn thiếu không thuộc bài hiện tại; chưa nộp bài.");
      }
      const label = row.textContent.replace(/\s+/g, " ").trim();
      await targetDelay("Còn " + missing.length + " câu chưa có dấu tích. Đang mở " + label);
      if (!targetMode || destroyed) return;
      verifyPageAnswers(completedRun.applied, true);
      const previous = getQuestionsOnPage().map(questionSnapshot).join("|");
      link.click();
      watchTargetNavigation(previous);
      return;
    }
    const submit = document.querySelector("#submit_quiz_form #submit_quiz_button");
    if (!submit || submit.disabled || submit.offsetParent === null) throw new Error("Không tìm thấy nút nộp bài khả dụng.");
    await targetDelay("Đã xác nhận đủ câu. Chuẩn bị nộp bài");
    if (!targetMode || destroyed) return;
    verifyPageAnswers(completedRun.applied, true);
    // Recheck live marks immediately before committing the submission.
    if (rows.length) {
      const liveRows = [...document.querySelectorAll("#question_list .list_question")];
      if (liveRows.length !== rows.length || liveRows.some(row => !listed.includes(row.id.replace(/^list_/, "")))) {
        throw new Error("Danh sách câu hỏi đã thay đổi. Chưa nộp bài.");
      }
      if (liveRows.some(row => !sidebarAnswered(row))) {
        await submitTargetAttempt();
        return;
      }
    }
    await checkedBackground("SET_AUTO_STATE", { enabled: true, phase: "awaiting_result" });
    if (!targetMode || destroyed) return;
    submit.click();
    watchTargetNavigation(null);
  }

  function sidebarAnswered(row) {
    // 'seen' means visited; flagged/bookmarked questions are not necessarily answered.
    // An explicit question mark wins over a stale answered class.
    if (row.querySelector(".icon-question")) return false;
    return Boolean(row.querySelector(".icon-check") || row.classList.contains("answered"));
  }

  function currentAttemptKey() {
    const attempt = document.querySelector('#submit_quiz_form input[name="attempt"]')?.value;
    // Without a reliable attempt marker, a manual restart rechecks all questions.
    return typeof attempt === "string" && /^\d+$/.test(attempt) ? attempt : null;
  }

  function watchTargetNavigation(previous) {
    // Full navigation replaces this script. Also handle Canvas changing the DOM in place.
    const deadline = Date.now() + 15000;
    const check = async () => {
      if (!targetMode || destroyed) return;
      try {
        const state = await checkedBackground("GET_AUTO_STATE", {});
        if (!targetMode || !state.enabled || destroyed) return;
        const changed = previous !== null && getQuestionsOnPage().map(questionSnapshot).join("|") !== previous;
        if (changed || (state.phase === "awaiting_result" && isReviewPage()) ||
            (state.phase === "retaking" && !isReviewPage() && document.querySelector("#submit_quiz_form"))) {
          isAutoRunning = false;
          if (state.phase === "retaking") state.phase = "solving";
          await continueTarget(state);
        } else if (Date.now() >= deadline) {
          throw new Error("Canvas chưa chuyển trang. Đã dừng; kiểm tra thông báo hoặc hộp xác nhận trên trang.");
        } else resumeTimer = setTimeout(check, 1000);
      } catch (error) { reportError(error); stopAutoSolve(false); }
    };
    resumeTimer = setTimeout(check, 1500);
  }

  async function getStoredConfig() {
    const config = await extensionStorage("get",
        {
          aiEngine: "gemini_api",
          apiKey: "",
          aiModel: "gemini-2.5-flash",
          autoDelay: 3,
          autoClickAnswer: true,
          autoNextQuestion: false,
          answerReviewVersion: 0
        });
    if (config.answerReviewVersion < 2) {
      // Once per upgrade: stop legacy automatic navigation and discard index-only cache.
      config.autoNextQuestion = false;
      await extensionStorage("set", { autoNextQuestion: false, answerReviewVersion: 2, isAutoRunningContinuous: false });
    }
    return config;
  }

  // Helper function for Draggable UI
  function makeDraggable(elmnt, headerEl) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    if (headerEl) {
      headerEl.onmousedown = dragMouseDown;
    } else {
      elmnt.onmousedown = dragMouseDown;
    }

    function dragMouseDown(e) {
      if (e.target.tagName === "BUTTON") return;
      e = e || window.event;
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e = e || window.event;
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
      elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
      elmnt.style.bottom = "auto";
      elmnt.style.right = "auto";
    }

    function closeDragElement() {
      if (document.onmouseup === closeDragElement) document.onmouseup = null;
      if (document.onmousemove === elementDrag) document.onmousemove = null;
    }
    cleanupDrag = closeDragElement;
  }
})();

})(CanvasCompat.create(true));
