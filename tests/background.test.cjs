const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const core = require('../extension/core.js');
function setup(fetcher, clock = {}) {
  const data = {local: {apiKey:'test-key-never-real',config:{model:'gemini-2.5-flash'}},session:{'tab:7':{running:true,session:'s',config:core.defaults}}};
  const levels = [], injections = [], opened = [], activated = [], tabList = []; let listener, onConnect;
  const storage = name => ({async get(keys) { return keys == null ? {...data[name]} : Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[name][k]])); },
    async set(values){Object.assign(data[name],values);}, async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[name][k];},
    async setAccessLevel(value){levels.push([name,value.accessLevel]);}});
  const context = vm.createContext({LessonCore:core, importScripts(){}, fetch:fetcher, AbortController, crypto:webcrypto, setTimeout:clock.setTimeout || setTimeout, clearTimeout:clock.clearTimeout || clearTimeout, URL,
    chrome:{storage:{local:storage('local'),session:storage('session')},runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,onConnect:{addListener(fn){onConnect=fn;}},onMessage:{addListener(fn){listener=fn;}}},
      scripting:{async executeScript(options){injections.push(options); return [];}},
      windows:{async update(id,options){activated.push({windowId:id,...options});}},
      tabs:{async query(){return tabList;},async reload(){},async update(id,options){activated.push({tabId:id,...options});},async create(options){opened.push(options);tabList.push({id:900,windowId:2,...options});},async get(){return {url:'https://scorm.eduone.io.vn/en/learn/test'};},async sendMessage(){},onRemoved:{addListener(){}},onUpdated:{addListener(){}}}}});
  vm.runInContext(fs.readFileSync('extension/background.js','utf8'),context);
  function connect(url='chrome-extension://test-extension/ai.html') {
    let onMessage, onDisconnect;
    const sent = [];
    const port = {name:'lesson-builtin-ai',sender:{url,id:'test-extension'},
      onMessage:{addListener(fn){onMessage=fn;}},onDisconnect:{addListener(fn){onDisconnect=fn;}},
      postMessage(m){sent.push(m);},disconnect(){onDisconnect?.();}};
    onConnect(port);
    return {sent,receive:m=>onMessage?.(m),close:()=>port.disconnect()};
  }
  return {data,levels,injections,opened,activated,tabList,connect,request:(message,sender={tab:{id:7},frameId:1})=>new Promise(resolve=>listener(message,sender,resolve))};
}

test('local START automatically resumes on host readiness without key, second click, or cloud fallback',async()=>{
  let calls=0;const h=setup(()=>calls++);delete h.data.local.apiKey;h.data.local.config.provider='builtin';
  const waiting=await h.request({type:'START',tabId:7},{});
  assert.equal(waiting.needsPreparation,true);assert.equal(waiting.running,false);assert.equal(waiting.error,undefined);
  assert.equal(h.opened.length,1);assert.equal(h.injections.length,0);
  const host=h.connect();host.receive({type:'state',ready:true});
  await new Promise(r=>setImmediate(r));const run=h.data.session['tab:7'];assert.equal(run.running,true);
  const pending=h.request({type:'SOLVE',session:run.session,question});
  await new Promise(r=>setImmediate(r));const m=host.sent.find(m=>m.type==='solve');
  assert.ok(m);assert.equal(JSON.stringify(m).includes('apiKey'),false);
  host.receive({type:'result',id:m.id,result:{answers:[1],reason:'Hai'}});
  const result=await pending;assert.deepEqual([...result.answers],[1]);assert.equal(calls,0);
});

test('repeated and concurrent preparation requests reuse one AI tab without starting lesson scripts',async()=>{
  const h=setup(()=>{throw Error('cloud');});h.data.local.config.provider='builtin';
  await Promise.all([h.request({type:'START',tabId:7},{}),h.request({type:'START',tabId:7},{})]);
  await h.request({type:'START',tabId:7},{});
  assert.equal(h.opened.length,1);assert.equal(h.injections.length,0);
  assert.equal(h.activated.length,0);assert.equal(h.opened[0].active,false);
  assert.equal(h.data.session['tab:7'].running,false);
});

test('popup receives download phase and lesson automatically runs after preparation',async()=>{
  const h=setup(()=>{});h.data.local.config.provider='builtin';
  await h.request({type:'START',tabId:7},{});
  const host=h.connect();host.receive({type:'state',ready:false,phase:'preparing',detail:'Gemini Nano: 50%'});
  let state=await h.request({type:'GET_STATUS',tabId:7},{});
  assert.equal(state.builtin.phase,'preparing');assert.equal(state.builtin.detail,'Gemini Nano: 50%');
  host.receive({type:'state',ready:true,phase:'ready'});
  await new Promise(r=>setImmediate(r));
  state=await h.request({type:'GET_STATUS',tabId:7},{});
  assert.equal(state.builtin.ready,true);assert.equal(state.run.running,true);assert.equal(state.run.needsPreparation,false);
  assert.equal(JSON.stringify(state).includes('test-key-never-real'),false);
});
test('local failure never calls cloud even with a saved API key and changed settings',async()=>{
  let calls=0;const h=setup(()=>calls++);h.data.session['tab:7'].config={...core.defaults,provider:'builtin'};
  const host=h.connect();host.receive({type:'state',ready:true});
  const pending=h.request({type:'SOLVE',session:'s',question});await new Promise(r=>setImmediate(r));
  const m=host.sent.find(m=>m.type==='solve');host.receive({type:'result',id:m.id,error:'Local unavailable'});
  assert.match((await pending).error,/Local unavailable/);assert.equal(calls,0);
});
test('STOP cancels native request and ignores a late local answer',async()=>{
  const h=setup(()=>{throw Error('cloud');});h.data.session['tab:7'].config={...core.defaults,provider:'builtin'};
  const host=h.connect();host.receive({type:'state',ready:true});
  const pending=h.request({type:'SOLVE',session:'s',question});await new Promise(r=>setImmediate(r));
  const m=host.sent.find(m=>m.type==='solve');await h.request({type:'STOP',tabId:7},{});
  host.receive({type:'result',id:m.id,result:{answers:[1]}});
  assert.match((await pending).error,/hủy/);assert.ok(host.sent.some(m=>m.type==='cancel'));assert.equal(h.data.session['tab:7'].running,false);
});
test('local inference timeout cancels host work',async()=>{
  let expire;const h=setup(()=>{}, {setTimeout(fn){expire=fn;return 1;},clearTimeout(){}});
  h.data.session['tab:7'].config={...core.defaults,provider:'builtin'};
  const host=h.connect();host.receive({type:'state',ready:true});
  const pending=h.request({type:'SOLVE',session:'s',question});await new Promise(r=>setImmediate(r));expire();
  assert.match((await pending).error,/120 giây/);assert.ok(host.sent.some(m=>m.type==='cancel'));
});
test('closing local host stops local runs while leaving cloud runs active',async()=>{
  const h=setup(()=>{});h.data.session['tab:7'].config={...core.defaults,provider:'builtin'};
  h.data.session['tab:8']={running:true,config:{provider:'gemini'}};
  const host=h.connect();host.receive({type:'state',ready:true});host.close();await new Promise(r=>setImmediate(r));
  assert.equal(h.data.session['tab:7'].running,false);assert.equal(h.data.session['tab:8'].running,true);
});
test('lesson pages cannot impersonate the local host or open AI pages; options tabs can',async()=>{
  const h=setup(()=>{});h.connect('https://scorm.eduone.io.vn/ai.html').receive({type:'state',ready:true});
  assert.equal((await h.request({type:'BUILTIN_STATUS'},{})).ready,false);
  await h.request({type:'OPEN_BUILTIN',session:'s'});assert.equal(h.opened.length,0);
  await h.request({type:'OPEN_BUILTIN'},{tab:{id:9},url:'chrome-extension://test-extension/options.html'});
  assert.equal(h.opened.length,1);assert.equal(h.opened[0].url,'chrome-extension://test-extension/ai.html');
});

test('START installs MAIN playback bridge before content in all frames and migrates background default', async()=>{
  const h=setup(()=>{throw Error('must not fetch');});
  const run=await h.request({type:'START',tabId:7},{});
  assert.equal(run.running,true);assert.equal(run.config.backgroundPlayback,true);
  assert.equal(h.injections[0].world,'MAIN');assert.deepEqual([...h.injections[0].files],['playback.js']);
  assert.equal(h.injections.every(x=>x.target.allFrames && x.target.tabId===7),true);
  h.data.local.config.backgroundPlayback=false;
  const second=await h.request({type:'START',tabId:7},{});assert.equal(second.config.backgroundPlayback,false);
});
const question = {text:'1 + 1 bằng mấy?',options:['Một','Hai'],multiple:false,history:[]};
test('STOP during model preparation cancels automatic startup even when the host becomes ready later',async()=>{
  const h=setup(()=>{throw Error('cloud');});h.data.local.config.provider='builtin';
  await h.request({type:'START',tabId:7},{});
  await h.request({type:'STOP',tabId:7},{});
  const host=h.connect();host.receive({type:'state',ready:true,phase:'ready'});
  await new Promise(r=>setImmediate(r));
  assert.equal(h.data.session['tab:7'].needsPreparation,false);
  assert.equal(h.data.session['tab:7'].running,false);assert.equal(h.injections.length,0);
});

test('model activation error stays visible and a completed settings download resumes the pending lesson once',async()=>{
  const h=setup(()=>{throw Error('cloud');});h.data.local.config.provider='builtin';
  await h.request({type:'START',tabId:7},{});
  const host=h.connect();host.receive({type:'state',ready:false,phase:'error',detail:'Chrome cần thao tác tải lần đầu.'});
  assert.equal(h.injections.length,0);
  await h.request({type:'ENSURE_BUILTIN'},{});
  assert.ok(host.sent.some(m=>m.type==='prepare'));
  host.receive({type:'state',ready:true,phase:'ready'});
  host.receive({type:'state',ready:true,phase:'ready'});
  await new Promise(r=>setImmediate(r));
  assert.equal(h.data.session['tab:7'].running,true);assert.equal(h.injections.length,2);
});

test('preparing AI from settings alone never starts an unrequested lesson',async()=>{
  const h=setup(()=>{});h.data.session['tab:7']={running:false};
  await h.request({type:'ENSURE_BUILTIN'},{});
  const host=h.connect();host.receive({type:'state',ready:true,phase:'ready'});
  await new Promise(r=>setImmediate(r));
  assert.equal(h.injections.length,0);assert.equal(h.data.session['tab:7'].running,false);
});
test('Gemini REST request uses structured output, API key header and validates answer',async()=>{
  let request;
  const h=setup(async(url,opts)=>{request={url,opts};return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"answers":[2],"reason":"Hai"}'}]}}]})};});
  const result=await h.request({type:'SOLVE',session:'s',question});
  assert.deepEqual([...result.answers],[1]);assert.equal(request.opts.headers['x-goog-api-key'],'test-key-never-real');
  assert.equal(request.url.includes('test-key'),false);
  assert.equal(JSON.parse(request.opts.body).generationConfig.responseMimeType,'application/json');
  assert.equal(h.levels.every(([,level])=>level==='TRUSTED_CONTEXTS'),true);
});
test('content HELLO never receives API key',async()=>{
  const h=setup(()=>{throw Error('must not fetch');});
  const result=await h.request({type:'HELLO'});assert.equal(result.running,true);assert.equal(JSON.stringify(result).includes('test-key'),false);
});
test('inactive or stale session cannot trigger paid API calls',async()=>{
  let called=0;const h=setup(async()=>{called++;});
  await h.request({type:'SOLVE',session:'old',question});h.data.session['tab:7'].running=false;
  await h.request({type:'SOLVE',session:'s',question});assert.equal(called,0);
});
test('429 exposes a helpful error without leaking raw provider errors or credentials',async()=>{
  const h=setup(async()=>({ok:false,status:429}));const r=await h.request({type:'SOLVE',session:'s',question});
  assert.match(r.error,/429/);assert.equal(r.error.includes('test-key'),false);
});
test('malformed model response is rejected',async()=>{
  const h=setup(async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"answers":[3]}'}]}}]})}));
  assert.match((await h.request({type:'SOLVE',session:'s',question})).error,/không hợp lệ/);
});
test('STOP aborts the API request and persists stopped state',async()=>{
  let signal;
  const h=setup(async(url,opts)=>{signal=opts.signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('abort'),{name:'AbortError'}))));});
  const promise=h.request({type:'SOLVE',session:'s',question});
  while(!signal) await new Promise(resolve=>setImmediate(resolve));
  await h.request({type:'STOP',tabId:7},{});const r=await promise;
  assert.equal(signal.aborted,true);assert.equal(h.data.session['tab:7'].running,false);assert.match(r.error,/hủy/);
});
