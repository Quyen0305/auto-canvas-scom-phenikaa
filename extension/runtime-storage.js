// Volatile worker state. Never writes settings, credentials or answers to disk.
globalThis.SuiteStorage = (() => {
  function area() {
    const data = Object.create(null);
    return {
      async setAccessLevel() {},
      async get(value) {
        const keys = value == null ? Object.keys(data) : typeof value === 'string' ? [value] : Array.isArray(value) ? value : Object.keys(value);
        const out = value && !Array.isArray(value) && typeof value === 'object' ? {...value} : {};
        for (const key of keys) if (Object.hasOwn(data, key)) out[key] = JSON.parse(JSON.stringify(data[key]));
        return out;
      },
      async set(values) { Object.assign(data, JSON.parse(JSON.stringify(values))); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
    };
  }
  // Best-effort migration only. Restricted storage cannot prevent startup.
  try {
    Promise.resolve(chrome.storage?.local?.get(null)).then(async values => {
      if (!values) return;
      const keys = Object.keys(values).filter(key => key === 'apiKey' || key === 'suite:previousScormKey' ||
        key === 'suite:archiveError' || key.startsWith('suite:question:') ||
        /^(canvas:)?(?:apiKey|geminiAnswerCacheV[12]|canvasGradedAnswersV1)$/.test(key));
      if (keys.length) await chrome.storage.local.remove(keys);
    }).catch(() => {});
  } catch {}
  return {local: area(), session: area()};
})();
