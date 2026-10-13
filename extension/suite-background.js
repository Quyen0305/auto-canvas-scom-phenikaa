// One worker, two independent modules. Canvas uses action; SCORM uses type.
importScripts('runtime-storage.js','cloud-providers.js','shared-settings.js','background.js','canvas-compat.js','canvas/chrome-ai.js');
const SuiteCanvasAI = {solve: requestCanvasAI};
importScripts('canvas/background.js');

const suiteStarts=new Map();
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  const trusted=sender.url?.startsWith(chrome.runtime.getURL(''));
  if(message.type==='STOP' && trusted)suiteStarts.delete(message.tabId);
  if(message.action==='SET_AUTO_STATE' && message.data?.enabled===false && sender.tab)suiteStarts.delete(sender.tab.id);
  if(message.action==='SUITE_START') {
    if(sender.id && sender.id!==chrome.runtime.id)return;
    if(!trusted)return;
    const id=message.tabId,token=crypto.randomUUID();suiteStarts.set(id,token);
    const current=()=>suiteStarts.get(id)===token;
    (async()=>{
      if(!Number.isInteger(id) || !['scorm','auto','target'].includes(message.command))throw Error('Thao tác bắt đầu không hợp lệ.');
      const tab=await chrome.tabs.get(id),url=new URL(tab.url || '');
      const scorm=url.hostname==='scorm.eduone.io.vn';
      if(message.command==='scorm'?!scorm:scorm || !(url.protocol==='file:' || /\/quizzes\//.test(url.pathname)))throw Error('Mở đúng trang học trước khi bắt đầu.');
      if(!current())return {cancelled:true};
      const ai=await SuiteSettings.save({...message.data,engine:message.data?.engine || 'gemini_api',tabId:id});
      if(!current())return {cancelled:true};
      if(!ai.keySaved)throw Error('Nhập API key cho phiên này. Key chỉ giữ tạm trong RAM.');
      SuiteCloud.check(await SuiteSettings.credentialsFor(ai));
      if(!current())return {cancelled:true};
      if(message.command==='scorm')return handle({type:'START',tabId:id,ai},sender);
      const control={action:'SUITE_CANVAS_CONTROL',command:message.command};
      let response;
      try {response=await chrome.tabs.sendMessage(id,control);}
      catch {
        await chrome.scripting.insertCSS({target:{tabId:id},files:['canvas/styles.css','canvas-compact.css']});
        if(!current())return {cancelled:true};
        await chrome.scripting.executeScript({target:{tabId:id},files:['sources.js','canvas-compat.js','canvas/content.js','canvas-controls.js']});
        if(!current())return {cancelled:true};
        response=await chrome.tabs.sendMessage(id,control);
      }
      if(response?.error)throw Error(response.error);
      return response;
    })().then(data=>reply({success:true,data}),error=>reply({success:false,error:error.message})).finally(()=>{if(current())suiteStarts.delete(id);});
    return true;
  }
  if(message.action==='SUITE_HEARTBEAT') {
    if(sender.id && sender.id!==chrome.runtime.id)return;
    if(!sender.tab)return;
    reply({success:true});return true;
  }
  if (['BANK_WARNING','BANK_RECORD','BANK_EXPORT'].includes(message.action)) {
    reply({success:false,error:'Tiện ích không lưu câu hỏi hoặc đáp án.'}); return true;
  }
  if(message.action==='SUITE_CLEAR_KEY') {
    if(sender.id && sender.id!==chrome.runtime.id)return;
    if(!trusted && !sender.tab)return;
    suiteStarts.delete(trusted ? message.data?.tabId : sender.tab.id);
    // Compatibility with older popups: Stop cancels startup, not the browser-session key.
    reply({success:true});return true;
  }
  if(message.action==='SUITE_SETTINGS') {
    if(sender.id && sender.id!==chrome.runtime.id)return;
    if(!sender.url?.startsWith(chrome.runtime.getURL('')))return;
    const task=message.data ? SuiteSettings.save(message.data) : SuiteSettings.ensure(message.tabId);
    task.then(data=>reply({success:true,data}),error=>reply({success:false,error:error.message}));return true;
  }
  if(message.action !== 'CANVAS_STORAGE')return;
  const allowed = new Set(['aiEngine','apiKey','aiModel','autoDelay','autoClickAnswer','autoNextQuestion','answerReviewVersion','isAutoRunningContinuous']);
  (async()=>{
    const url = new URL(sender.url || '');
    if(!sender.tab || !((['https:','http:'].includes(url.protocol) && /\/quizzes\//.test(url.pathname)) || url.protocol==='file:')) throw new Error('Không phải trang Canvas được hỗ trợ.');
    const {area,method,value}=message.data || {};
    const keys=typeof value==='string'?[value]:Array.isArray(value)?value:value && typeof value==='object'?Object.keys(value):[];
    if(area!=='local'||!['get','set'].includes(method)||!keys.length||keys.some(key=>!allowed.has(key))) throw new Error('Yêu cầu dữ liệu Canvas không hợp lệ.');
    const ai=await SuiteSettings.ensure(sender.tab.id);
    if(method==='set') {
      for(const key of ['apiKey','aiModel','aiEngine'])if(Object.hasOwn(value,key))throw new Error('Đổi AI tại popup chung.');
      value.autoClickAnswer=true;value.autoNextQuestion=true;value.answerReviewVersion=2;
    }
    const result=await CanvasCompat.create(false).storage.local[method](value);
    if(method==='get' && keys.includes('aiModel'))result.aiModel=ai.model;
    if(method==='get' && keys.includes('aiEngine'))result.aiEngine=ai.engine;
    if(method==='get' && keys.includes('apiKey'))result.apiKey=ai.engine==='gemini_api' ? await SuiteSettings.keyForTab(sender.tab.id) : '';
    return result;
  })().then(data=>reply({success:true,data}),error=>reply({success:false,error:error.message}));
  return true;
});

async function requestCanvasAI(prompt,signal,schema) {
  signal.throwIfAborted();
  await openBuiltin();
  const deadline=Date.now()+15000;
  while(!builtinHost) {
    signal.throwIfAborted();
    if(Date.now()>deadline) throw new Error('Chưa kết nối được Chrome AI. Hãy thử lại.');
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  signal.throwIfAborted();
  const host=builtinHost,id=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const finish=(error,value)=>{
      signal.removeEventListener('abort',abort);builtinJobs.delete(id);
      error?reject(error):resolve(value);
    };
    const abort=()=>{try{host.port.postMessage({type:'cancel',id});}catch{} finish(signal.reason || new DOMException('Aborted','AbortError'));};
    signal.addEventListener('abort',abort,{once:true});
    builtinJobs.set(id,{host,finish});
    try {host.port.postMessage({type:'canvas-solve',id,prompt,schema});}catch(error){finish(error);}
  });
}
