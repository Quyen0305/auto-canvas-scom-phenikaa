// Shared by the extension service worker and the settings popup.
// Use the extension's LanguageModel API, not the host page's window.ai namespace.
globalThis.ChromeAi = (() => {
  function failure(message, code) {
    return Object.assign(new Error(message), { code });
  }

  function modelApi() {
    const api = globalThis.LanguageModel;
    if (!api?.availability || !api?.create) {
      throw failure("Trình duyệt chưa cung cấp Chrome Built-in AI. Hãy dùng Chrome bản mới và kiểm tra chrome://on-device-internals.", "CHROME_AI_UNAVAILABLE");
    }
    return api;
  }

  async function availability() {
    return modelApi().availability();
  }

  function describeError(error) {
    if (error.code || error.name === "AbortError") return error;
    if (error.name === "NotAllowedError") {
      return failure("Chrome cần thao tác trực tiếp để tải model. Mở popup, chọn Chrome AI và bấm Kiểm Tra / Tải Model; giữ popup mở đến khi hoàn tất.", "CHROME_AI_SETUP_REQUIRED");
    }
    if (error.name === "NotSupportedError") {
      return failure("Chrome AI không hỗ trợ cấu hình hoặc ngôn ngữ của nội dung này. Tiếng Việt có thể chưa được model hỗ trợ; bạn có thể tự chọn Gemini API trong cài đặt.", "CHROME_AI_NOT_SUPPORTED");
    }
    return failure("Chrome AI gặp lỗi: " + (error.message || String(error)), "CHROME_AI_ERROR");
  }

  async function createSession({ signal, allowDownload = false, onProgress } = {}) {
    try {
      signal?.throwIfAborted();
      const api = modelApi();
      const state = await api.availability();
      signal?.throwIfAborted();
      if (state === "unavailable") {
        throw failure("Chrome AI chưa khả dụng trên máy này. Kiểm tra phần cứng, dung lượng trống và trạng thái model tại chrome://on-device-internals.", "CHROME_AI_UNAVAILABLE");
      }
      if (!["available", "downloadable", "downloading"].includes(state)) {
        throw failure("Không xác định được trạng thái Chrome AI: " + state, "CHROME_AI_UNAVAILABLE");
      }
      if (state !== "available" && !allowDownload) {
        throw failure("Model Chrome AI chưa tải xong. Mở popup, chọn Chrome AI và bấm Kiểm Tra / Tải Model; giữ popup mở đến khi hoàn tất.", "CHROME_AI_SETUP_REQUIRED");
      }
      return await api.create({
        signal,
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", event => {
            const fraction = event.total ? event.loaded / event.total : event.loaded;
            onProgress?.(Math.max(0, Math.min(100, Math.round(fraction * 100))));
          });
        }
      });
    } catch (error) {
      throw describeError(error);
    }
  }

  async function prepare(onProgress, signal) {
    let session;
    try {
      session = await createSession({ allowDownload: true, onProgress, signal });
      // Prove that inference works rather than just detecting an API symbol.
      await session.prompt('Reply with the word OK.', { signal });
      return { ready: true };
    } catch (error) {
      throw describeError(error);
    } finally {
      session?.destroy();
    }
  }

  async function solve(prompt, signal, responseConstraint) {
    let session;
    try {
      session = await createSession({ signal });
      signal?.throwIfAborted();
      const raw = await session.prompt(prompt, { signal, responseConstraint });
      signal?.throwIfAborted();
      // Parse the whole value; extracting an inner object can hide extra answers.
      const clean = typeof raw === "string" ? raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "") : "";
      let answer;
      try { answer = JSON.parse(clean); }
      catch (_) { throw failure("Chrome AI trả về JSON bị lỗi.", "INVALID_RESPONSE"); }
      return answer;
    } catch (error) {
      throw describeError(error);
    } finally {
      session?.destroy();
    }
  }

  return { availability, prepare, solve };
})();
