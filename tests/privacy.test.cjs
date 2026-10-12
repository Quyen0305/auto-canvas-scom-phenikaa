const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {webcrypto}=require('node:crypto');

function setup({blocked=false,oldChrome=false,fetcher}={}) {
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
  const chrome={storage:{local,...(!oldChrome?{session:{...local}}:{})},
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

test('key is cleared on Stop and cannot survive a worker restart',async()=>{
  const h=setup();await h.request({action:'SUITE_SETTINGS',data:{tabId:7,apiKey:'TEST_RAM_KEY'}});
  await h.request({type:'START',tabId:7});await h.request({type:'STOP',tabId:7});
  assert.equal((await h.request({action:'SUITE_SETTINGS',tabId:7})).data.keySaved,false);
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

test('Canvas on-page Stop clears its RAM key',async()=>{
  const h=setup();await h.request({action:'SUITE_SETTINGS',data:{tabId:9,apiKey:'TEST_RAM_KEY'}});
  await h.request({action:'SET_AUTO_STATE',data:{enabled:false}},{url:'https://canvas.test/courses/1/quizzes/2/take',tab:{id:9}});
  assert.equal((await h.request({action:'SUITE_SETTINGS',tabId:9})).data.keySaved,false);
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

test('closing a Canvas tab discards its key even without a SCORM run record',async()=>{
  const h=setup();await h.request({action:'SUITE_SETTINGS',data:{apiKey:'TEST_KEY',tabId:9}});
  await h.removed(9);
  assert.equal((await h.request({action:'SUITE_SETTINGS',tabId:9})).data.keySaved,false);
});

test('Canvas key survives same-quiz navigation but is discarded when leaving the quiz',async()=>{
  const h=setup();h.context.chrome.tabs.get=async()=>({url:'https://canvas.test/courses/1/quizzes/2/take'});
  await h.request({action:'SUITE_SETTINGS',data:{apiKey:'TEST_KEY',tabId:9}});
  await h.updated(9,{url:'https://canvas.test/courses/1/quizzes/2/take/questions/1'});
  assert.equal((await h.request({action:'SUITE_SETTINGS',tabId:9})).data.keySaved,true);
  await h.updated(9,{url:'https://canvas.test/courses/1/quizzes/3/take'});
  assert.equal((await h.request({action:'SUITE_SETTINGS',tabId:9})).data.keySaved,false);
});
