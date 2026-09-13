// Prompt API needs a Window document. Keep the engine in a same-origin iframe
// and script its connection lifecycle from this invisible offscreen document.
(() => {
  const frame = document.createElement('iframe');
  frame.title = 'Local AI engine';
  frame.src = 'ai.html';
  document.body.append(frame);
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.target !== 'lesson-ai-offscreen' || message.command !== 'reconnect') return;
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    frame.contentWindow?.LessonAIHostReconnect?.();
    reply({ok: true});
  });
})();
