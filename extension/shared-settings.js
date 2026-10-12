// Shared AI selection and key exist only in this worker's RAM.
globalThis.SuiteSettings = (() => {
  let queue = Promise.resolve();
  const keys = new Map();
  function scope(url) {
    try {
      const parsed = new URL(url);
      const quiz = parsed.pathname.match(/^(.*\/quizzes\/[^/]+)/);
      return parsed.origin + (quiz ? quiz[1] : parsed.pathname);
    } catch { return ''; }
  }
  const storage = globalThis.SuiteStorage || chrome.storage;
  function serial(work) { const result = queue.then(work); queue = result.catch(() => {}); return result; }
  async function update(patch = {}) {
    const data = await storage.local.get(['suite:ai', 'config']);
    const source = data['suite:ai'] || {engine: 'gemini_api', model: 'gemini-3.8-flash'};
    const ai = {engine: patch.engine ?? source.engine, model: patch.model ?? source.model};
    if (!['chrome_ai', 'gemini_api'].includes(ai.engine) || !/^gemini-[a-zA-Z0-9.-]+$/.test(ai.model)) throw Error('Mô hình AI không hợp lệ.');
    const entered = typeof patch.apiKey === 'string' ? patch.apiKey.trim() : null;
    if (entered && /\s/.test(entered)) throw Error('API key chứa khoảng trắng. Hãy kiểm tra lại.');
    if (entered !== null && !Number.isInteger(patch.tabId)) throw Error('Không xác định được tab cho API key.');
    if (ai.engine === 'chrome_ai' || entered === '') keys.delete(patch.tabId);
    else if (entered !== null) keys.set(patch.tabId, {key: entered, scope: scope(patch.sourceUrl)});
    await storage.local.set({
      'suite:ai': ai,
      config: {...data.config, provider: ai.engine === 'chrome_ai' ? 'builtin' : 'gemini', model: ai.model, backgroundPlayback: true},
      'canvas:aiEngine': ai.engine, 'canvas:aiModel': ai.model,
      'canvas:autoClickAnswer': true, 'canvas:autoNextQuestion': true, 'canvas:answerReviewVersion': 2
    });
    return {...ai, keySaved: keys.has(patch.tabId)};
  }
  return {
    ensure: tabId => serial(() => update({tabId})), save: patch => serial(() => update(patch)),
    keyForTab: tabId => serial(() => keys.get(tabId)?.key || ''),
    clearKey: tabId => serial(() => { keys.delete(tabId); }),
    navigate: (tabId, url) => serial(() => {
      if (keys.has(tabId) && keys.get(tabId).scope !== scope(url)) keys.delete(tabId);
    })
  };
})();
