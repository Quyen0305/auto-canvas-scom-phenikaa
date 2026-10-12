// One worker, two independent modules. Canvas uses action; SCORM uses type.
importScripts('runtime-storage.js','shared-settings.js','background.js','canvas-compat.js','canvas/chrome-ai.js');
const SuiteCanvasAI = {solve: requestCanvasAI};
importScripts('canvas/background.js');

chrome.runtime.onMessage.addListener((message,sender,reply)=>{
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
    const trusted=sender.url?.startsWith(chrome.runtime.getURL(''));
    if(!trusted && !sender.tab)return;
    SuiteSettings.clearKey(trusted ? message.data?.tabId : sender.tab.id).then(()=>reply({success:true}),error=>reply({success:false,error:error.message}));return true;
  }
  if(message.action==='SUITE_SETTINGS') {
    if(sender.id && sender.id!==chrome.runtime.id)return;
    if(!sender.url?.startsWith(chrome.runtime.getURL('')))return;
    const task=message.data ? (async()=>{
      const patch={...message.data};
      if(typeof patch.apiKey==='string')patch.sourceUrl=(await chrome.tabs.get(patch.tabId)).url;
      return SuiteSettings.save(patch);
    })() : SuiteSettings.ensure(message.tabId);
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
    await SuiteSettings.ensure();
    if(method==='set') {
      for(const key of ['apiKey','aiModel','aiEngine'])if(Object.hasOwn(value,key))throw new Error('Đổi AI tại popup chung.');
      value.autoClickAnswer=true;value.autoNextQuestion=true;value.answerReviewVersion=2;
    }
    const result=await CanvasCompat.create(false).storage.local[method](value);
    if(method==='get' && keys.includes('apiKey'))result.apiKey=await SuiteSettings.keyForTab(sender.tab.id);
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
