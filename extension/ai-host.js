(() => {
  // Old ai.html tabs can remain open across an update. They must not create a
  // second engine or take ownership of the hidden host's port.
  if (window.parent === window) return;
  const engine = new LessonBuiltin.Engine();
  const jobs = new Map();
  const status = document.getElementById('ai-status');
  let port, closing = false, reconnect, phase = 'idle';
  const say = text => { status.textContent = text; announce(); };
  function announce() {
    try { port?.postMessage({type: 'state', ready: engine.ready, phase, detail: status.textContent}); }
    catch { status.textContent = 'Mất kết nối với extension. Bấm Bắt đầu ở bài học để thử lại.'; }
  }
  function cancelAll() { for (const controller of jobs.values()) controller.abort(); }
  function connect() {
    if (closing || port) return;
    clearTimeout(reconnect);
    try {
      const channel = chrome.runtime.connect({name: 'lesson-builtin-ai'}); port = channel;
      channel.onMessage.addListener(async message => {
        if (message.type === 'cancel') { jobs.get(message.id)?.abort(); return; }
        if (message.type === 'duplicate') { closing = true; engine.destroy(); say('Extension đang sử dụng phiên Chrome AI đã có.'); return; }
        if (message.type === 'prepare') { prepareAI(); return; }
        if (!['solve', 'canvas-solve'].includes(message.type) || typeof message.id !== 'string' || jobs.has(message.id)) return;
        const controller = new AbortController(); jobs.set(message.id, controller);
        say(message.type === 'canvas-solve' ? 'Đang xử lý câu hỏi Canvas trên máy…' : 'Đang dịch và giải câu hỏi trên máy…');
        try {
          const result = message.type === 'canvas-solve'
            ? await ChromeAi.solve(message.prompt, controller.signal, message.schema)
            : await engine.solve(message.question, controller.signal);
          if (!controller.signal.aborted && port === channel) channel.postMessage({type: 'result', id: message.id, result});
          say('Đã xử lý câu hỏi. Sẵn sàng cho câu tiếp theo.');
        } catch (error) {
          const detail=String(error.message).replace('Mở popup, chọn Chrome AI và bấm Kiểm Tra / Tải Model; giữ popup mở đến khi hoàn tất.', 'Chọn Chrome AI trong popup và giữ popup mở tới khi tải xong.').replace('trong cài đặt.', 'trong popup.');
          try { channel.postMessage({type: 'result', id: message.id, error: error.name === 'AbortError' ? 'Đã hủy Chrome AI.' : detail.slice(0, 500)}); } catch {}
          say(controller.signal.aborted ? 'Đã hủy câu hỏi đang xử lý.' : 'Không xử lý được câu hỏi. Xem thông báo ở extension.');
        } finally { jobs.delete(message.id); }
      });
      channel.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (port !== channel) return;
        port = null; cancelAll();
        if (!closing) status.textContent = 'Đang kết nối lại với extension…';
        if (!closing) reconnect = setTimeout(connect, 1000);
      });
      announce();
    } catch { port = null; status.textContent = 'Extension đã được tải lại. Bấm Bắt đầu ở bài học để kết nối lại.'; }
  }
  async function prepareAI() {
    if (closing || engine.ready || phase === 'preparing') return;
    phase = 'preparing'; say('Đang tự chuẩn bị Chrome AI…');
    try {
      await engine.prepare(say); phase = 'ready';
      if (closing) return;
      say('Chrome AI sẵn sàng. Bài học đang chờ sẽ tự chạy.');
    }
    catch (error) {
      if (closing) return;
      phase = 'error';
      say(/activation|gesture|NotAllowed/i.test(`${error.name} ${error.message}`)
        ? 'Chrome yêu cầu thao tác để tải mô hình lần đầu. Hãy chọn Chrome AI trong popup; tải xong bài học sẽ tự chạy.'
        : `Chưa chuẩn bị được Chrome AI: ${error.message}`);
    }
    finally { if (!closing) announce(); }
  }
  window.addEventListener('pagehide', () => { closing = true; clearTimeout(reconnect); cancelAll(); engine.destroy(); port?.disconnect(); });
  window.LessonAIHostReconnect = () => {
    connect();
    announce();
    prepareAI();
  };
  connect();
  prepareAI();
  // A live extension page hosts Prompt API; it is unavailable in service workers.
  setInterval(announce, 20000);
  engine.availability().then(result => {
    const names = {available: 'sẵn sàng', downloadable: 'cần tải', downloading: 'đang tải', unavailable: 'không hỗ trợ', missing: 'API chưa có'};
    document.getElementById('capability').textContent = `Gemini Nano: ${names[result.model] || result.model}. Việt → Anh: ${names[result.input] || result.input}. Anh → Việt: ${names[result.output] || result.output}.`;
  }, () => { document.getElementById('capability').textContent = 'Không kiểm tra được hỗ trợ. Hãy cập nhật Chrome và thử lại.'; });
})();
