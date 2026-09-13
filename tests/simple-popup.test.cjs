const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function setup({canvas=false,engine='gemini_api',prepare=async()=>{}}={}){
  const dom=new JSDOM(fs.readFileSync('extension/suite-popup.html','utf8'),{url:'https://extension.test/suite-popup.html',runScripts:'outside-only'});
  const w=dom.window,messages=[],commands=[],ai={engine,model:'gemini-2.5-flash',keySaved:true};let preparations=0;
  w.LessonBuiltin={Engine:class{prepare(){preparations++;return prepare();}destroy(){}}};
  w.chrome={runtime:{sendMessage:async message=>{
    messages.push(message);
    if(message.action==='SUITE_SETTINGS'){Object.assign(ai,message.data);return {success:true,data:{...ai}};}
    if(message.type==='GET_STATUS')return {frames:[],builtin:{ready:false}};
    return {ok:true,message:'Đang bắt đầu.'};
  }},tabs:{query:async()=>[{id:7,url:canvas?'https://canvas.example/courses/1/quizzes/2/take':'https://scorm.eduone.io.vn/en/learn/demo'}],sendMessage:async(id,message)=>{commands.push(message.command);return {text:'Sẵn sàng.'};}}};
  w.eval(fs.readFileSync('extension/suite.js','utf8'));await flush();
  return {w,ai,messages,commands,el:id=>w.document.getElementById(id),get preparations(){return preparations;},close(){w.dispatchEvent(new w.Event('pagehide'));w.close();}};
}
test('one model selector with no settings page, duplicate panels, checkboxes or extra setup buttons',async()=>{
  const h=await setup();assert.equal(h.w.document.querySelectorAll('select').length,1);
  assert.equal(h.w.document.querySelectorAll('iframe,input[type=checkbox],a').length,0);
  assert.equal(h.el('start').disabled,false);assert.equal(h.el('open-settings'),null);
  h.el('tab-canvas').click();assert.equal(h.el('panel-canvas').hidden,false);
  assert.equal(h.el('aiModel').value,'gemini-2.5-flash');h.close();
});
test('model and API key save automatically for both modules without showing stored key',async()=>{
  const h=await setup();assert.equal(h.el('apiKey').value,'');assert.match(h.el('apiKey').placeholder,/Đã lưu/);
  h.el('aiModel').value='gemini-3.7-flash';h.el('aiModel').dispatchEvent(new h.w.Event('change'));await flush();
  assert.equal(h.ai.model,'gemini-3.7-flash');
  h.el('apiKey').value='test-only';h.el('apiKey').dispatchEvent(new h.w.Event('change'));await flush();
  assert.equal(h.ai.apiKey,'test-only');assert.equal(h.el('apiKey').value,'');h.close();
});
test('selecting Chrome AI starts native setup in the selection gesture with no extra button',async()=>{
  const h=await setup();h.el('aiModel').value='chrome_ai';h.el('aiModel').dispatchEvent(new h.w.Event('change'));
  assert.equal(h.preparations,1);await flush();assert.equal(h.ai.engine,'chrome_ai');assert.equal(h.el('keySection').hidden,true);
  assert.ok(h.messages.some(m=>m.type==='ENSURE_BUILTIN'));h.close();
});
test('Canvas auto and target controls save shared config and dispatch existing modes',async()=>{
  const h=await setup({canvas:true});assert.equal(h.el('panel-canvas').hidden,false);
  h.el('canvas-auto').click();await flush();assert.ok(h.commands.includes('auto'));
  h.el('canvas-target').click();await flush();assert.ok(h.commands.includes('target'));
  h.el('canvas-stop').click();await flush();assert.ok(h.commands.includes('stop'));h.close();
});
test('Stop while preparing AI prevents a late Canvas automatic start',async()=>{
  let finish;const h=await setup({canvas:true,engine:'chrome_ai',prepare:()=>new Promise(resolve=>finish=resolve)});
  h.el('canvas-auto').click();await flush();assert.equal(h.commands.includes('auto'),false);
  h.el('canvas-stop').click();await flush();finish();await flush();
  assert.equal(h.commands.includes('auto'),false);assert.equal(h.commands.includes('stop'),true);h.close();
});
test('SCORM Start and Stop remain available with the shared model selector',async()=>{
  const h=await setup();h.el('start').click();await flush();h.el('stop').click();await flush();
  assert.ok(h.messages.some(m=>m.type==='START'));assert.ok(h.messages.some(m=>m.type==='STOP'));h.close();
});

test('one export button flushes open Canvas pages and downloads the grouped archive without starting a solver',async()=>{
  const h=await setup({canvas:true}),injected=[],downloads=[];
  h.w.chrome.scripting={executeScript:async args=>injected.push(args)};
  const originalSend=h.w.chrome.runtime.sendMessage;
  h.w.chrome.runtime.sendMessage=async m=>{assert.notEqual(m.action,'BANK_EXPORT');return originalSend(m);};
  h.w.QuestionBank={list:async()=>({entries:[{test:true}],warning:''})};
  h.w.chrome.tabs.sendMessage=async(id,m)=>{h.commands.push(m.action);return {success:true};};
  h.w.BankExport={build:entries=>{assert.equal(entries.length,1);return {bytes:new Uint8Array([80,75]),questions:2,groups:1,verified:1};}};
  h.w.URL.createObjectURL=()=> 'blob:test';h.w.URL.revokeObjectURL=()=>{};
  h.w.HTMLAnchorElement.prototype.click=function(){downloads.push(this.download);};
  h.el('export-questions').click();await flush();await flush();
  assert.ok(h.commands.includes('BANK_FLUSH'));assert.equal(injected[0].files[0],'archive-content.js');
  assert.equal(downloads.length,1);assert.match(downloads[0],/\.zip$/);assert.match(h.el('export-status').textContent,/2 câu đã chấm đúng \/ 1 bài tập/);
  assert.equal(h.messages.some(m=>m.type==='START'),false);h.close();
});

test('export reads real local archive when an older background would return no BANK_EXPORT response',async()=>{
  const h=await setup(),downloads=[];
  const entry={courseId:'course-1',courseTitle:'Môn học',scope:'quiz-1',exerciseTitle:'Ôn tập',firstSeen:1,
    question:{text:'1 + 1?',options:['Một','Hai'],multiple:false},events:[{kind:'graded',correct:true,answers:['Hai'],at:1}]};
  h.w.chrome.storage={local:{get:async()=>({'suite:question:test':entry,apiKey:'PRIVATE_API_KEY','canvas:apiKey':'PRIVATE_API_KEY'})}};
  const send=h.w.chrome.runtime.sendMessage;
  h.w.chrome.runtime.sendMessage=async m=>m.action==='BANK_EXPORT'?undefined:send(m);
  h.w.TextEncoder=TextEncoder;
  for(const name of ['question-bank.js','xlsx-export.js','bank-export.js'])h.w.eval(fs.readFileSync('extension/'+name,'utf8'));
  h.w.URL.createObjectURL=()=> 'blob:test';h.w.URL.revokeObjectURL=()=>{};
  h.w.HTMLAnchorElement.prototype.click=function(){downloads.push(this.download);};
  h.el('export-questions').click();await flush();await flush();
  assert.equal(downloads.length,1);assert.match(h.el('export-status').textContent,/Đã xuất 1 câu đã chấm đúng/);
  assert.ok(!h.el('export-status').textContent.includes('PRIVATE'));h.close();
});

test('an empty archive plus a stale Canvas collector explains reload instead of reporting a generic read error',async()=>{
  const h=await setup({canvas:true});
  h.w.chrome.scripting={executeScript:async()=>{}};
  h.w.chrome.tabs.sendMessage=async()=>undefined;
  h.w.QuestionBank={list:async()=>({entries:[],warning:''})};
  h.el('export-questions').click();await flush();await flush();
  assert.match(h.el('export-status').textContent,/Tải lại tiện ích tại chrome:\/\/extensions, F5/);
  assert.equal(h.el('export-questions').disabled,false);h.close();
});
