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
  const listeners=[],connectListeners=[],sent=[],injected=[],opened=[];
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
  return {context,chrome,data,request,host,opened,injected,sent};
}

test('one real merged worker loads both modules and routes action/type to exactly one responder',async()=>{
  const h=setup();
  const canvas=await h.request({action:'GET_AUTO_STATE'});assert.equal(canvas.success,true);
  const scorm=await h.request({type:'GET_STATUS',tabId:7});assert.equal(scorm.provider,'gemini');assert.equal(scorm.error,undefined);
  const run=await h.request({type:'START',tabId:7});assert.equal(run.running,true);assert.equal(h.injected.length,2);
  const canvasStopped=await h.request({action:'SET_AUTO_STATE',data:{enabled:false}},{url:'https://canvas.example/courses/1/quizzes/2/take',tab:{id:9}});
  assert.equal(canvasStopped.success,true);assert.equal(h.data.session['tab:7'].running,true);
});

test('question export is restricted to extension UI and contains no API credentials or login query',async()=>{
  const h=setup(),sender={id:'suite',url:'https://canvas.example/courses/1/quizzes/2/history?token=SECRET',tab:{id:9}};
  const saved=await h.request({action:'BANK_RECORD',data:{context:{courseTitle:'Toán',exerciseTitle:'Ôn tập'},items:[{question:{text:'1 + 1?',options:['1','2']},kind:'graded',selected_indices:[1],correct:true}]}},sender);
  assert.equal(saved.success,true);
  const denied=await h.request({action:'BANK_EXPORT'},sender);assert.equal(denied.success,false);
  const exported=await h.request({action:'BANK_EXPORT'});assert.equal(exported.success,true);assert.equal(exported.data.entries.length,1);
  assert.ok(!/SECRET|scorm-key|canvas-key|apiKey/.test(JSON.stringify(exported)));
  await h.request({action:'CLEAR_ANSWER_CACHE'});await h.request({action:'CLEAR_GRADED_ANSWERS'});
  assert.equal((await h.request({action:'BANK_EXPORT'})).data.entries.length,1);
});

test('shared AI settings update both modules while cache deletion preserves shared credentials',async()=>{
  const h=setup();const canvas=vm.runInContext('CanvasCompat.create(false)',h.context);
  assert.equal((await canvas.storage.local.get({apiKey:'',autoDelay:3})).apiKey,'canvas-key');
  await h.request({action:'SUITE_SETTINGS',data:{apiKey:'new-canvas-key',engine:'chrome_ai',model:'gemini-2.5-flash'}});
  assert.equal(h.data.local.apiKey,'new-canvas-key');assert.equal(h.data.local['canvas:apiKey'],'new-canvas-key');
  h.data.local['canvas:geminiAnswerCacheV2']={old:{}};
  const cleared=await h.request({action:'CLEAR_ANSWER_CACHE'});assert.equal(cleared.success,true);
  assert.equal(h.data.local.apiKey,'new-canvas-key');assert.equal(h.data.local['canvas:apiKey'],'new-canvas-key');
  assert.equal(h.data.local.config.provider,'builtin');
});

test('Canvas content can read its settings with trusted storage enabled but cannot read SCORM data',async()=>{
  const h=setup();const canvas=vm.runInContext('CanvasCompat.create(true)',h.context);
  const config=await new Promise(resolve=>canvas.storage.local.get({apiKey:'',autoDelay:3},resolve));
  assert.equal(config.apiKey,'canvas-key');assert.equal(config.autoDelay,3);
  await assert.rejects(canvas.storage.local.get('config'),/không hợp lệ/);
  const bad=await h.request({action:'CANVAS_STORAGE',data:{area:'local',method:'get',value:['apiKey']}},{url:'https://unrelated.example/',tab:{id:9}});
  assert.equal(bad.success,false);
});

test('Canvas reconnect injects only Canvas assets and its storage adapter',async()=>{
  const h=setup();const canvas=vm.runInContext('CanvasCompat.create(false)',h.context);
  await canvas.scripting.executeScript({target:{tabId:9},files:['content.js']});
  await canvas.scripting.insertCSS({target:{tabId:9},files:['styles.css']});
  assert.deepEqual([...h.injected[0].files],['archive-content.js','canvas-compat.js','canvas/content.js','canvas-controls.js']);
  assert.deepEqual([...h.injected[1].files],['canvas/styles.css','canvas-compact.css']);
});

test('Canvas reconnect from full settings targets the recently opened lesson tab',async()=>{
  const h=setup();h.data.session['suite:sourceTab']={id:9,at:Date.now()};
  h.context.document={};h.context.parent={document:{body:{classList:{contains:name=>name==='suite-options'}}}};
  h.chrome.tabs.get=async id=>({id,url:'https://canvas.example/courses/1/quizzes/2/take'});
  const canvas=vm.runInContext('CanvasCompat.create(false)',h.context);
  assert.equal((await canvas.tabs.query({active:true,currentWindow:true}))[0].id,9);
  h.data.session['suite:sourceTab'].at-=11*60*1000;
  assert.equal((await canvas.tabs.query({active:true,currentWindow:true})).length,0);
});

test('Canvas Chrome AI uses the shared document while keeping its exact prompt, schema and answer validation',async()=>{
  const h=setup();const host=h.host();host.receive({type:'state',ready:true});
  const sender={url:'https://canvas.example/courses/1/quizzes/2/take',tab:{id:9},frameId:0};
  const promise=h.request({action:'SOLVE_CHROME_AI',data:{requestId:'test-local',question:{id:'q1',questionText:'2 + 2?',options:['3','4'],questionType:'multiple_choice_question'}}},sender);
  const job=await waitFor(()=>host.out.find(m=>m.type==='canvas-solve'));assert.match(job.prompt,/option_1/);assert.ok(job.schema);
  host.receive({type:'result',id:job.id,result:{id:'q1',answerable:true,selected_option_ids:['option_1'],explanation:'Two plus two is four.'}});
  const answer=await promise;assert.equal(answer.success,true);assert.deepEqual([...answer.data.selected_indices],[1]);
  assert.equal(h.data.session['tab:7'],undefined);
});

test('Canvas functional source matches its original hashes, also on a fresh checkout',()=>{
  const manifest=JSON.parse(fs.readFileSync('extension/canvas/upstream-hashes.json','utf8'));
  for(const file of ['content.js','background.js','quiz-learning.js','chrome-ai.js']) {
    const bundled=fs.readFileSync(path.join(root,'canvas',file),'utf8').replace(/\r\n?/g,'\n');
    const original=file==='chrome-ai.js'?bundled:bundled.slice(bundled.indexOf('\n')+1,bundled.lastIndexOf('\n})(CanvasCompat.create('));
    assert.equal(createHash('sha256').update(original).digest('hex'),manifest.normalizedSha256[file],file);
  }
});

test('merged manifest has one worker/popup and SCORM is excluded from Canvas content injection',()=>{
  const manifest=JSON.parse(fs.readFileSync('extension/manifest.json','utf8'));
  assert.equal(manifest.background.service_worker,'suite-background.js');assert.equal(manifest.action.default_popup,'suite-popup.html');
  assert.equal(manifest.options_page,undefined);
  const canvas=manifest.content_scripts.find(item=>item.js.includes('canvas/content.js'));
  assert.ok(canvas.exclude_matches.includes('https://scorm.eduone.io.vn/*'));
  for(const item of manifest.content_scripts)for(const file of [...item.js,...item.css||[]])assert.ok(fs.existsSync(path.join(root,file)),file);
});

test('upgrade uses Canvas AI choice once, preserves old key and forces all automatic options on',async()=>{
  const h=setup();h.data.local['canvas:aiEngine']='chrome_ai';h.data.local.config.backgroundPlayback=false;
  h.data.local['canvas:autoClickAnswer']=false;h.data.local['canvas:autoNextQuestion']=false;
  const result=await h.request({action:'SUITE_SETTINGS'});
  assert.equal(result.data.engine,'chrome_ai');assert.equal(h.data.local.config.provider,'builtin');
  assert.equal(h.data.local.apiKey,'canvas-key');assert.equal(h.data.local['suite:previousScormKey'],'scorm-key');
  assert.equal(h.data.local.config.backgroundPlayback,true);assert.equal(h.data.local['canvas:autoClickAnswer'],true);
  assert.equal(h.data.local['canvas:autoNextQuestion'],true);assert.equal(h.data.local['canvas:answerReviewVersion'],2);
  assert.equal(JSON.stringify(result).includes('canvas-key'),false);
});

test('blank shared key preserves saved key, switching model applies to both modules after reopening',async()=>{
  const h=setup();await h.request({action:'SUITE_SETTINGS'});
  await h.request({action:'SUITE_SETTINGS',data:{model:'gemini-3.7-flash',engine:'gemini_api',apiKey:''}});
  const result=await h.request({action:'SUITE_SETTINGS'});
  assert.equal(result.data.model,'gemini-3.7-flash');assert.equal(h.data.local.config.model,'gemini-3.7-flash');
  assert.equal(h.data.local['canvas:aiModel'],'gemini-3.7-flash');assert.equal(h.data.local.apiKey,'canvas-key');
});

test('merged Canvas content reads isolated settings, solves through merged worker and selects the correct DOM radio',async()=>{
  const h=setup();Object.assign(h.data.local,{'canvas:aiEngine':'chrome_ai','canvas:autoClickAnswer':true,'canvas:autoNextQuestion':false,'canvas:answerReviewVersion':2});
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
  assert.equal(h.data.local.apiKey,'canvas-key');assert.equal(w.document.querySelectorAll('.canvas-ai-badge').length,1);
  w.__canvasAiCleanup();w.close();
});
