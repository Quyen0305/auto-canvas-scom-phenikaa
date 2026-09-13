// Integration only: Canvas keeps its own storage and original message format.
globalThis.CanvasCompat = (() => {
  const native = globalThis.chrome;
  const prefix = 'canvas:';
  function create(content = false) {
    let callbackError;
    const runtime = new Proxy(native.runtime, {get(target,key) {
      if (key === 'lastError') return callbackError || target.lastError;
      if (key === 'sendMessage' && content && globalThis.SuiteCapture) return (message, ...args) => {
        const enriched = message.action ? {...message, data:{...message.data, archiveContext:SuiteCapture.context()}} : message;
        return target.sendMessage(enriched, ...args);
      };
      if (key === 'onMessage' && !content && globalThis.QuestionBank) return {
        addListener(listener) {
          target.onMessage.addListener((message, sender, reply) => listener(message, sender, response => {
            QuestionBank.captureCanvas(message, sender, response).catch(QuestionBank.failure).finally(() => reply(response));
          }));
        }
      };
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    }});
    function complete(promise, callback) {
      if (!callback) return promise;
      promise.then(value => callback(value), error => {
        callbackError = {message:error.message};
        try { callback(); } finally { callbackError = null; }
      });
    }
    function area(name) {
      async function run(method,value) {
        if (content) {
          const response = await native.runtime.sendMessage({action:'CANVAS_STORAGE',data:{area:name,method,value}});
          if (!response?.success) throw new Error(response?.error || 'Không đọc được cài đặt Canvas.');
          return response.data;
        }
        const store = native.storage[name];
        if (method === 'get') {
          const keys = value == null ? null : typeof value === 'string' ? [value] : Array.isArray(value) ? value : Object.keys(value);
          const result = await store.get(keys?.map(key=>prefix+key) ?? null);
          const out = value && !Array.isArray(value) && typeof value === 'object' ? {...value} : {};
          for (const [key,item] of Object.entries(result)) if (key.startsWith(prefix)) out[key.slice(prefix.length)] = item;
          return out;
        }
        if (method === 'set') return store.set(Object.fromEntries(Object.entries(value).map(([key,item])=>[prefix+key,item])));
        if (method === 'remove') return store.remove((Array.isArray(value)?value:[value]).map(key=>prefix+key));
        throw new Error('Lệnh lưu trữ Canvas không hỗ trợ.');
      }
      return Object.fromEntries(['get','set','remove'].map(method=>[method,(value,callback)=>complete(run(method,value),callback)]));
    }
    const scripting = native.scripting && new Proxy(native.scripting,{get(target,key) {
      const value=target[key];
      if (!['executeScript','insertCSS'].includes(key)) return typeof value==='function'?value.bind(target):value;
      return (options,...args)=>{
        const files=options.files?.map(file=>'canvas/'+file);
        if (key==='executeScript' && files?.includes('canvas/content.js')) { files.unshift('archive-content.js','canvas-compat.js');files.push('canvas-controls.js'); }
        if (key==='insertCSS' && files?.includes('canvas/styles.css')) files.push('canvas-compact.css');
        return value.call(target,files?{...options,files}:options,...args);
      };
    }});
    const tabs = native.tabs && new Proxy(native.tabs,{get(target,key) {
      const value=target[key];
      if(key==='query')return async (...args)=>{
        // Full settings opens in its own tab. Reconnect should still target the
        // lesson tab from the popup, not inject into the settings document.
        if(!content && globalThis.document && globalThis.parent?.document?.body?.classList.contains('suite-options')) {
          const stored=await native.storage.session.get('suite:sourceTab');
          const source=stored['suite:sourceTab'];
          if(Number.isInteger(source?.id) && Date.now()-source.at<10*60*1000) return [await native.tabs.get(source.id)];
        }
        return value.apply(target,args);
      };
      return typeof value==='function'?value.bind(target):value;
    }});
    return new Proxy(native,{get(target,key) {
      if(key==='runtime')return runtime;
      if(key==='storage')return {local:area('local'),session:area('session')};
      if(key==='scripting')return scripting;
      if(key==='tabs')return tabs;
      return target[key];
    }});
  }
  function compactWidget() {
    const apply = () => {
      const widget = document.getElementById('canvas-ai-solver-widget');
      if (!widget) return;
      widget.querySelector('#canvas-ai-solve-current').hidden=true;
      widget.querySelector('.canvas-ai-target-help').hidden=true;
      widget.querySelector('.canvas-ai-title').textContent = 'Canvas';
      widget.querySelector('#canvas-ai-auto-all').textContent = 'Tự động làm';
      widget.querySelector('#canvas-ai-target').textContent = 'Làm đến 10 điểm';
      widget.querySelector('#canvas-ai-stop').textContent = 'Dừng';
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
  }
  return {create, compactWidget};
})();
