(() => {
  const $=id=>document.getElementById(id);
  let mode='scorm',tabId,tabUrl='',loaded=false,working=false,closed=false,epoch=0,errorUntil=0;
  let ai={engine:'gemini_api',model:'gemini-3.8-flash'},preparing=null,modelReady=false;
  function notice(text,bad=false){if(closed)return;$('status').textContent=text;$('status').classList.toggle('error',bad);if(bad)errorUntil=Date.now()+7000;}
  async function settings(patch){
    const result=await chrome.runtime.sendMessage({action:'SUITE_SETTINGS',tabId,...(patch?{data:{...patch,tabId}}:{})});
    if(!result?.success)throw Error(result?.error || 'Không lưu được lựa chọn AI.');
    return result.data;
  }
  function lock(){
    if(closed)return;
    $('aiModel').disabled=$('apiKey').disabled=$('searchKey').disabled=$('accountId').disabled=$('baseURL').disabled=$('routerModel').disabled=$('searchModel').disabled=!loaded||working;
    for(const id of ['start','canvas-auto','canvas-target'])$(id).disabled=!loaded||working;
    $('stop').disabled=$('canvas-stop').disabled=!loaded;
  }
  function select(value){
    mode=value==='canvas'?'canvas':'scorm';
    for(const name of ['scorm','canvas']){
      $('tab-'+name).setAttribute('aria-selected',String(mode===name));$('tab-'+name).tabIndex=mode===name?0:-1;
      $('panel-'+name).hidden=mode!==name;
    }
    errorUntil=0;refresh();
  }
  function selection(){
    const value=$('aiModel').value;
    if(value==='ninerouter')return {engine:'ninerouter_api',model:'adaptive'};
    if(value==='chrome_ai')return {engine:'chrome_ai',model:/^gemini-/.test(ai.model)?ai.model:'gemini-3.8-flash'};
    if(value.includes('|')){const [engine,model]=value.split('|');return {engine,model};}
    return {engine:'gemini_api',model:value};
  }
  function entered(){
    const engine=selection().engine,fields=['apiKey'];
    if(['groq_api','cloudflare_api','openrouter_api'].includes(engine))fields.push('searchKey');
    if(engine==='cloudflare_api')fields.push('accountId');
    if(engine==='ninerouter_api'){
      return $('apiKey').value.trim()?{apiKey:$('apiKey').value.trim()}:{};
    }
    return Object.fromEntries(fields.map(id=>[id,$(id).value.trim()]).filter(([,value])=>value));
  }
  function clearInputs(){for(const id of ['apiKey','searchKey','accountId'])$(id).value='';}
  function aiUI(){
    const chosen=selection(),paired=['groq_api','cloudflare_api','openrouter_api'].includes(chosen.engine);
    $('keySection').hidden=chosen.engine==='chrome_ai';$('searchKeySection').hidden=!paired;$('accountSection').hidden=chosen.engine!=='cloudflare_api';$('routerSection').hidden=true;
    $('apiKeyLabel').textContent=({groq_api:'Groq API key',cloudflare_api:'Cloudflare API token',openrouter_api:'OpenRouter API key',ninerouter_api:'APP_API_KEY'})[chosen.engine] || 'Gemini API key';
    if(chosen.engine==='ninerouter_api')$('apiKey').placeholder='Nhập APP_API_KEY';
    const help={ninerouter_api:'Chỉ nhập APP_API_KEY. Địa chỉ Adaptive Search được cấu hình trong extension/adaptive-config.js; không dùng ROUTER_API_KEY.',groq_api:'Cần 2 key: Groq và Tavily. Tìm kiếm nhanh, mỗi câu một lượt.',cloudflare_api:'Cần token Cloudflare, Account ID và key Tavily.',openrouter_api:'Dùng bộ định tuyến mô hình miễn phí của OpenRouter và tìm kiếm Tavily. Cần 2 key.',gemini_search:'Chỉ cần key Gemini. Tìm kiếm Google tích hợp; model có thể không trả nguồn cho mọi câu.'};
    $('providerHelp').hidden=!help[chosen.engine];$('providerHelp').textContent=help[chosen.engine] || '';
  }
  function prepareAI(){
    if(modelReady)return Promise.resolve();
    if(preparing)return preparing.promise;
    const engine=new LessonBuiltin.Engine(),task={engine};preparing=task;
    const progress=text=>{if(preparing===task)$('aiStatus').textContent=text;};
    progress('Đang chuẩn bị Chrome AI. Lần đầu hãy giữ popup mở đến khi tải xong.');
    // Downloads stay in the popup's user-activated document. SCORM first waits
    // for its playback setup; selecting a model can also prepare it directly.
    task.promise=engine.prepare(progress).then(async()=>{
      if(preparing!==task)return;
      engine.destroy();
      const result=await chrome.runtime.sendMessage({type:'ENSURE_BUILTIN'});
      if(result?.error)throw Error(result.error);
      modelReady=true;progress('Chrome AI đã sẵn sàng.');
    }).catch(error=>{
      progress('Chưa chuẩn bị được Chrome AI: '+error.message);throw error;
    }).finally(()=>{engine.destroy();if(preparing===task)preparing=null;});
    task.promise.catch(()=>{});return task.promise;
  }
  function cancelPreparation(){const old=preparing;preparing=null;old?.engine.destroy();}
  function keyUI(){
    if(closed || preparing)return;
    $('searchKey').placeholder=ai.searchKeySaved?'Key Tavily trong RAM đã sẵn sàng':'Nhập key Tavily cho phiên này';
    if(!$('accountId').value && ai.accountId)$('accountId').placeholder='Account ID trong RAM đã sẵn sàng';
    $('apiKey').placeholder=ai.engine==='ninerouter_api'?(ai.keySaved?'Key VPS trong RAM đã sẵn sàng':'Nhập APP_API_KEY'):(ai.keySaved?'Key tạm đã sẵn sàng · Nhập để thay thế':'Nhập API key cho phiên này');
    $('aiStatus').textContent=ai.engine==='chrome_ai'?'AI trên máy · Không cần API key':ai.keySaved?'Key trong RAM đã sẵn sàng · Giữ đến khi thoát hẳn Chrome.':'Nhập API key · Chỉ giữ tạm trong RAM, không ghi xuống đĩa.';
  }
  async function save(withKey=false){
    const value=$('aiModel').value;
    const result=await settings({...selection(),...(withKey?entered():{})});
    if(closed||$('aiModel').value!==value)return;
    ai=result;
    if(!withKey && ai.engine==='ninerouter_api')$('apiKey').value='';
    keyUI();
  }
  async function canvas(command){
    let url;try{url=new URL(tabUrl);}catch{}
    if(!url || url.hostname==='scorm.eduone.io.vn' || !(url.protocol==='file:'||/\/quizzes\//.test(url.pathname)))throw Error('Mở trang quiz Canvas trước khi chạy.');
    const message={action:'SUITE_CANVAS_CONTROL',command};
    let response;
    try{response=await chrome.tabs.sendMessage(tabId,message);}catch(error){
      if(['status','stop'].includes(command))throw Error('Tải lại trang Canvas để kết nối tiện ích.');
      await chrome.scripting.insertCSS({target:{tabId},files:['canvas/styles.css','canvas-compact.css']});
      await chrome.scripting.executeScript({target:{tabId},files:['sources.js','canvas-compat.js','canvas/content.js','canvas-controls.js']});
      response=await chrome.tabs.sendMessage(tabId,message);
    }
    if(response?.error)throw Error(response.error);
    return response;
  }
  async function refresh(){
    if(closed||!loaded||working||Date.now()<errorUntil)return;
    try{
      if(mode==='canvas'){const result=await canvas('status');notice(result?.text || 'Sẵn sàng.');return;}
      const result=await chrome.runtime.sendMessage({type:'GET_STATUS',tabId});
      if(result?.error)throw Error(result.error);
      if(result.builtin?.ready)modelReady=true;
      const run=result.run;
      const frame=result.frames?.find(item=>!item.text.startsWith('Chưa thấy slide'));
      const status=run?.needsPreparation?(result.builtin?.phase==='error'?result.builtin.detail:'Đã bật chạy nền. Đang chuẩn bị AI để xử lý câu hỏi…'):run?.running?(frame?.text || run.message):(run?.message || 'Sẵn sàng. Bấm Bắt đầu để chạy bài học.');
      notice(status+(run?.running && result.methodLog?.text?'\n'+result.methodLog.text:''));
    }catch(error){notice(error.message);}
  }
  async function start(command){
    if(!loaded||working)return;
    const token=++epoch;working=true;lock();errorUntil=0;
    const local=$('aiModel').value==='chrome_ai';
    // SCORM enables playback in the worker before either native AI host starts.
    const preparation=local && command!=='START'?prepareAI():Promise.resolve();
    try{
      if(!local){
        if(selection().engine==='ninerouter_api' && $('apiKey').value.includes('|'))throw Error('Chỉ nhập APP_API_KEY, không nhập URL.');
        const key=$('apiKey').value.trim();
        if(!key && !ai.keySaved)throw Error('Nhập API key cho phiên này. Key chỉ giữ tạm trong RAM.');
        const pending=chrome.runtime.sendMessage({action:'SUITE_START',tabId,command:command==='START'?'scorm':command,
          data:{...selection(),...entered()}});
        clearInputs();
        const response=await pending;
        if(token!==epoch || closed)return;
        if(!response?.success)throw Error(response?.error || 'Không bắt đầu được phiên.');
        if(response.data?.cancelled)return;
        ai.keySaved=true;keyUI();notice(response.data?.text || response.data?.message || 'Đang bắt đầu…');
        return;
      }
      await save();if(token!==epoch)return;
      if(command==='START'){
        const response=await chrome.runtime.sendMessage({type:'START',tabId,ai:{engine:ai.engine,model:ai.model}});
        if(response?.error)throw Error(response.error);
        if(local && token===epoch && !closed && (response?.needsPreparation || response?.running)) prepareAI();
        notice(response?.message || 'Đang bắt đầu…');
      }else{
        await preparation;if(token!==epoch)return;
        const response=await canvas(command);notice(response?.text || 'Đã bắt đầu trên Canvas.');
      }
    }catch(error){if(token===epoch)notice(error.message,true);}
    finally{if(token===epoch){working=false;lock();await refresh();}}
  }
  async function stop(canvasMode){
    epoch++;working=false;cancelPreparation();lock();
    try{
      if(canvasMode)await canvas('stop');
      else {const result=await chrome.runtime.sendMessage({type:'STOP',tabId});if(result?.error)throw Error(result.error);}
      await chrome.runtime.sendMessage({action:'SUITE_CLEAR_KEY',data:{tabId}});
      clearInputs();ai=await settings();keyUI();
      notice('Đã dừng. Key vẫn giữ trong RAM đến khi thoát hẳn Chrome.');errorUntil=Date.now()+1500;
    }catch(error){notice(error.message,true);}
  }
  $('aiModel').addEventListener('change',()=>{
    clearInputs();$('baseURL').value='';$('routerModel').value='';$('searchModel').value='tavily/search';ai={...ai,keySaved:false,searchKeySaved:false,accountId:''};aiUI();modelReady=false;
    if($('aiModel').value==='chrome_ai')prepareAI();else cancelPreparation();
    save().catch(error=>notice(error.message,true));
  });
  for(const id of ['apiKey','searchKey','accountId','baseURL','routerModel','searchModel'])$(id).addEventListener('input',()=>{
    if(id==='baseURL')$('apiKey').value='';
    if(loaded && $(id).value.trim())save(true).catch(error=>notice(error.message,true));
  });
  $('start').addEventListener('click',()=>start('START'));
  $('canvas-auto').addEventListener('click',()=>start('auto'));
  $('canvas-target').addEventListener('click',()=>start('target'));
  $('stop').addEventListener('click',()=>stop(false));$('canvas-stop').addEventListener('click',()=>stop(true));
  for(const name of ['scorm','canvas']){
    $('tab-'+name).addEventListener('click',()=>select(name));
    $('tab-'+name).addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
      event.preventDefault();select(mode==='canvas'?'scorm':'canvas');$('tab-'+mode).focus();
    });
  }
  window.addEventListener('pagehide',()=>{closed=true;epoch++;clearInputs();cancelPreparation();});
  (async()=>{
    const tabs=await chrome.tabs.query({active:true,currentWindow:true});
    if(closed)return;
    tabId=tabs[0]?.id;tabUrl=tabs[0]?.url || '';
    const config=await settings();if(closed)return;ai=config;
    const value=ai.engine==='chrome_ai'?'chrome_ai':ai.engine==='gemini_api'?ai.model:ai.engine==='ninerouter_api'?'ninerouter':ai.engine+'|'+ai.model;
    if(![...$('aiModel').options].some(option=>option.value===value))$('aiModel').add(new Option(ai.model,value));
    $('aiModel').value=value;
    if(ai.engine==='ninerouter_api'){$('baseURL').value='';$('routerModel').value='';$('searchModel').value='';}
    aiUI();
    keyUI();
    let url;try{url=new URL(tabUrl);}catch{}
    const isCanvas=url && url.hostname!=='scorm.eduone.io.vn' && (/\/quizzes\//.test(url.pathname)||url.protocol==='file:');
    $('context').textContent=isCanvas?'Canvas Quiz':url?.hostname==='scorm.eduone.io.vn'?'Bài học SCORM':'Mở trang học để bắt đầu';
    loaded=true;lock();select(isCanvas?'canvas':'scorm');setInterval(refresh,1500);
  })().catch(error=>notice(error.message,true));
})();
