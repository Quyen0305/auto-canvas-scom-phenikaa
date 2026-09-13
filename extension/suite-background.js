// One worker, two independent modules. Canvas uses action; SCORM uses type.
importScripts('question-bank.js','shared-settings.js','background.js', 'canvas-compat.js', 'canvas/chrome-ai.js', 'canvas/quiz-learning.js');
const SuiteCanvasAI = {solve: requestCanvasAI};
importScripts('canvas/background.js');

chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if (message.action === 'BANK_WARNING') {
    if (sender.id && sender.id !== chrome.runtime.id) return;
    if (!sender.tab || !/\/quizzes\//.test(new URL(sender.url || 'about:blank').pathname)) return;
    QuestionBank.failure(Error(String(message.data?.message || 'Không đọc được lịch sử.').slice(0,500))).then(()=>reply({success:true}));
    return true;
  }
  if (message.action === 'BANK_RECORD' || message.action === 'BANK_EXPORT') {
    if (sender.id && sender.id !== chrome.runtime.id) return;
    const trusted = sender.url?.startsWith(chrome.runtime.getURL(''));
    if (message.action === 'BANK_EXPORT' && !trusted) { reply({success:false,error:'Chỉ xuất kho câu hỏi từ popup.'}); return true; }
    const task = message.action === 'BANK_EXPORT' ? QuestionBank.list() : QuestionBank.record(sender, message.data || {});
    task.then(data => reply({success:true,data}), async error => {
      await QuestionBank.failure(error); reply({success:false,error:error.message});
    });
    return true;
  }
  if(message.action==='SUITE_SETTINGS') {
    if(sender.id && sender.id!==chrome.runtime.id)return;
    if(!sender.url?.startsWith(chrome.runtime.getURL('')))return;
    const task=message.data ? SuiteSettings.save(message.data) : SuiteSettings.ensure();
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
    return CanvasCompat.create(false).storage.local[method](value);
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
