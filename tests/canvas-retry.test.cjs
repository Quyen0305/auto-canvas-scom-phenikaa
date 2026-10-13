const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

async function exercise(error) {
  const dom=new JSDOM('<form id="submit_quiz_form"><div id="questions"><div class="display_question question" id="question_1"><div class="question_text">1 + 1?</div><div class="answers">'+['1','2'].map((text,i)=>`<div class="answer"><input type="radio" name="q" value="${i}"><span class="answer_label">${text}</span></div>`).join('')+'</div></div></div></form>',{url:'https://canvas.test/courses/1/quizzes/2/take',runScripts:'outside-only'});
  const w=dom.window,calls=[],cancelled=new Set();let now=100000,next=0;
  Object.defineProperty(w.HTMLElement.prototype,'offsetParent',{get(){return w.document.body;}});
  w.Date.now=()=>now;
  w.setInterval=()=>1;w.clearInterval=()=>{};
  w.setTimeout=(fn,delay)=>{const id=++next;setImmediate(()=>{if(!cancelled.has(id)){now+=delay;fn();}});return id;};
  w.clearTimeout=id=>cancelled.add(id);
  w.chrome={runtime:{id:'suite',onMessage:{addListener(){}},sendMessage(message,callback){
    let response={success:true,data:{enabled:false}};
    if(message.action==='CANVAS_STORAGE')response={success:true,data:{aiEngine:'gemini_api',apiKey:'TEST_KEY',aiModel:'gemini-2.5-pro',answerReviewVersion:2,autoClickAnswer:true,autoNextQuestion:false}};
    if(message.action==='SOLVE_QUESTIONS'){calls.push({at:now,model:message.data.model,attempt:message.data.attempt});response={success:false,...error};}
    if(callback){callback(response);return;}return Promise.resolve(response);
  }}};
  try {
    await new Promise(resolve=>w.document.addEventListener('DOMContentLoaded',resolve,{once:true}));
    w.eval(fs.readFileSync('extension/canvas-compat.js','utf8'));w.eval(fs.readFileSync('extension/canvas/content.js','utf8'));await flush();
    w.document.getElementById('canvas-ai-solve-current').click();
    const deadline=Date.now()+3000;
    while(!w.document.getElementById('canvas-ai-status-msg').classList.contains('error')){
      if(Date.now()>deadline)throw Error('Retry loop did not stop');await flush();
    }
    return {calls,status:w.document.getElementById('canvas-ai-status-msg').textContent,selected:w.document.querySelectorAll('input:checked').length};
  } finally {w.__canvasAiCleanup?.();w.close();}
}

test('retry waits retain their existing length and stop after five attempts',async()=>{
  const result=await exercise({code:'RATE_LIMIT',error:'Gemini HTTP 429: rate limit.',retryable:true,retryAfterMs:1});
  assert.equal(result.calls.length,5);
  for(let i=1;i<5;i++)assert.equal(result.calls[i].at-result.calls[i-1].at,1000);
  assert.match(result.status,/429/);assert.match(result.status,/5 lần/);assert.equal(result.selected,0);
});

test('model-not-found stops on the selected model without silently changing models',async()=>{
  const result=await exercise({code:'HTTP_404',error:'Gemini HTTP 404: model not found.',retryable:false});
  assert.equal(result.calls.length,1);assert.equal(result.calls[0].model,'gemini-2.5-pro');assert.equal(result.selected,0);
});

test('permanent quota exhaustion stops immediately',async()=>{
  const result=await exercise({code:'QUOTA_EXHAUSTED',error:'Gemini HTTP 429: hết quota ngày.',retryable:false});
  assert.equal(result.calls.length,1);assert.match(result.status,/quota ngày/);
});
