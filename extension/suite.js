(() => {
  const $=id=>document.getElementById(id);
  let mode='scorm',tabId,tabUrl='',loaded=false,working=false,closed=false,epoch=0,errorUntil=0;
  let ai={engine:'gemini_api',model:'gemini-2.5-flash'},preparing=null,modelReady=false;
  function notice(text,bad=false){if(closed)return;$('status').textContent=text;$('status').classList.toggle('error',bad);if(bad)errorUntil=Date.now()+7000;}
  async function settings(patch){
    const result=await chrome.runtime.sendMessage({action:'SUITE_SETTINGS',...(patch?{data:patch}:{})});
    if(!result?.success)throw Error(result?.error || 'Không lưu được lựa chọn AI.');
    return result.data;
  }
  function lock(){
    if(closed)return;
    $('aiModel').disabled=$('apiKey').disabled=!loaded||working;
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
  function aiUI(){
    $('keySection').hidden=$('aiModel').value==='chrome_ai';
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
  async function save(){
    const value=$('aiModel').value,key=$('apiKey').value.trim();
    ai=await settings({engine:value==='chrome_ai'?'chrome_ai':'gemini_api',model:value==='chrome_ai'?ai.model:value,...(key?{apiKey:key}:{})});
    if(closed)return;
    if($('apiKey').value.trim()===key)$('apiKey').value='';
    $('apiKey').placeholder=ai.keySaved?'Đã lưu key · Nhập để thay thế':'Nhập key — tự lưu khi rời ô';
    if(!preparing)$('aiStatus').textContent=ai.engine==='chrome_ai'?'AI trên máy · Không cần API key':ai.keySaved?'Đã lưu · Áp dụng cho cả hai công cụ':'Nhập API key để dùng Gemini.';
  }
  async function canvas(command){
    let url;try{url=new URL(tabUrl);}catch{}
    if(!url || url.hostname==='scorm.eduone.io.vn' || !(url.protocol==='file:'||/\/quizzes\//.test(url.pathname)))throw Error('Mở trang quiz Canvas trước khi chạy.');
    const message={action:'SUITE_CANVAS_CONTROL',command};
    let response;
    try{response=await chrome.tabs.sendMessage(tabId,message);}catch(error){
      if(['status','stop'].includes(command))throw Error('Tải lại trang Canvas để kết nối tiện ích.');
      await chrome.scripting.insertCSS({target:{tabId},files:['canvas/styles.css','canvas-compact.css']});
      await chrome.scripting.executeScript({target:{tabId},files:['archive-content.js','canvas-compat.js','canvas/content.js','canvas-controls.js']});
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
      notice(run?.needsPreparation?(result.builtin?.phase==='error'?result.builtin.detail:'Đã bật chạy nền. Đang chuẩn bị AI để xử lý câu hỏi…'):run?.running?(frame?.text || run.message):(run?.message || 'Sẵn sàng. Bấm Bắt đầu để chạy bài học.'));
    }catch(error){notice(error.message);}
  }
  async function start(command){
    if(!loaded||working)return;
    const token=++epoch;working=true;lock();errorUntil=0;
    const local=$('aiModel').value==='chrome_ai';
    // SCORM enables playback in the worker before either native AI host starts.
    const preparation=local && command!=='START'?prepareAI():Promise.resolve();
    try{
      await save();if(token!==epoch)return;
      if(command==='START'){
        const response=await chrome.runtime.sendMessage({type:'START',tabId});
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
      notice('Đã dừng.');errorUntil=Date.now()+1500;
    }catch(error){notice(error.message,true);}
  }
  $('aiModel').addEventListener('change',()=>{
    aiUI();modelReady=false;
    if($('aiModel').value==='chrome_ai')prepareAI();else cancelPreparation();
    save().catch(error=>notice(error.message,true));
  });
  $('apiKey').addEventListener('change',()=>save().catch(error=>notice(error.message,true)));
  $('export-questions').addEventListener('click', async () => {
    const button=$('export-questions'), status=$('export-status');
    button.disabled=true;status.textContent='Đang gom câu hỏi và các lượt cũ còn xem được… Giữ popup mở đến khi tải xuống.';
    try {
      const tabs=await chrome.tabs.query({url:['https://*/*quizzes/*','http://*/*quizzes/*']});
      let missed=0;
      await Promise.all(tabs.filter(tab=>/\/quizzes\//.test(tab.url || '')).map(async tab=>{
        try {
          await chrome.scripting.executeScript({target:{tabId:tab.id},files:['archive-content.js']});
          const saved=await chrome.tabs.sendMessage(tab.id,{action:'BANK_FLUSH'});
          if(!saved?.success)missed++;
        } catch { missed++; }
      }));
      if(closed)return;
      // The popup is a trusted extension page and can read its own local archive.
      // Do not send the whole history through a worker message: an older worker
      // may not handle BANK_EXPORT, and large histories can exceed message limits.
      // BANK_FLUSH above waits for the current Canvas observations to be saved.
      const archive=await QuestionBank.list();
      if(!archive.entries.length && missed)throw Error('Tab Canvas chưa kết nối được kho câu hỏi. Tải lại tiện ích tại chrome://extensions, F5 trang kết quả rồi xuất lại.');
      const warning=[archive.warning,missed?`${missed} tab Canvas chưa đọc được; tải lại tiện ích và các tab này rồi xuất lại.`:''].filter(Boolean).join(' ');
      const output=BankExport.build(archive.entries,warning);
      const blob=new Blob([output.bytes],{type:'application/zip'}),url=URL.createObjectURL(blob);
      const link=document.createElement('a');link.href=url;link.download='Cau-hoi-'+new Date().toISOString().slice(0,10)+'.zip';
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      status.textContent=`Đã xuất ${output.questions} câu đã chấm đúng / ${output.groups} bài tập.`+(output.skipped?` Bỏ qua ${output.skipped} câu chưa xác nhận hoặc mâu thuẫn.`:'')+(warning?' Có dữ liệu chưa đọc được; xem Đọc trước.txt.':'');
    } catch(error) { status.textContent=error.message; }
    finally { button.disabled=false; }
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
  window.addEventListener('pagehide',()=>{closed=true;epoch++;cancelPreparation();});
  (async()=>{
    const [config,tabs]=await Promise.all([settings(),chrome.tabs.query({active:true,currentWindow:true})]);
    if(closed)return;
    ai=config;tabId=tabs[0]?.id;tabUrl=tabs[0]?.url || '';
    if(![...$('aiModel').options].some(option=>option.value===ai.model))$('aiModel').add(new Option(ai.model,ai.model));
    $('aiModel').value=ai.engine==='chrome_ai'?'chrome_ai':ai.model;aiUI();
    $('apiKey').placeholder=ai.keySaved?'Đã lưu key · Nhập để thay thế':'Nhập key — tự lưu khi rời ô';
    $('aiStatus').textContent=ai.engine==='chrome_ai'?'AI trên máy · Tự chuẩn bị khi bắt đầu':ai.keySaved?'Đã lưu · Áp dụng cho cả hai công cụ':'Nhập API key để dùng Gemini.';
    let url;try{url=new URL(tabUrl);}catch{}
    const isCanvas=url && url.hostname!=='scorm.eduone.io.vn' && (/\/quizzes\//.test(url.pathname)||url.protocol==='file:');
    $('context').textContent=isCanvas?'Canvas Quiz':url?.hostname==='scorm.eduone.io.vn'?'Bài học SCORM':'Mở trang học để bắt đầu';
    loaded=true;lock();select(isCanvas?'canvas':'scorm');setInterval(refresh,1500);
  })().catch(error=>notice(error.message,true));
})();
