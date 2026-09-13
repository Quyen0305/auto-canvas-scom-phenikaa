const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const flush = () => new Promise(r=>setImmediate(r));
function setup(failure, standalone=false) {
  const dom = new JSDOM(fs.readFileSync('extension/ai.html','utf8'),{url:'https://extension.test/ai.html',runScripts:'outside-only'});
  const w = dom.window, sent = [];let message, disconnect, signal, finish, instance, connections=0;
  if(!standalone)Object.defineProperty(w,'parent',{value:{}});
  w.LessonBuiltin = {Engine:class {
    constructor(){instance=this;this.ready=false;}
    async availability(){return {model:'available',input:'downloadable',output:'downloadable'};}
    async prepare(){if(failure)throw failure;this.ready=true;}
    async solve(q,s){signal=s;return new Promise((resolve,reject)=>{finish=resolve;s.addEventListener('abort',()=>reject(s.reason));});}
    destroy(){this.ready=false;}
  }};
  const port={postMessage:m=>sent.push(m),onMessage:{addListener:fn=>message=fn},onDisconnect:{addListener:fn=>disconnect=fn},disconnect:()=>disconnect?.()};
  w.chrome={runtime:{connect:()=>{connections++;return port;}}};
  w.eval(fs.readFileSync('extension/ai-host.js','utf8'));
  return {w,sent,instance,disconnect:()=>disconnect(),get connections(){return connections;},receive:m=>message(m),get signal(){return signal;},finish:r=>finish(r),close(){w.dispatchEvent(new w.Event('pagehide'));w.close();}};
}

test('legacy standalone AI page does not create a competing engine or runtime port',()=>{
  const h=setup(undefined,true);assert.equal(h.instance,undefined);assert.equal(h.connections,0);h.close();
});

test('offscreen reconnect restores the existing engine without duplicate live ports',async()=>{
  const h=setup();await flush();const engine=h.instance;
  h.w.LessonAIHostReconnect();assert.equal(h.connections,1);
  h.disconnect();h.w.LessonAIHostReconnect();await flush();
  assert.equal(h.connections,2);assert.equal(h.instance,engine);assert.equal(h.sent.at(-1).ready,true);
  h.close();h.w.LessonAIHostReconnect();assert.equal(h.connections,2);
});

test('offscreen wrapper scripts only its local iframe and accepts worker reconnect messages',()=>{
  const dom=new JSDOM(fs.readFileSync('extension/ai-offscreen.html','utf8'),{url:'https://extension.test/ai-offscreen.html',runScripts:'outside-only'});
  const w=dom.window;let listener,calls=0,replies=0;
  w.chrome={runtime:{id:'extension',onMessage:{addListener:fn=>listener=fn}}};
  w.eval(fs.readFileSync('extension/ai-offscreen.js','utf8'));
  const frame=w.document.querySelector('iframe');assert.equal(frame.src,'https://extension.test/ai.html');
  frame.contentWindow.LessonAIHostReconnect=()=>calls++;
  const message={target:'lesson-ai-offscreen',command:'reconnect'};
  listener(message,{id:'other'},()=>replies++);
  listener(message,{id:'extension',tab:{id:7}},()=>replies++);
  listener({type:'START'},{id:'extension'},()=>replies++);
  assert.equal(calls,0);assert.equal(replies,0);
  listener(message,{id:'extension'},()=>replies++);
  assert.equal(calls,1);assert.equal(replies,1);w.close();
});
test('host initializes without a click, returns local result, then releases resources on close',async()=>{
  const h=setup();await flush();assert.match(h.w.document.querySelector('#capability').textContent,/cần tải/);
  assert.equal(h.w.document.querySelector('#prepare'),null);assert.equal(h.sent.at(-1).ready,true);
  const pending=h.receive({type:'solve',id:'a',question:{}});h.finish({answers:[1],reason:'Hai'});await pending;
  assert.equal(h.sent.find(m=>m.type==='result').result.reason,'Hai');
  h.close();assert.equal(h.instance.ready,false);
});

test('native preparation failure is reported to the popup as an error phase',async()=>{
  const h=setup(Error('Model unavailable'));await flush();
  assert.equal(h.sent.at(-1).phase,'error');assert.equal(h.sent.at(-1).ready,false);
  assert.match(h.sent.at(-1).detail,/Model unavailable/);h.close();
});

test('activation error directs to the model selector and preparation can be retried automatically',async()=>{
  const h=setup(Object.assign(Error('user activation needed'),{name:'NotAllowedError'}));await flush();
  assert.match(h.sent.at(-1).detail,/chọn Chrome AI/);
  h.instance.prepare=async()=>{h.instance.ready=true;};
  await h.receive({type:'prepare'});await flush();
  assert.equal(h.sent.at(-1).ready,true);assert.equal(h.w.document.querySelector('button'),null);h.close();
});
test('host cancels pending inference on STOP message and never sends successful late result',async()=>{
  const h=setup();await flush();
  const pending=h.receive({type:'solve',id:'a',question:{}});await h.receive({type:'cancel',id:'a'});await pending;
  assert.equal(h.signal.aborted,true);assert.equal(h.sent.some(m=>m.result),false);h.close();
});
test('closing host aborts inference and disposes model',async()=>{
  const h=setup();await flush();
  const pending=h.receive({type:'solve',id:'a',question:{}});h.close();await pending;
  assert.equal(h.signal.aborted,true);assert.equal(h.instance.ready,false);
});

test('shared AI document routes Canvas prompt/schema to its unchanged native solver',async()=>{
  const h=setup();await flush();let received;
  h.w.ChromeAi={solve:async(prompt,signal,schema)=>{received={prompt,signal,schema};return {answerable:true,selected_option_ids:['option_1']};}};
  await h.receive({type:'canvas-solve',id:'canvas-job',prompt:'Canvas question',schema:{type:'object'}});
  assert.equal(received.prompt,'Canvas question');assert.equal(received.schema.type,'object');
  assert.equal(h.sent.find(m=>m.id==='canvas-job').result.selected_option_ids[0],'option_1');h.close();
});
