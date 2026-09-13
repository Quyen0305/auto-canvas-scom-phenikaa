const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../extension/core.js');
const question = {text:'Câu hỏi?',options:['Một','Hai','Ba'],multiple:false,history:[{answers:[1],confirmedWrong:true,feedback:'Sai'}]};
function setup(raw = '{"answers":[2],"reason":"Because two."}') {
  const calls = [], destroyed = [];
  const model = {destroy(){destroyed.push('base');}, async clone(options) {
    calls.push(['clone', options]);
    return {async prompt(text, opts) { calls.push(['prompt',JSON.parse(text),opts]); return typeof raw === 'function' ? raw(opts.signal) : raw; }, destroy(){destroyed.push('clone');}};
  }};
  const api = {LanguageModel: {async availability(options){calls.push(['availability',options]);return 'available';},async create(options){calls.push(['model',options]);return model;}},
    Translator: {async availability(){return 'downloadable';},async create(options){calls.push(['translator',options]);return {
      async translate(text, opts){opts.signal.throwIfAborted();calls.push(['translate',options.sourceLanguage,text]);return options.sourceLanguage==='vi' ? `EN:${text}` : 'Vì đáp án hai.';},
      destroy(){destroyed.push(options.sourceLanguage);}
    };}}};
  const context = vm.createContext({LessonCore:core,AbortController});
  vm.runInContext(fs.readFileSync('extension/builtin-engine.js','utf8'),context);
  const engine = new context.LessonBuiltin.Engine(api);
  return {engine,api,calls,destroyed};
}
test('Chrome AI checks language capabilities and translates fields without changing answer numbering',async()=>{
  const h=setup();await h.engine.availability();await h.engine.prepare();
  const r=await h.engine.solve(question,new AbortController().signal);
  assert.deepEqual([...r.answers],[1]);assert.equal(r.reason,'Vì đáp án hai.');
  const data=h.calls.find(c=>c[0]==='prompt')[1];
  assert.equal(data.text,'EN:Câu hỏi?');assert.deepEqual([...data.options],['EN:Một','EN:Hai','EN:Ba']);
  assert.deepEqual([...data.history[0].answers],[1]);assert.equal(data.history[0].confirmedWrong,true);
  assert.equal(data.history[0].feedback,'EN:Sai');
  assert.equal(JSON.stringify(h.calls.find(c=>c[0]==='availability')[1]),JSON.stringify(h.calls.find(c=>c[0]==='model')[1].expectedInputs ? {
    expectedInputs:h.calls.find(c=>c[0]==='model')[1].expectedInputs,expectedOutputs:h.calls.find(c=>c[0]==='model')[1].expectedOutputs
  } : {}));
  assert.ok(h.calls.find(c=>c[0]==='prompt')[2].responseConstraint);
  assert.deepEqual(h.destroyed,['clone']);h.engine.destroy();
});
test('each question gets fresh model context; history never accumulates in base session',async()=>{
  const h=setup();await h.engine.prepare();
  await h.engine.solve(question,new AbortController().signal);await h.engine.solve({...question,history:[]},new AbortController().signal);
  assert.equal(h.calls.filter(c=>c[0]==='clone').length,2);
  assert.equal(h.calls.filter(c=>c[0]==='prompt')[1][1].history.length,0);h.engine.destroy();
});
for(const raw of ['not json','{"answers":[],"reason":"unknown"}','{"answers":[4]}','{"answers":[1,2]}','{"answers":[2,2]}']) {
  test(`invalid local answer is rejected: ${raw}`,async()=>{
    const h=setup(raw);await h.engine.prepare();
    await assert.rejects(h.engine.solve(question,new AbortController().signal),raw === 'not json' ? /JSON hợp lệ/ : /không hợp lệ/);
    assert.ok(h.destroyed.includes('clone'));assert.equal(h.engine.busy,false);h.engine.destroy();
  });
}
test('multiple-choice local answer keeps all selected indices',async()=>{
  const h=setup('{"answers":[3,2],"reason":"Both."}');await h.engine.prepare();
  const result=await h.engine.solve({...question,multiple:true},new AbortController().signal);
  assert.deepEqual([...result.answers],[1,2]);h.engine.destroy();
});
test('aborting inference propagates to the native prompt and destroys the clone',async()=>{
  let reached;const wait=new Promise(r=>reached=r);
  const h=setup(signal=>new Promise((resolve,reject)=>{reached();signal.addEventListener('abort',()=>reject(signal.reason));}));
  await h.engine.prepare();const c=new AbortController();const pending=h.engine.solve(question,c.signal);
  await wait;c.abort();await assert.rejects(pending);assert.ok(h.destroyed.includes('clone'));assert.equal(h.engine.busy,false);h.engine.destroy();
});
test('all three create calls start in the user activation turn before downloads finish',async()=>{
  const h=setup();let finish;
  const create=h.api.LanguageModel.create;
  h.api.LanguageModel.create=opts=>new Promise(r=>{finish=async()=>r(await create(opts));});
  const pending=h.engine.prepare();
  assert.equal(h.calls.filter(c=>c[0]==='translator').length,2);
  await finish();await pending;assert.equal(h.engine.ready,true);h.engine.destroy();
});
test('failed model preparation destroys partial resources and never becomes ready',async()=>{
  const h=setup();h.api.Translator.create=async()=>{throw Error('Unsupported language');};
  await assert.rejects(h.engine.prepare(),/Unsupported language/);
  assert.equal(h.engine.ready,false);assert.ok(h.destroyed.includes('base'));h.engine.destroy();
});
test('missing browser APIs give an actionable error without attempting cloud inference',async()=>{
  const h=setup();h.engine.api={};
  assert.equal((await h.engine.availability()).model,'missing');
  await assert.rejects(h.engine.prepare(),/138/);assert.equal(h.engine.ready,false);
});
