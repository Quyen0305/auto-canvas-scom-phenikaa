// One persisted AI selection, projected onto each module's existing config.
globalThis.SuiteSettings = (() => {
  let queue=Promise.resolve();
  function serial(work){const result=queue.then(work);queue=result.catch(()=>{});return result;}
  async function update(patch={}) {
    const data=await chrome.storage.local.get(['suite:ai','config','apiKey','canvas:aiEngine','canvas:aiModel','canvas:apiKey']);
    const old=data['suite:ai'];
    const source=old || {
      engine:data['canvas:aiEngine'] || (data.config?.provider==='builtin'?'chrome_ai':'gemini_api'),
      model:data['canvas:aiModel'] || data.config?.model || 'gemini-2.5-flash'
    };
    const ai={engine:patch.engine ?? source.engine,model:patch.model ?? source.model};
    if(!['chrome_ai','gemini_api'].includes(ai.engine) || !/^gemini-[a-zA-Z0-9.-]+$/.test(ai.model))throw Error('Mô hình AI không hợp lệ.');
    const entered=typeof patch.apiKey==='string'?patch.apiKey.trim():'';
    if(/\s/.test(entered))throw Error('API key chứa khoảng trắng. Hãy kiểm tra lại.');
    const key=entered || (old ? data.apiKey : data['canvas:apiKey'] || data.apiKey) || '';
    const values={
      'suite:ai':ai,apiKey:key,'canvas:apiKey':key,
      config:{...data.config,provider:ai.engine==='chrome_ai'?'builtin':'gemini',model:ai.model,backgroundPlayback:true},
      'canvas:aiEngine':ai.engine,'canvas:aiModel':ai.model,
      'canvas:autoClickAnswer':true,'canvas:autoNextQuestion':true,'canvas:answerReviewVersion':2
    };
    // Retain conflicting old credentials for recovery without exposing them in UI.
    if(!old && data.apiKey && data['canvas:apiKey'] && data.apiKey!==data['canvas:apiKey'])
      values['suite:previousScormKey']=data.apiKey;
    await chrome.storage.local.set(values);
    return {...ai,keySaved:!!key};
  }
  return {ensure:()=>serial(()=>update()),save:patch=>serial(()=>update(patch))};
})();
