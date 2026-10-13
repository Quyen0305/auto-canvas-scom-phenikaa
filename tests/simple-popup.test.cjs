const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function setup({canvas=false,engine='gemini_api',prepare=async()=>{},keyReady=false}={}){
  const dom=new JSDOM(fs.readFileSync('extension/suite-popup.html','utf8'),{url:'https://extension.test/suite-popup.html',runScripts:'outside-only'});
  const w=dom.window,messages=[],commands=[],ai={engine,model:'gemini-2.5-flash',keySaved:keyReady};let preparations=0;
  w.LessonBuiltin={Engine:class{prepare(){preparations++;return prepare();}destroy(){}}};
  w.chrome={runtime:{sendMessage:async message=>{
    messages.push(message);
    if(message.action==='SUITE_SETTINGS'){Object.assign(ai,message.data);if(message.data?.apiKey)ai.keySaved=true;return {success:true,data:{...ai}};}
    if(message.action==='SUITE_START'){Object.assign(ai,message.data);ai.keySaved=true;commands.push(message.command);return {success:true,data:{running:true,text:'Đang bắt đầu.'}};}
    if(message.type==='GET_STATUS')return {frames:[],builtin:{ready:false}};
    return {ok:true,message:'Đang bắt đầu.'};
  }},tabs:{query:async()=>[{id:7,url:canvas?'https://canvas.example/courses/1/quizzes/2/take':'https://scorm.eduone.io.vn/en/learn/demo'}],sendMessage:async(id,message)=>{commands.push(message.command);return {text:'Sẵn sàng.'};}}};
  w.eval(fs.readFileSync('extension/suite.js','utf8'));await flush();
  if(engine!=='chrome_ai')w.document.getElementById('apiKey').value='TEST_RAM_KEY';
  return {w,ai,messages,commands,el:id=>w.document.getElementById(id),get preparations(){return preparations;},close(){w.dispatchEvent(new w.Event('pagehide'));w.close();}};
}
test('one model selector with no settings page, duplicate panels, checkboxes or extra setup buttons',async()=>{
  const h=await setup();assert.equal(h.w.document.querySelectorAll('select').length,1);
  assert.equal(h.w.document.querySelectorAll('iframe,input[type=checkbox],a').length,0);
  assert.equal(h.el('start').disabled,false);assert.equal(h.el('open-settings'),null);
  h.el('tab-canvas').click();assert.equal(h.el('panel-canvas').hidden,false);
  assert.equal(h.el('aiModel').value,'gemini-2.5-flash');h.close();
});
test('typing receives the key into temporary RAM before closing the popup',async()=>{
  const h=await setup();h.el('apiKey').value='test-only';h.el('apiKey').dispatchEvent(new h.w.Event('input'));await flush();
  assert.equal(h.ai.apiKey,'test-only');assert.match(h.el('aiStatus').textContent,/RAM/);
  h.close();assert.equal(h.ai.keySaved,true);
});
test('reopening with a RAM key permits starting from an empty key input',async()=>{
  const h=await setup({keyReady:true});h.el('apiKey').value='';h.el('start').click();await flush();
  assert.ok(h.messages.some(m=>m.action==='SUITE_START'));h.close();
});
test('blank input without a RAM key prevents starting',async()=>{
  const h=await setup();h.el('apiKey').value='';h.el('start').click();await flush();
  assert.equal(h.messages.some(m=>m.action==='SUITE_START'),false);assert.match(h.el('status').textContent,/Nhập API key/);h.close();
});
test('closing immediately after Start cannot cancel the already dispatched worker request',async()=>{
  const h=await setup();h.el('start').click();h.w.dispatchEvent(new h.w.Event('pagehide'));await flush();
  assert.ok(h.messages.some(m=>m.action==='SUITE_START'));h.close();
});
test('a cancelled Start response arriving after Stop cannot report a restarted run',async()=>{
  const h=await setup({keyReady:true});let release;
  try {
    const send=h.w.chrome.runtime.sendMessage;
    h.w.chrome.runtime.sendMessage=m=>m.action==='SUITE_START'?new Promise(resolve=>{release=resolve;}):send(m);
    h.el('start').click();await flush();h.el('stop').click();await flush();
    release({success:true,data:{cancelled:true}});await flush();
    assert.match(h.el('status').textContent,/Đã dừng/);
    assert.match(h.el('apiKey').placeholder,/sẵn sàng/);
  } finally {h.close();}
});
test('popup has no archive/export controls and clears the input on close',async()=>{
  const h=await setup();assert.equal(h.el('export-questions'),null);assert.equal(h.el('clear-cache'),null);
  h.w.dispatchEvent(new h.w.Event('pagehide'));assert.equal(h.el('apiKey').value,'');h.close();
});
test('selecting Chrome AI starts native setup in the selection gesture with no extra button',async()=>{
  const h=await setup();h.el('aiModel').value='chrome_ai';h.el('aiModel').dispatchEvent(new h.w.Event('change'));
  assert.equal(h.preparations,1);await flush();assert.equal(h.ai.engine,'chrome_ai');assert.equal(h.el('keySection').hidden,true);
  assert.ok(h.messages.some(m=>m.type==='ENSURE_BUILTIN'));h.close();
});
test('Canvas auto and target controls save shared config and dispatch existing modes',async()=>{
  const h=await setup({canvas:true});assert.equal(h.el('panel-canvas').hidden,false);
  h.el('canvas-auto').click();await flush();assert.ok(h.commands.includes('auto'));
  h.el('apiKey').value='TEST_RAM_KEY_2';h.el('canvas-target').click();await flush();assert.ok(h.commands.includes('target'));
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
  assert.ok(h.messages.some(m=>m.action==='SUITE_START'));assert.ok(h.messages.some(m=>m.type==='STOP'));h.close();
});

test('SCORM popup waits for playback setup before starting native AI preparation',async()=>{
  const h=await setup({engine:'chrome_ai'});let release;
  const original=h.w.chrome.runtime.sendMessage;
  h.w.chrome.runtime.sendMessage=m=>m.type==='START'?new Promise(resolve=>release=resolve):original(m);
  h.el('start').click();await flush();assert.ok(release);assert.equal(h.preparations,0);
  release({playbackOnly:true,needsPreparation:true});await flush();await flush();
  assert.equal(h.preparations,1);h.close();
});

test('Stop before SCORM playback setup completes prevents a late popup AI download',async()=>{
  const h=await setup({engine:'chrome_ai'});let release;
  const original=h.w.chrome.runtime.sendMessage;
  h.w.chrome.runtime.sendMessage=m=>m.type==='START'?new Promise(resolve=>release=resolve):original(m);
  h.el('start').click();await flush();h.el('stop').click();await flush();
  release({playbackOnly:true,needsPreparation:true});await flush();
  assert.equal(h.preparations,0);assert.ok(h.messages.some(m=>m.type==='STOP'));h.close();
});

test('selecting a paired provider clears old key drafts and shows its required fields',async()=>{
  const h=await setup();try {
    h.el('aiModel').value='groq_api|openai/gpt-oss-120b';h.el('aiModel').dispatchEvent(new h.w.Event('change'));await flush();
    assert.equal(h.ai.engine,'groq_api');assert.equal(h.el('apiKey').value,'');assert.equal(h.el('searchKeySection').hidden,false);
    h.el('apiKey').value='GROQ_KEY';h.el('searchKey').value='TAVILY_KEY';h.el('searchKey').dispatchEvent(new h.w.Event('input'));await flush();
    h.el('start').click();await flush();const start=h.messages.find(m=>m.action==='SUITE_START');
    assert.equal(start.data.engine,'groq_api');assert.equal(start.data.model,'openai/gpt-oss-120b');assert.equal(start.data.searchKey,'TAVILY_KEY');
    h.w.dispatchEvent(new h.w.Event('pagehide'));assert.equal(h.el('searchKey').value,'');
  }finally{h.close();}
});

test('Google Search needs only Gemini key and Cloudflare additionally needs an Account ID',async()=>{
  const h=await setup();try {
    h.el('aiModel').value='gemini_search|gemini-2.5-flash';h.el('aiModel').dispatchEvent(new h.w.Event('change'));await flush();
    assert.equal(h.el('searchKeySection').hidden,true);
    h.el('aiModel').value='cloudflare_api|@cf/openai/gpt-oss-120b';h.el('aiModel').dispatchEvent(new h.w.Event('change'));await flush();
    assert.equal(h.el('accountSection').hidden,false);assert.equal(h.el('searchKeySection').hidden,false);
  }finally{h.close();}
});
