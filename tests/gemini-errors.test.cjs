const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const requestData={apiKey:'TEST_SECRET_KEY',model:'gemini-2.5-flash',questions:[{id:'q1',questionText:'1 + 1?',options:['1','2']}]};
function setup({status=429,error={},retryAfter=null,fetcher}={}) {
  let listener;const data={};const calls=[];
  const chrome={runtime:{onMessage:{addListener(fn){listener=fn;}}},storage:{session:{
    async get(value){return {...value,...data};},async set(value){Object.assign(data,value);}
  }}};
  const context=vm.createContext({chrome,CanvasCompat:{create:()=>chrome},SuiteCanvasAI:{},AbortController,TextEncoder,console,setTimeout,clearTimeout,
    fetch:fetcher || (async(url,options)=>{calls.push({url,options});return {ok:false,status,headers:{get:()=>retryAfter},text:async()=>JSON.stringify({error})};})});
  vm.runInContext(fs.readFileSync('extension/canvas/background.js','utf8'),context);
  const request=patch=>new Promise(resolve=>listener({action:'SOLVE_QUESTIONS',data:{...requestData,...patch}},{tab:{id:9}},resolve));
  return {request,calls,data};
}

test('explicit daily quota error stops instead of repeatedly treating it as temporary throttling',async()=>{
  const h=setup({error:{code:'quota_exceeded',message:'Quota exceeded.'}});
  const result=await h.request();assert.equal(result.code,'QUOTA_EXHAUSTED');assert.equal(result.retryable,false);
});

test('short server retry hints retain the existing delay policy without extra waiting',async()=>{
  const h=setup({error:{status:'RESOURCE_EXHAUSTED',message:'Please retry in 0.2s.'}});
  const result=await h.request({attempt:3});
  assert.equal(result.code,'RATE_LIMIT');assert.equal(result.retryAfterMs,2000);
});

test('server Retry-After is honored for unavailable errors as well as rate limits',async()=>{
  const h=setup({status:503,retryAfter:'90',error:{status:'UNAVAILABLE',message:'Overloaded.'}});
  const result=await h.request();assert.equal(result.code,'UNAVAILABLE');assert.ok(result.retryAfterMs>=90000);
  assert.match(result.error,/503/);
  assert.match(result.error,/Overloaded/);
});

test('invalid credentials give an actionable error without retrying or exposing the key',async()=>{
  const h=setup({status:403,error:{status:'PERMISSION_DENIED',message:'Denied TEST_SECRET_KEY'}});
  const result=await h.request();assert.equal(result.retryable,false);assert.match(result.error,/403/);
  assert.equal(JSON.stringify(result).includes('TEST_SECRET_KEY'),false);
  assert.match(result.error,/Denied \[key đã ẩn\]/);
});

test('Gemini invalid-key HTTP 400 retains the actual provider reason',async()=>{
  const h=setup({status:400,error:{status:'INVALID_ARGUMENT',message:'API key not valid. Please pass a valid API key.',
    details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',reason:'API_KEY_INVALID'}]}});
  const result=await h.request();assert.equal(result.retryable,false);
  assert.match(result.error,/API key not valid/);assert.match(result.error,/Nhập lại key/);
});

test('daily quota IDs and zero quota retain their terminal classification',async()=>{
  for(const error of [
    {status:'RESOURCE_EXHAUSTED',message:'Quota',details:[{violations:[{quotaId:'GenerateRequestsPerDayPerProjectPerModel-FreeTier',quotaValue:'20'}]}]},
    {status:'RESOURCE_EXHAUSTED',message:'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0'}
  ]) {
    const result=await setup({error}).request();assert.equal(result.code,'QUOTA_EXHAUSTED');assert.equal(result.retryable,false);
  }
});

test('RetryInfo durations are honored and the cooldown prevents a second paid fetch',async()=>{
  const h=setup({error:{status:'RESOURCE_EXHAUSTED',message:'Rate limit',details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'60.5s'}]}});
  const first=await h.request();assert.ok(first.retryAfterMs>=60500);
  const second=await h.request();assert.equal(second.code,'COOLDOWN');assert.equal(h.calls.length,1);
});

test('fallback waits remain unchanged when Google supplies no retry hint',async()=>{
  const limited=await setup({error:{status:'RESOURCE_EXHAUSTED',message:'Rate limit'}}).request({attempt:0});
  assert.equal(limited.retryAfterMs,6000);
  const unavailable=await setup({status:503,error:{status:'UNAVAILABLE'}}).request({attempt:0});
  assert.equal(unavailable.retryAfterMs,3000);
});
