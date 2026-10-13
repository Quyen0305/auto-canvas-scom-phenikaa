// Credentials and AI selection last only for the current browser session.
globalThis.SuiteSettings = (() => {
  let queue = Promise.resolve(), credential;
  const session = chrome.storage?.session, SESSION_KEY = 'suite:sessionCredential';
  const storage = globalThis.SuiteStorage || chrome.storage;
  function serial(work) { const result = queue.then(work); queue = result.catch(() => {}); return result; }
  async function readCredential() {
    if (credential !== undefined) return credential;
    try { credential = (await session?.get(SESSION_KEY))?.[SESSION_KEY] || null; }
    catch { credential = null; }
    return credential;
  }
  async function writeCredential(entry) {
    credential = entry;
    try { await session?.set({[SESSION_KEY]: entry}); }
    catch { /* Missing or restricted session API: retain worker RAM only. */ }
  }
  async function update(patch = {}) {
    const data = await storage.local.get(['suite:ai', 'config']);
    const entry = await readCredential();
    const source = data['suite:ai'] || {engine: entry?.engine || 'gemini_api', model: entry?.model || 'gemini-3.8-flash'};
    const ai = {engine: patch.engine ?? source.engine, model: patch.model ?? source.model};
    if (!['chrome_ai', 'gemini_api'].includes(ai.engine) || !/^gemini-[a-zA-Z0-9.-]+$/.test(ai.model)) throw Error('Mô hình AI không hợp lệ.');
    const entered = typeof patch.apiKey === 'string' ? patch.apiKey.trim() : '';
    if (entered && /\s/.test(entered)) throw Error('API key chứa khoảng trắng. Hãy kiểm tra lại.');
    if (entered) await writeCredential({key: entered, ...ai});
    else if (entry && (patch.model !== undefined || patch.engine !== undefined)) await writeCredential({...entry, ...ai});
    await storage.local.set({
      'suite:ai': ai,
      config: {...data.config, provider: ai.engine === 'chrome_ai' ? 'builtin' : 'gemini', model: ai.model, backgroundPlayback: true},
      'canvas:aiEngine': ai.engine, 'canvas:aiModel': ai.model,
      'canvas:autoClickAnswer': true, 'canvas:autoNextQuestion': true, 'canvas:answerReviewVersion': 2
    });
    return {...ai, keySaved: !!(await readCredential())?.key};
  }
  return {
    ensure: () => serial(() => update()), save: patch => serial(() => update(patch)),
    keyForTab: () => serial(async () => (await readCredential())?.key || '')
  };
})();
