const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const signal=new AbortController().signal;
function setup(answer={answer_letter:'B',brief_reason:'Đáp án thứ hai là đúng.',used_search:false,sources:[]}){
  const calls=[];
  const ctx=vm.createContext({URL,AbortController,DOMException,setTimeout,clearTimeout,
    fetch:async (url,opts)=>{calls.push({url,opts,body:JSON.parse(opts.body)});return {ok:true,status:200,text:async()=>JSON.stringify(answer)};}});
  vm.runInContext(fs.readFileSync('extension/cloud-providers.js','utf8'),ctx);
  return {api:ctx.SuiteCloud,calls};
}
const key='x'.repeat(40),baseURL='https://adaptive.example.org';
const config={engine:'ninerouter_api',model:'adaptive',apiKey:key,baseURL};
test('Adaptive VPS receives single quiz and returns Canvas-compatible answer',async()=>{
  const h=setup();
  const question={id:'q1',questionText:'1 + 1?',options:['1','2'],questionType:'multiple_choice_question'};
  const result=await h.api.solve(config,{questionData:question,signal,prompt:'unused',query:'unused',schema:{}});
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].url,baseURL+'/v1/answer');
  assert.equal(h.calls[0].opts.headers.Authorization,'Bearer '+key);
  assert.equal(h.calls[0].body.mode,'adaptive');
  assert.equal(h.calls[0].body.choices.B,'2');
  assert.equal(result.data.answers[0].id,'q1');
  assert.equal(result.data.answers[0].selected_indices[0],1);
});
test('Adaptive VPS maps letter to 1-based SCORM choice index',async()=>{
  const h=setup();
  const r=await h.api.solve(config,{questionData:{text:'1+1?',options:['1','2'],multiple:false,history:[]},signal});
  assert.equal(r.data.answers[0],2);
});
test('Adaptive refuses invalid answers without silently choosing',async()=>{
  const h=setup({answer_letter:null,brief_reason:'Không chắc chắn',sources:[]});
  await assert.rejects(h.api.solve(config,{questionData:{id:'q1',questionText:'1+1?',options:['1','2']},signal}),e=>e.code==='NO_ANSWER');
});
test('Adaptive refuses multi-select and already rejected choice',async()=>{
  const h=setup();
  await assert.rejects(h.api.solve(config,{questionData:{id:'q1',questionText:'1+1?',options:['1','2'],questionType:'multiple_answers_question'},signal}),e=>e.code==='UNSUPPORTED_QUESTION');
  await assert.rejects(h.api.solve(config,{questionData:{id:'q1',questionText:'1+1?',options:['1','2'],excluded_answers:[[1]]},signal}),e=>e.code==='REJECTED_ANSWER');
  assert.equal(h.calls.length,1);
});
test('single-paste connection validates HTTPS and APP_API_KEY',()=>{
  const h=setup(),v=h.api.adaptiveConnection(baseURL+' | '+key);
  assert.equal(v.baseURL,baseURL+'/v1/answer');assert.equal(v.key,key);
  assert.throws(()=>h.api.adaptiveConnection('http://public.example.com | '+key));
  assert.throws(()=>h.api.adaptiveConnection(baseURL+' | short'));
});
