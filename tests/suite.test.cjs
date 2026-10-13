const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {webcrypto,createHash}=require('node:crypto');
const {JSDOM}=require('jsdom');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function waitFor(check){
  const deadline=Date.now()+3000;
  while(!check()){if(Date.now()>deadline)throw Error('Timed out waiting for integration job');await new Promise(resolve=>setTimeout(resolve,5));}
  return check();
}
const root=path.resolve('extension');
function setup() {
  const data={local:{apiKey:'scorm-key',config:{provider:'gemini'},'canvas:apiKey':'canvas-key','canvas:aiModel':'gemini-2.5-flash'},session:{}};
  const listeners=[],connectListeners=[],sent=[],injected=[],opened=[],offscreen=[],contexts=[];
  const store=area=>({
    async setAccessLevel(){},async get(value){
      const keys=value==null?Object.keys(data[area]):typeof value==='string'?[value]:Array.isArray(value)?value:Object.keys(value);
      const out=value && !Array.isArray(value) && typeof value==='object'?{...value}:{};
      for(const key of keys)if(key in data[area])out[key]=structuredClone(data[area][key]);return out;
    },async set(values){Object.assign(data[area],structuredClone(values));},async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete data[area][key];}
  });
  const chrome={storage:{local:store('local'),session:store('session')},runtime:{id:'suite',getURL:p=>'chrome-extension://suite/'+p,onMessage:{addListener:fn=>listeners.push(fn)},onConnect:{addListener:fn=>connectListeners.push(fn)}},
    tabs:{query:async()=>[],create:async value=>{opened.push(value);},get:async()=>({url:'https://scorm.eduone.io.vn/en/learn/test'}),sendMessage:async(id,message)=>sent.push(message),onRemoved:{addListener(){}},onUpdated:{addListener(){}}},
    scripting:{executeScript:async value=>{injected.push(value);return [];},insertCSS:async value=>{injected.push(value);}}};
  const context=vm.createContext({chrome,URL,DOMException,AbortController,setTimeout,clearTimeout,TextEncoder,crypto:webcrypto,console,
    fetch:async()=>{throw new Error('No network in integration tests');}});
  chrome.runtime.getContexts=async()=>contexts;
  chrome.offscreen={createDocument:async value=>{offscreen.push(value);contexts.push({documentUrl:chrome.runtime.getURL(value.url)});}};
  context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file}));
  context.importScripts('suite-background.js');
  function request(message,sender={url:'chrome-extension://suite/suite-popup.html'}) {
    return new Promise((resolve,reject)=>{
      let claimed=0,replies=0;
      const reply=value=>{replies++;if(replies>1)reject(Error('Multiple modules replied'));else resolve(value);};
      for(const listener of listeners)if(listener(message,sender,reply)===true)claimed++;
      if(claimed!==1)reject(Error('Expected one message owner; got '+claimed));
    });
  }
  chrome.runtime.sendMessage=(message,callback)=>{
    const p=request(message,{url:'https://canvas.example/courses/1/quizzes/2/take',tab:{id:9},frameId:0});
    if(callback){p.then(callback);return;}return p;
  };
  function host() {
    const handlers=[],disconnect=[],out=[];
    const port={name:'lesson-builtin-ai',sender:{id:'suite',url:'chrome-extension://suite/ai.html'},postMessage:m=>out.push(m),disconnect:()=>disconnect.forEach(fn=>fn()),onMessage:{addListener:fn=>handlers.push(fn)},onDisconnect:{addListener:fn=>disconnect.push(fn)}};
    connectListeners.forEach(fn=>fn(port));return {out,receive:m=>handlers.forEach(fn=>fn(m))};
  }
  return {context,chrome,data,request,host,opened,offscreen,injected,sent};
}

test('merged worker routes messages once and keeps run state in RAM',async()=>{
  const h=setup();await h.request({action:'SUITE_SETTINGS',data:{tabId:7,apiKey:'TEST_RAM_KEY'}});
  assert.equal((await h.request({action:'GET_AUTO_STATE'})).success,true);
  const run=await h.request({type:'START',tabId:7});assert.equal(run.running,true);assert.equal(h.injected.length,2);
  const stored=await h.context.SuiteStorage.session.get('tab:7');assert.equal(stored['tab:7'].running,true);
  assert.equal(h.data.session['tab:7'],undefined);assert.equal(h.data.local.apiKey,undefined);
});
test('archive messages cannot create new question or answer records',async()=>{
  const h=setup();
  for(const action of ['BANK_RECORD','BANK_EXPORT','BANK_WARNING'])assert.equal((await h.request({action})).success,false);
  assert.equal(Object.keys(h.data.local).some(k=>k.startsWith('suite:question:')),false);
});
test('shared key is RAM only and Canvas cannot read SCORM settings',async()=>{
  const h=setup();await h.request({action:'SUITE_SETTINGS',data:{tabId:9,apiKey:'TEST_RAM_KEY',engine:'gemini_api',model:'gemini-2.5-flash'}});
  const canvas=vm.runInContext('CanvasCompat.create(true)',h.context);
  const config=await new Promise(resolve=>canvas.storage.local.get({apiKey:'',autoDelay:3},resolve));
  assert.equal(config.apiKey,'TEST_RAM_KEY');assert.equal(config.autoDelay,3);
  await assert.rejects(canvas.storage.local.get('config'),/không hợp lệ/);
  const bad=await h.request({action:'CANVAS_STORAGE',data:{area:'local',method:'get',value:['apiKey']}},{url:'https://unrelated.example/',tab:{id:9}});
  assert.equal(bad.success,false);assert.equal(h.data.local.apiKey,undefined);
});
test('Canvas reconnect injects only active Canvas assets',async()=>{
  const h=setup(),canvas=vm.runInContext('CanvasCompat.create(false)',h.context);
  await canvas.scripting.executeScript({target:{tabId:9},files:['content.js']});
  assert.deepEqual([...h.injected[0].files],['sources.js','canvas-compat.js','canvas/content.js','canvas-controls.js']);
});
test('shared Chrome AI still uses one hidden document for Canvas and SCORM',async()=>{
  const h=setup();await h.request({action:'SUITE_SETTINGS',data:{engine:'chrome_ai',model:'gemini-2.5-flash'}});
  await h.request({type:'START',tabId:7});const host=h.host();host.receive({type:'state',ready:true});await flush();
  const promise=vm.runInContext('requestCanvasAI("question",new AbortController().signal,{})',h.context);
  const job=await waitFor(()=>host.out.find(m=>m.type==='canvas-solve'));
  host.receive({type:'result',id:job.id,result:{answerable:true}});await promise;
  assert.equal(h.offscreen.length,1);assert.equal(h.opened.length,0);
});
test('manifest supports API mode from Chrome 111 and declares only existing injected assets',()=>{
  const manifest=JSON.parse(fs.readFileSync('extension/manifest.json','utf8'));
  assert.equal(manifest.minimum_chrome_version,'111');assert.equal(manifest.background.service_worker,'suite-background.js');
  assert.equal(manifest.permissions.includes('unlimitedStorage'),false);
  for(const item of manifest.content_scripts)for(const file of [...item.js,...item.css||[]])assert.ok(fs.existsSync(path.join(root,file)),file);
});

test('merged Canvas content reads isolated settings, solves through merged worker and selects the correct DOM radio',async()=>{
  const h=setup();await h.request({action:'SUITE_SETTINGS',data:{engine:'chrome_ai',model:'gemini-2.5-flash'}});
  const host=h.host();host.receive({type:'state',ready:true});
  const dom=new JSDOM('<form id="submit_quiz_form"><div id="questions"><div class="display_question question" id="question_1"><div class="question_text">2 + 2?</div><div class="answers"><fieldset>'+['3','4'].map((text,i)=>`<div class="answer"><label class="answer_row"><span class="answer_input"><input type="radio" class="question_input" name="question_1" id="answer_${i}" value="${i}"></span><div class="answer_label">${text}</div></label></div>`).join('')+'</fieldset></div></div></div></form>',{url:'https://canvas.example/courses/1/quizzes/2/take',runScripts:'outside-only'});
  const w=dom.window;w.chrome=h.chrome;
  Object.defineProperty(w.HTMLElement.prototype,'offsetParent',{get(){return w.document.body;}});
  await new Promise(resolve=>w.document.addEventListener('DOMContentLoaded',resolve,{once:true}));
  w.eval(fs.readFileSync('extension/canvas-compat.js','utf8'));w.eval(fs.readFileSync('extension/canvas/content.js','utf8'));
  await flush();w.document.getElementById('canvas-ai-solve-current').click();await flush();await flush();
  const job=await waitFor(()=>host.out.find(m=>m.type==='canvas-solve'));
  // Use the exact id supplied by the original Canvas content parser.
  const question=JSON.parse(job.prompt.slice(job.prompt.indexOf('Question data: ')+15));
  host.receive({type:'result',id:job.id,result:{id:question.id,answerable:true,selected_option_ids:['option_1'],explanation:'Two plus two equals four.'}});
  await waitFor(()=>w.document.getElementById('answer_1').checked);assert.equal(w.document.getElementById('answer_1').checked,true);
  assert.equal(h.data.local.apiKey,undefined);assert.equal(w.document.querySelectorAll('.canvas-ai-badge').length,1);
  w.__canvasAiCleanup();w.close();
});
