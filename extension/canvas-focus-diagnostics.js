/* Focus Isolation Diagnostics for self-controlled Canvas practice pages.
 * Passive observation plus isolated, non-submitting fixture tests.
 * Does not cancel, synthesize, or suppress Canvas focus/blur events.
 */
(() => {
  'use strict';
  if (globalThis.__canvasFocusDiag) return;

  const LIMIT = 350;
  const REPEAT = 3;
  const TESTS = [
    ['T01', 'Nghỉ, không thao tác', async () => wait(120)],
    ['T02', 'Sự kiện bàn phím trên nút giả', async () => {
      const button = document.createElement('button');
      button.dispatchEvent(new KeyboardEvent('keydown', {key: 'x', bubbles: false}));
    }],
    ['T03', 'Đọc cấu trúc DOM (không đọc nội dung)', async () => {
      document.querySelectorAll('.display_question.question, #questions .question').length;
    }],
    ['T04', 'Đọc cấu hình extension (không ghi giá trị)', async () => {
      await new Promise((resolve, reject) => {
        chrome.storage.local.get('canvas:answerReviewVersion', () => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error('storage_failed')); else resolve();
        });
      });
    }],
    ['T05', 'Gửi heartbeat tới background', async () => {
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({action: 'SUITE_HEARTBEAT'}, response => {
          const err = chrome.runtime.lastError;
          if (err || !response?.success) reject(new Error('heartbeat_failed')); else resolve();
        });
      });
    }],
    ['T06', 'Giả lập chờ phản hồi AI (không gửi mạng)', async () => wait(75)],
    ['T07', 'Hiển thị kết quả giả trong vùng riêng', async () => {
      const node = document.createElement('div');
      node.textContent = 'Diagnostic sample response';
      fixture.appendChild(node);
      node.remove();
    }],
    ['T08', 'Chọn đáp án giả (không chạm câu hỏi thật)', async () => {
      const input = document.createElement('input');
      input.type = 'radio';
      fixture.appendChild(input);
      input.click();
      input.remove();
    }]
  ];

  let enabled = false;
  let running = false;
  let stopped = false;
  let startedAt = 0;
  let current = '';
  let events = [];
  let results = [];
  let root;
  let fixture;
  let status;
  let output;

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const snapshot = () => ({
    hasFocus: document.hasFocus(),
    visibility: document.visibilityState
  });
  function record(name, detail = '') {
    if (!enabled) return;
    const state = snapshot();
    events.push({
      ms: Math.round(performance.now() - startedAt),
      name,
      test: current || null,
      phase: detail || null,
      hasFocus: state.hasFocus,
      visibility: state.visibility
    });
    if (events.length > LIMIT) events.shift();
  }
  function onBlur() { record('window.blur'); }
  function onFocus() { record('window.focus'); }
  function onVisibility() { record('visibilitychange'); }

  function attach() {
    window.addEventListener('blur', onBlur, true);
    window.addEventListener('focus', onFocus, true);
    document.addEventListener('visibilitychange', onVisibility, true);
  }
  function detach() {
    window.removeEventListener('blur', onBlur, true);
    window.removeEventListener('focus', onFocus, true);
    document.removeEventListener('visibilitychange', onVisibility, true);
  }

  function report() {
    return {
      tool: 'Auto-Canvas Focus Isolation Test',
      version: 1,
      repeatCount: REPEAT,
      summary: {
        tests: results.length,
        withBlur: results.filter(item => item.blurEvents > 0).map(item => item.id),
        failedActions: results.filter(item => item.errors.length > 0).map(item => item.id)
      },
      warning: 'Temporal correlation only. This report does not prove what Canvas stored on its server.',
      results: results.map(item => ({...item, errors: [...item.errors]})),
      timeline: events.map(item => ({...item}))
    };
  }

  async function runAll() {
    if (!enabled || running) return;
    running = true;
    stopped = false;
    results = [];
    events = [];
    startedAt = performance.now();
    output.textContent = '';
    record('isolation_begin');
    status.textContent = 'Đang chạy 8 phép thử, mỗi phép thử 3 lần…';
    try {
      for (const [id, title, action] of TESTS) {
        if (stopped) break;
        const row = {
          id, title, repeats: 0, blurEvents: 0,
          focusEvents: 0, focusLost: 0, initiallyUnfocused: 0,
          visibilityChanges: 0, errors: [], assessment: ''
        };
        current = id;
        for (let attempt = 1; attempt <= REPEAT; attempt++) {
          if (stopped) break;
          row.repeats++;
          await wait(75);
          const before = snapshot();
          if (!before.hasFocus) row.initiallyUnfocused++;
          const offset = events.length;
          record('test_start', String(attempt));
          try {
            await action();
          } catch (error) {
            row.errors.push(String(error?.message || 'unknown_error').slice(0, 100));
          }
          await wait(140);
          const after = snapshot();
          const slice = events.slice(offset);
          row.blurEvents += slice.filter(item => item.name === 'window.blur').length;
          row.focusEvents += slice.filter(item => item.name === 'window.focus').length;
          row.visibilityChanges += slice.filter(item => item.name === 'visibilitychange').length;
          if (before.hasFocus && !after.hasFocus) row.focusLost++;
          record('test_end', String(attempt));
        }
        row.assessment = row.errors.length ? 'Thao tác lỗi; cần xem lại'
          : row.blurEvents || row.focusLost ? 'Có biến động focus'
          : row.initiallyUnfocused ? 'Chưa kết luận: trang đã mất focus'
          : 'Không phát hiện biến động focus';
        results.push(row);
        output.textContent += id + ' — ' + title + ': ' + row.assessment +
          ' (blur=' + row.blurEvents + ', focus=' + row.focusEvents + ')\n';
        current = '';
      }
      record(stopped ? 'isolation_cancelled' : 'isolation_complete');
      status.textContent = stopped ? 'Đã dừng. Có thể xuất kết quả từng phần.'
        : 'Hoàn tất. Đọc kết quả và xuất JSON để đối chiếu.';
    } finally {
      current = '';
      running = false;
    }
  }

  function exportReport() {
    const data = JSON.stringify(report(), null, 2);
    const blob = new Blob([data], {type: 'application/json'});
    const uri = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = uri;
    link.download = 'auto-canvas-focus-diagnostics.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(uri), 1000);
  }

  function open() {
    if (enabled) { root.hidden = false; return; }
    enabled = true;
    startedAt = performance.now();
    events = [];
    results = [];
    root = document.createElement('section');
    root.id = 'canvas-focus-diagnostics';
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Focus Isolation Test');
    Object.assign(root.style, {
      position: 'fixed', bottom: '16px', left: '16px', width: '350px',
      maxWidth: 'calc(100vw - 32px)', maxHeight: '70vh', overflow: 'auto',
      zIndex: '2147483646', padding: '14px', borderRadius: '12px',
      background: '#ffffff', color: '#122032',
      border: '1px solid #94a3b8', boxShadow: '0 8px 28px #0003',
      font: '13px/1.45 system-ui, sans-serif'
    });
    const heading = document.createElement('strong');
    heading.textContent = 'Focus Isolation Test';
    const intro = document.createElement('p');
    intro.textContent = 'Chỉ kiểm thử thao tác giả lập, không gọi AI, không chọn hoặc nộp đáp án Canvas.';
    const buttons = document.createElement('div');
    Object.assign(buttons.style, {display: 'flex', gap: '6px', flexWrap: 'wrap'});
    const button = (label, action) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = label;
      el.style.cssText = 'padding:6px 8px;border:1px solid #94a3b8;background:#f1f5f9;border-radius:6px;color:#172554;cursor:pointer';
      el.addEventListener('click', action);
      buttons.appendChild(el);
      return el;
    };
    button('Chạy 8 test', () => { void runAll(); });
    button('Xuất JSON', exportReport);
    button('Đóng', close);
    status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = 'Đang theo dõi focus. Bấm Chạy 8 test.';
    output = document.createElement('pre');
    output.style.cssText = 'font:11px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere';
    fixture = document.createElement('div');
    fixture.hidden = true;
    root.append(heading, intro, buttons, status, output, fixture);
    document.body.appendChild(root);
    attach();
    record('diagnostics_open');
  }

  function close() {
    stopped = true;
    enabled = false;
    detach();
    root?.remove();
    root = null;
  }

  function onHotkey(event) {
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey ||
        event.key.toLowerCase() !== 'd' || event.repeat) return;
    event.preventDefault();
    if (enabled) close(); else open();
  }

  document.addEventListener('keydown', onHotkey, true);
  globalThis.__canvasFocusDiag = {
    mark: phase => record('auto_canvas_phase', String(phase).slice(0, 80)),
    open, close, runAll, getReport: report
  };
})();
