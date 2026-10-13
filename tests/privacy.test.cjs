const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {webcrypto}=require('node:crypto');

function setup({blocked=false,oldChrome=false,fetcher,volatileSession={}}={}) {
  const listeners=[],nativeWrites=[];
  let removed,updated;
  const disk={apiKey:'OLD_SECRET','canvas:apiKey':'OLD_SECRET','suite:previousScormKey':'OLD_SECRET',
    'canvas:geminiAnswerCacheV2':{old:{}},'canvas:canvasGradedAnswersV1':{old:{}},'suite:question:old':{old:true}};
  const local={
    async get(){if(blocked)throw Error('Storage restricted');return {...disk};},
    async set(value){nativeWrites.push(value);if(blocked)throw Error('Storage restricted');Object.assign(disk,value);},
    async remove(keys){if(blocked)throw Error('Storage restricted');for(const key of keys)delete disk[key];}
  };
  if(!oldChrome)local.setAccessLevel=async()=>{};
  const session={
    async get(key){return {[key]:volatileSession[key]};},
    async set(values){Object.assign(volatileSession,JSON.parse(JSON.stringify(values)));},
    async remove(key){delete volatileSession[key];}
  };
  const chrome={storage:{local,...(!oldChrome?{session}:{})},
    runtime:{id:'suite',getURL:p=>'chrome-extension://suite/'+p,onMessage:{addListener:fn=>listeners.push(fn)},onConnect:{addListener(){}}},
    tabs:{onRemoved:{addListener(fn){removed=fn;}},onUpdated:{addListener(fn){updated=fn;}},get:async()=>({url:'https://scorm.eduone.io.vn/en/learn/test'}),sendMessage:async()=>({})},
    scripting:{executeScript:async()=>[]}};
  const context=vm.createContext({chrome,URL,DOMException,AbortController,TextEncoder,crypto:webcrypto,console,setTimeout,clearTimeout,fetch:fetcher});
  context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join('extension',file),'utf8'),context,{filename:file}));
  assert.doesNotThrow(()=>context.importScripts('suite-background.js'),'worker must boot without setAccessLevel or session storage');
  const request=(message,sender={id:'suite',url:'chrome-extension://suite/suite-popup.html'})=>new Promise((resolve,reject)=>{
    let claimed=0;for(const fn of listeners)if(fn(message,sender,resolve)===true)claimed++;
    if(claimed!==1)reject(Error('Expected one handler, got '+claimed));
  });
  return {context,request,disk,nativeWrites,removed:(...args)=>removed(...args),updated:(...args)=>updated(...args)};
}

test('old Chrome and blocked disk still boot the worker and accept a manually entered key',async()=>{
  const h=setup({blocked:true,oldChrome:true});
  const settings=await h.request({action:'SUITE_SETTINGS',data:{engine:'gemini_api',model:'gemini-2.5-flash',tabId:7,apiKey:'TEST_RAM_KEY'}});
  assert.equal(settings.success,true);assert.equal(settings.data.keySaved,true);
  const started=await h.request({type:'START',tabId:7});assert.equal(started.running,true);
  assert.equal(h.nativeWrites.length,0);
  assert.equal(JSON.stringify(await h.request({type:'GET_STATUS',tabId:7})).includes('TEST_RAM_KEY'),false);
});

test('key survives Stop but is absent in a new browser session',async()=>{
  const h=setup();await h.request({action:'SUITE_SETTINGS',data:{tabId:7,apiKey:'TEST_RAM_KEY'}});
  await h.request({type:'START',tabId:7});await h.request({type:'STOP',tabId:7});
  assert.equal((await h.request({action:'SUITE_SETTINGS',tabId:7})).data.keySaved,true);
  const restarted=setup();assert.equal((await restarted.request({action:'SUITE_SETTINGS',tabId:7})).data.keySaved,false);
  assert.equal(h.nativeWrites.length,0);
});

test('upgrade discards legacy credentials and answer archives without writing new data',async()=>{
  const h=setup();await h.request({action:'SUITE_SETTINGS',tabId:7});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(Object.keys(h.disk),[]);assert.equal(h.nativeWrites.length,0);
});

test('legacy answer lookup and grading requests do not save or reuse answers',async()=>{
  const h=setup();const sender={url:'https://canvas.test/courses/1/quizzes/2/take',tab:{id:9}};
  const question={id:'q1',questionText:'1 + 1?',options:['1','2']};
  const lookup=await h.request({action:'GET_CACHED_ANSWERS',data:{questions:[question]}},sender);
  assert.equal(lookup.success,true);assert.deepEqual(Array.from(lookup.data.answers),[]);
  await h.request({action:'RECORD_QUIZ_RESULTS',data:{observations:[{question,selected_indices:[1],earned:1,possible:1}]}},sender);
  const again=await h.request({action:'GET_CACHED_ANSWERS',data:{questions:[question]}},sender);
  assert.deepEqual(Array.from(again.data.answers),[]);assert.equal(h.nativeWrites.length,0);
});

test('solving the same Canvas question twice always requests a fresh AI answer',async()=>{
  let calls=0;
  const h=setup({fetcher:async()=>{
    calls++;
    return {ok:true,text:async()=>JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({answers:[{
      id:'q1',answerable:true,selected_indices:[1],answer_texts:['2'],explanation:'Một cộng một bằng hai.'
    }]})}]}}]})};
  }});
  h.context.clockNow=100000;vm.runInContext('Date.now=()=>clockNow',h.context);
  await h.request({action:'SUITE_SETTINGS',data:{tabId:9,apiKey:'TEST_RAM_KEY'}});
  const sender={url:'https://canvas.test/courses/1/quizzes/2/take',tab:{id:9}};
  const data={apiKey:'TEST_RAM_KEY',model:'gemini-2.5-flash',questions:[{id:'q1',questionText:'1 + 1?',options:['1','2']}]};
  const first=await h.request({action:'SOLVE_QUESTIONS',data},sender);assert.equal(first.success,true);
  h.context.clockNow+=7000;
  const second=await h.request({action:'SOLVE_QUESTIONS',data},sender);assert.equal(second.success,true);
  assert.equal(calls,2);assert.equal(second.data.cachedCount,0);assert.equal(h.nativeWrites.length,0);
});

test('Canvas on-page Stop retains the browser-session key',async()=>{
  const h=setup();await h.request({action:'SUITE_SETTINGS',data:{tabId:9,apiKey:'TEST_RAM_KEY'}});
  await h.request({action:'SET_AUTO_STATE',data:{enabled:false}},{url:'https://canvas.test/courses/1/quizzes/2/take',tab:{id:9}});
  assert.equal((await h.request({action:'SUITE_SETTINGS',tabId:9})).data.keySaved,true);
});

test('stopping one tab cannot erase the RAM key of another active run',async()=>{
  const h=setup();
  await h.request({action:'SUITE_SETTINGS',data:{apiKey:'KEY_ONE',tabId:7}});
  await h.request({type:'START',tabId:7});
  await h.request({action:'SUITE_SETTINGS',data:{apiKey:'KEY_TWO',tabId:8}});
  await h.request({type:'START',tabId:8});
  await h.request({type:'STOP',tabId:7});
  const canvas=await h.request({action:'CANVAS_STORAGE',data:{area:'local',method:'get',value:['apiKey']}},
    {url:'https://canvas.test/courses/1/quizzes/2/take',tab:{id:8}});
  assert.equal(canvas.data.apiKey,'KEY_TWO');
});

test('closing a Canvas tab keeps its key for the rest of the browser session',async()=>{
  const h=setup();await h.request({action:'SUITE_SETTINGS',data:{apiKey:'TEST_KEY',tabId:9}});
  await h.removed(9);
  assert.equal((await h.request({action:'SUITE_SETTINGS',tabId:9})).data.keySaved,true);
});

test('browser-session key survives navigation to another quiz',async()=>{
  const h=setup();h.context.chrome.tabs.get=async()=>({url:'https://canvas.test/courses/1/quizzes/2/take'});
  await h.request({action:'SUITE_SETTINGS',data:{apiKey:'TEST_KEY',tabId:9}});
  await h.updated(9,{url:'https://canvas.test/courses/1/quizzes/2/take/questions/1'});
  assert.equal((await h.request({action:'SUITE_SETTINGS',tabId:9})).data.keySaved,true);
  await h.updated(9,{url:'https://canvas.test/courses/1/quizzes/3/take'});
  assert.equal((await h.request({action:'SUITE_SETTINGS',tabId:9})).data.keySaved,true);
});

test('key remains in browser-session RAM after an ordinary worker restart',async()=>{
  const volatileSession={};const h=setup({volatileSession});
  await h.request({action:'SUITE_SETTINGS',data:{apiKey:'TEST_KEY',model:'gemini-2.5-flash',tabId:7}});
  const restarted=setup({volatileSession});
  const restored=(await restarted.request({action:'SUITE_SETTINGS',tabId:7})).data;
  assert.equal(restored.keySaved,true);assert.equal(restored.model,'gemini-2.5-flash');
  await restarted.request({type:'STOP',tabId:7});
  assert.equal((await restarted.request({action:'SUITE_SETTINGS',tabId:7})).data.keySaved,true);
  assert.equal(h.nativeWrites.length,0);assert.equal(restarted.nativeWrites.length,0);
});

test('one worker-owned request accepts the key and starts even after the popup disappears',async()=>{
  const h=setup({blocked:true,oldChrome:true});
  const pending=h.request({action:'SUITE_START',tabId:7,command:'scorm',data:{engine:'gemini_api',model:'gemini-2.5-flash',apiKey:'TEST_KEY'}});
  const response=await pending;
  assert.equal(response.success,true);assert.equal(response.data.running,true);assert.equal(h.nativeWrites.length,0);
});

test('Stop cancels a pending worker-owned start before it can store or use a key',async()=>{
  const h=setup();let release;
  h.context.chrome.tabs.get=()=>new Promise(resolve=>{release=resolve;});
  const pending=h.request({action:'SUITE_START',tabId:7,command:'scorm',data:{model:'gemini-2.5-flash',apiKey:'TEST_KEY'}});
  await h.request({type:'STOP',tabId:7});
  release({url:'https://scorm.eduone.io.vn/en/learn/test'});
  const result=await pending;assert.equal(result.data.cancelled,true);
  assert.equal((await h.request({action:'SUITE_SETTINGS',tabId:7})).data.keySaved,false);
  assert.notEqual((await h.request({type:'GET_STATUS',tabId:7})).run?.running,true);
});

test('restricted session storage falls back to worker RAM without disk writes',async()=>{
  const h=setup({blocked:true});
  for(const method of ['get','set','remove'])h.context.chrome.storage.session[method]=async()=>{throw Error('Session restricted');};
  await h.request({action:'SUITE_SETTINGS',data:{apiKey:'TEST_KEY',tabId:7}});
  assert.equal((await h.request({action:'SUITE_SETTINGS',tabId:7})).data.keySaved,true);
  await h.request({type:'STOP',tabId:7});
  assert.equal((await h.request({action:'SUITE_SETTINGS',tabId:7})).data.keySaved,true);
  assert.equal(h.nativeWrites.length,0);
});

test('another tab cannot change the model of a worker-owned SCORM Start in progress',async()=>{
  const h=setup();let release;
  await h.request({action:'SUITE_SETTINGS',data:{apiKey:'KEY_TWO',model:'gemini-3.8-flash',tabId:8}});
  h.context.chrome.tabs.sendMessage=(id,message)=>id===7 && message.type==='STOP'?new Promise(resolve=>{release=resolve;}):Promise.resolve({});
  const pending=h.request({action:'SUITE_START',tabId:7,command:'scorm',data:{model:'gemini-2.5-flash',apiKey:'KEY_ONE'}});
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  await h.request({action:'CANVAS_STORAGE',data:{area:'local',method:'get',value:['aiModel']}},
    {url:'https://canvas.test/courses/1/quizzes/2/take',tab:{id:8}});
  release({});
  assert.equal((await pending).data.config.model,'gemini-2.5-flash');
});

test('the browser-session key is ready in a new tab after the original tab closes',async()=>{
  const h=setup();await h.request({action:'SUITE_SETTINGS',data:{apiKey:'TEST_KEY',tabId:7}});
  await h.removed(7);
  const newTab=(await h.request({action:'SUITE_SETTINGS',tabId:9})).data;
  assert.equal(newTab.keySaved,true);
  const settings=await h.request({action:'CANVAS_STORAGE',data:{area:'local',method:'get',value:['apiKey']}},
    {url:'https://canvas.test/courses/1/quizzes/2/take',tab:{id:9}});
  assert.equal(settings.data.apiKey,'TEST_KEY');assert.equal(h.nativeWrites.length,0);
});
