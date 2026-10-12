const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('Canvas keeps the RAM worker alive during a long API backoff and releases its heartbeat on cleanup',async()=>{
  const dom=new JSDOM('<form id="submit_quiz_form"><div id="questions"><div class="display_question question" id="question_1"><div class="question_text">1 + 1?</div><div class="answers">'+['1','2'].map((text,i)=>`<div class="answer"><input type="radio" name="q" value="${i}"><span class="answer_label">${text}</span></div>`).join('')+'</div></div></div></form>',{url:'https://canvas.test/courses/1/quizzes/2/take',runScripts:'outside-only'});
  const w=dom.window,messages=[],intervals=new Map();let next=0;
  Object.defineProperty(w.HTMLElement.prototype,'offsetParent',{get(){return w.document.body;}});
  w.setInterval=(fn,ms)=>{const id=++next;intervals.set(id,{fn,ms});return id;};
  w.clearInterval=id=>intervals.delete(id);
  w.chrome={runtime:{id:'suite',onMessage:{addListener(){}},sendMessage(message,callback){
    messages.push(message);
    const response=message.action==='CANVAS_STORAGE'?{success:true,data:{aiEngine:'gemini_api',apiKey:'TEST_KEY',aiModel:'gemini-2.5-flash',answerReviewVersion:2,autoClickAnswer:true,autoNextQuestion:false}}
      :message.action==='SOLVE_QUESTIONS'?{success:false,code:'HTTP_429',retryable:true,retryAfterMs:60000,error:'Quota wait'}
      :{success:true,data:{enabled:false}};
    if(callback){callback(response);return;}return Promise.resolve(response);
  }}};
  try {
    await new Promise(resolve=>w.document.addEventListener('DOMContentLoaded',resolve,{once:true}));
    w.eval(fs.readFileSync('extension/canvas-compat.js','utf8'));
    w.eval(fs.readFileSync('extension/canvas/content.js','utf8'));await flush();
    w.document.getElementById('canvas-ai-solve-current').click();await flush();
    assert.ok(messages.some(m=>m.action==='SOLVE_QUESTIONS'));
    const heartbeat=[...intervals.values()].find(timer=>timer.ms===15000);
    assert.ok(heartbeat,'a long 429 wait must retain the RAM worker');
    heartbeat.fn();await flush();assert.ok(messages.some(m=>m.action==='SUITE_HEARTBEAT'));
    w.__canvasAiCleanup();await flush();assert.equal(intervals.size,0);
  } finally {w.__canvasAiCleanup?.();w.close();}
});
